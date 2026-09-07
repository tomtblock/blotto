/**
 * The bank and recycle harness (B-f) — funding 64 entrant wallets for a
 * devnet pool and getting the money back afterwards.
 *
 * WHY THIS EXISTS. Every budget number for the twenty-pool rehearsal assumes
 * the prize money returns to the bank. At tier 0 one full pool moves 6.4 SOL
 * of entries in and pays a 4 SOL pot out — since D-E2 to ONE winner wallet,
 * or to the members of a tie for first; if those wallets are never swept, the
 * bank funds every pool from scratch and empties within a handful of pools.
 * The run still LOOKS fine while that happens — pools fill, settle and verify
 * exactly as they should — which is why pool 1 asserts the bank's net change
 * rather than trusting it: a small loss (fees and rent) if the sweep works,
 * something close to a whole pot if it silently does not. The gap is an order
 * of magnitude, impossible to miss if someone looks, so look.
 *
 * NOT WIRED YET. `fundEntrants`, `sweepToBank` and `readBank` have no runner:
 * the rehearsal that CI runs is the offline one in `orchestrator.ts`, and the
 * live twenty-pool devnet run this file was written for is still ahead of us
 * (see the Road to Mainnet checklist). The pure parts — derivation, the
 * ledger, `assertSweepWorked` — are covered by `test/bank.spec.ts`.
 *
 * THE DESIGN DECISION WORTH KNOWING. Entrant wallets are DERIVED, not
 * generated. A random keypair per entrant is simpler and loses money: if the
 * harness crashes between funding and sweeping — a timeout, a rate limit, a
 * closed laptop — the SOL sits in 64 addresses whose private keys existed only
 * in that process's memory, unrecoverable. Deriving each from the bank's own
 * public key plus the pool id and seat index means a later run can rebuild
 * exactly the same wallets and sweep them, so an interrupted pool costs a
 * command rather than its funding.
 *
 * The derivation is deliberately NOT a secret: it is reproducible by anyone
 * holding the bank keypair, which is the only thing that matters. These are
 * throwaway devnet identities, never a custody mechanism, and nothing here is
 * fit for mainnet.
 *
 * No float touches a lamport amount anywhere in this module.
 */

import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

/** Solana's per-signature fee. Every transfer here is single-signature. */
export const SIGNATURE_FEE_LAMPORTS = 5_000n;

/**
 * Left in each entrant wallet when funding, on top of the entry price, to
 * cover the register transaction's fee and the pass-asset rent it pays. Sized
 * from the rehearsal's own measurements rather than guessed; pool 1 reports
 * the real figure and this is revisited if it is wrong.
 */
export const ENTRANT_FEE_BUFFER_LAMPORTS = 30_000_000n; // 0.03 SOL

/**
 * A sweep leaves nothing behind: the accounts are throwaway and devnet
 * charges no rent on a zero-balance system account it is closing out. A
 * balance at or below one signature fee cannot pay for its own transfer, so
 * it is left rather than attempted — the alternative is a certain failure
 * per wallet and a noisy log that hides real ones.
 */
export const SWEEP_DUST_FLOOR_LAMPORTS = SIGNATURE_FEE_LAMPORTS * 2n;

/** One derived entrant: the seat it fills and the keypair that signs for it. */
export interface EntrantWallet {
  /** 0-based seat in the pool, matching `Entry.index` on chain. */
  readonly seat: number;
  readonly keypair: Keypair;
}

/**
 * Rebuild the wallets for a pool. Deterministic in (bank, poolId, seat), so
 * calling it again after a crash returns the SAME keypairs and the funds are
 * recoverable. Never call it with a mainnet bank.
 */
export function deriveEntrantWallets(
  bank: PublicKey,
  poolId: bigint,
  count: number
): EntrantWallet[] {
  if (count <= 0) throw new Error(`count must be positive, got ${count}`);
  const wallets: EntrantWallet[] = [];
  for (let seat = 0; seat < count; seat++) {
    // Domain-separated so these can never collide with any other key the
    // project derives, and pool-scoped so two pools never share an entrant.
    const seed = createHash('sha256')
      .update('blotto-cup:rehearsal-entrant:v1')
      .update(bank.toBuffer())
      .update(Buffer.from(poolId.toString(10)))
      .update(Buffer.from(String(seat)))
      .digest();
    wallets.push({ seat, keypair: Keypair.fromSeed(seed.subarray(0, 32)) });
  }
  return wallets;
}

/** What one transfer did, so a caller can report rather than infer. */
export interface TransferResult {
  readonly address: string;
  readonly lamports: bigint;
  readonly signature: string;
}

async function transfer(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: bigint
): Promise<string> {
  if (lamports <= 0n) throw new Error(`refusing a non-positive transfer of ${lamports}`);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Number(lamports),
    })
  );
  return sendAndConfirmTransaction(connection, tx, [from], { commitment: 'confirmed' });
}

/**
 * Top each entrant up to `entryLamports + ENTRANT_FEE_BUFFER_LAMPORTS`.
 *
 * TOPS UP rather than sends a fixed amount: a re-run after a partial failure
 * must not double-fund the wallets that already succeeded. A wallet already at
 * or above the target is skipped.
 */
export async function fundEntrants(
  connection: Connection,
  bank: Keypair,
  wallets: readonly EntrantWallet[],
  entryLamports: bigint
): Promise<TransferResult[]> {
  const target = entryLamports + ENTRANT_FEE_BUFFER_LAMPORTS;
  const done: TransferResult[] = [];
  for (const { keypair } of wallets) {
    const have = BigInt(await connection.getBalance(keypair.publicKey, 'confirmed'));
    if (have >= target) continue;
    const need = target - have;
    const signature = await transfer(connection, bank, keypair.publicKey, need);
    done.push({ address: keypair.publicKey.toBase58(), lamports: need, signature });
  }
  return done;
}

/**
 * Return every entrant's remaining balance to the bank — entries that were
 * refunded, prizes that were paid, and the unspent fee buffer alike.
 *
 * Each wallet pays its own signature fee out of what it sends back, so the
 * bank receives `balance − fee`. A wallet that cannot cover that is left
 * alone and reported, not retried.
 */
export async function sweepToBank(
  connection: Connection,
  bank: PublicKey,
  wallets: readonly EntrantWallet[]
): Promise<{ swept: TransferResult[]; skipped: string[] }> {
  const swept: TransferResult[] = [];
  const skipped: string[] = [];
  for (const { keypair } of wallets) {
    const balance = BigInt(await connection.getBalance(keypair.publicKey, 'confirmed'));
    if (balance <= SWEEP_DUST_FLOOR_LAMPORTS) {
      skipped.push(keypair.publicKey.toBase58());
      continue;
    }
    const amount = balance - SIGNATURE_FEE_LAMPORTS;
    const signature = await transfer(connection, keypair, bank, amount);
    swept.push({ address: keypair.publicKey.toBase58(), lamports: amount, signature });
  }
  return { swept, skipped };
}

/** The one number pool 1 is judged on. */
export interface BankLedger {
  readonly before: bigint;
  readonly after: bigint;
  /** Negative means the bank paid for the pool; positive means it gained. */
  readonly net: bigint;
  readonly netSol: string;
}

export async function readBank(connection: Connection, bank: PublicKey): Promise<bigint> {
  return BigInt(await connection.getBalance(bank, 'confirmed'));
}

/** Format without floats: lamports are exact, and a rounded SOL string is
 *  for human eyes only — never fed back into an amount. */
export function bankLedger(before: bigint, after: bigint): BankLedger {
  const net = after - before;
  const sign = net < 0n ? '-' : '';
  const abs = net < 0n ? -net : net;
  const whole = abs / BigInt(LAMPORTS_PER_SOL);
  const frac = (abs % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, '0');
  return { before, after, net, netSol: `${sign}${whole}.${frac}` };
}

/**
 * Pool 1's pass/fail gate, as the runbook states it.
 *
 * A working sweep leaves the bank down only the pool's costs — rent, fees and
 * the treasury's cut — on the order of 0.4 SOL. A sweep that silently did
 * nothing leaves it down the whole prize outlay, around 5.5. The band is wide
 * on purpose: this separates "the money came back" from "it did not", and is
 * not a rent measurement. Pool 1 REPORTS the exact figure; this only refuses
 * to let the run continue past a sweep that is not working.
 */
export const SWEEP_WORKING_MAX_LOSS_LAMPORTS = 2_000_000_000n; // 2 SOL

export function assertSweepWorked(ledger: BankLedger): void {
  if (ledger.net >= 0n) return;
  const loss = -ledger.net;
  if (loss <= SWEEP_WORKING_MAX_LOSS_LAMPORTS) return;
  throw new Error(
    `the bank lost ${ledger.netSol} SOL on this pool, more than the ` +
      `${SWEEP_WORKING_MAX_LOSS_LAMPORTS / BigInt(LAMPORTS_PER_SOL)} SOL that says the prize ` +
      `sweep-back is working. Expect about -0.41 SOL per pool with a working sweep and ` +
      `about -5.5 without one. Do not continue the run: at this rate the bank is empty ` +
      `within four pools, and every pool until then still looks correct.`
  );
}
