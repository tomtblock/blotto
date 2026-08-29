/**
 * The production Switchboard On-Demand VRF coordinator (closes the C11 stub
 * left in `daemon.ts`): create a fresh Randomness account per pool, land the
 * SDK's create+commit instructions, then drive the program's
 * `commit_vrf_seed` with the oracle's reveal bundled in the SAME transaction
 * — `vrf.rs` reads `get_value(Clock::slot)`, which only answers in the exact
 * reveal slot, so reveal and consume must ride together. `Web3Chain` already
 * owns that bundling through its `makeVrfRevealIx` hook; this module supplies
 * the hook and the account lifecycle around it.
 *
 * The Switchboard SDK sits behind the small `SwitchboardOps` seam so the
 * coordinator's behaviour (fresh account per pool, reveal only for accounts
 * we created, bounded retry, cleanup) is testable offline — the same
 * dependency-injection shape as every other adapter in this package. The
 * SDK-backed implementation is `makeSwitchboardOps`.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { AnchorUtils, Randomness } from '@switchboard-xyz/on-demand';

import type { VrfCoordinator } from './daemon';

/** A live Randomness account this process created and can reveal. */
export interface RandomnessHandle {
  /** The Randomness account's address (what `commit_vrf_seed` reads). */
  pubkey: PublicKey;
  /** Build the oracle reveal instruction for this account. The SDK fetches
   * the oracle's signed reveal, so this can fail until the oracle has
   * answered the commit — callers retry. */
  revealIx(): Promise<TransactionInstruction>;
}

/** The SDK boundary: everything network-shaped the coordinator depends on. */
export interface SwitchboardOps {
  /** Create a fresh Randomness account and land its create+commit
   * instructions on-chain. One account per pool, never reused — reuse would
   * tie two pools' cosmetic draws to one oracle value for no benefit. */
  createAndCommit(): Promise<RandomnessHandle>;
}

export interface SwitchboardVrfDeps {
  ops: SwitchboardOps;
  /** Lands the program's `commit_vrf_seed` (with the reveal bundled by the
   * chain's `makeVrfRevealIx`, which must be wired to this coordinator).
   * Injected as a function so construction order with `Web3Chain` is a
   * closure concern, not a circular dependency. */
  commitOnChain: (poolId: bigint, randomnessAccount: string) => Promise<void>;
  /** Retry attempts for the reveal+commit transaction (the oracle answers a
   * few slots after the commit lands, so the first attempt can be early). */
  attempts?: number;
  /** Delay between attempts. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (step: string, detail?: Record<string, unknown>) => void;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 2_000;

export class SwitchboardVrfCoordinator implements VrfCoordinator {
  /** Randomness accounts created but not yet consumed, by base58 pubkey. */
  private readonly pending = new Map<string, RandomnessHandle>();

  constructor(private readonly deps: SwitchboardVrfDeps) {}

  /** Wire this as `Web3ChainConfig.makeVrfRevealIx`. Returns null for any
   * account this process did not create (e.g. the stub's fixed account), so
   * the chain degrades to sending `commit_vrf_seed` alone. */
  readonly makeVrfRevealIx = async (
    randomnessAccount: PublicKey
  ): Promise<TransactionInstruction | null> => {
    const handle = this.pending.get(randomnessAccount.toBase58());
    return handle ? handle.revealIx() : null;
  };

  async commitSeed(poolId: bigint): Promise<void> {
    const attempts = this.deps.attempts ?? DEFAULT_ATTEMPTS;
    const delayMs = this.deps.delayMs ?? DEFAULT_DELAY_MS;
    const sleep =
      this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const handle = await this.deps.ops.createAndCommit();
    const key = handle.pubkey.toBase58();
    this.pending.set(key, handle);
    this.deps.log?.('vrf_randomness_created', { poolId: poolId.toString(), account: key });

    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          await this.deps.commitOnChain(poolId, key);
          this.deps.log?.('vrf_seed_committed', {
            poolId: poolId.toString(),
            account: key,
            attempt,
          });
          return;
        } catch (err) {
          lastError = err;
          this.deps.log?.('vrf_commit_retry', {
            poolId: poolId.toString(),
            account: key,
            attempt,
            error: err instanceof Error ? err.message : String(err),
          });
          if (attempt < attempts) await sleep(delayMs);
        }
      }
      // PHASE-5-REVIEW: on exhausted retries the Randomness account is
      // abandoned (rent-cost only) and the next daemon sweep retries with a
      // fresh one — simpler than persisting handles across ticks, and safe
      // because commit_vrf_seed is write-once per pool.
      throw lastError instanceof Error
        ? lastError
        : new Error(`vrf: commit failed after ${attempts} attempts: ${String(lastError)}`);
    } finally {
      this.pending.delete(key);
    }
  }
}

/** Build the SDK-backed ops. `queue` is the Switchboard On-Demand queue for
 * the target cluster (public configuration, not a credential); `payer` funds
 * account creation and fees — the daemon's settlement keypair. */
export async function makeSwitchboardOps(cfg: {
  connection: Connection;
  payer: Keypair;
  queue: PublicKey;
}): Promise<SwitchboardOps> {
  const program = await AnchorUtils.loadProgramFromConnection(cfg.connection);

  const send = async (
    ixs: TransactionInstruction[],
    signers: Keypair[]
  ): Promise<void> => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = cfg.payer.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await cfg.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    const signature = await cfg.connection.sendRawTransaction(tx.serialize());
    await cfg.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
  };

  return {
    async createAndCommit(): Promise<RandomnessHandle> {
      // The SDK's own bundling of create + commit — one transaction, one
      // fresh account keypair (returned so we can co-sign the creation).
      const [randomness, kp, ixs] = await Randomness.createAndCommitIxs(
        program,
        cfg.queue,
        cfg.payer.publicKey
      );
      await send(ixs, [cfg.payer, kp]);
      return {
        pubkey: randomness.pubkey,
        revealIx: () => randomness.revealIx(cfg.payer.publicKey),
      };
    },
  };
}
