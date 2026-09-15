/**
 * Fan-out funding for the Phase 5 rehearsal wallets (roadmap 5.1).
 *
 * Moves SOL from ONE funding keypair to the 64 entrant wallets, and sweeps it
 * back afterwards. Deliberately NOT the platform treasury: that is a PDA with
 * no private key, and its only exit is `withdraw_platform` under the on-chain
 * floor. Top the funder up from that withdrawal or the faucet, then run this.
 *
 * Every command is IDEMPOTENT over balances — `fund` tops each wallet UP TO
 * the target rather than sending a fixed amount, so a partially-failed run is
 * fixed by running it again, not by reconciling by hand.
 *
 * Run:  cd battle-test && npx ts-node --transpile-only scripts/fan-out.ts <command> [flags]
 *
 * commands
 *   status                    funder balance, per-wallet balances, shortfall
 *   fund   --target <amount>  top every wallet up to <amount>
 *          [--batch 18]       transfers per transaction
 *   sweep                     return every wallet's full balance to the funder
 *          [--batch 8]        wallets per transaction (signature-size bound)
 *
 * flags common to all
 *   --wallets <dir>   default ./keys/wallets (NN.json keypair files)
 *   --rpc <url>       default $RPC_URL or devnet
 *
 * environment
 *   FEE_PAYER_KEYPAIR   path to the funding keypair JSON (required)
 *
 * Amounts are integer LAMPORTS or an exact decimal SOL string ending in
 * "sol" (e.g. 0.115sol), parsed in bigint — no float touches an amount.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const DEFAULT_RPC = 'https://api.devnet.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000n;

// --- argument plumbing (mirrors scripts/admin.ts) ---------------------------

interface Cli {
  command: string;
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Cli {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag ${a} needs a value`);
    }
    flags.set(a.slice(2), value);
    i++;
  }
  return { command: command ?? '', flags };
}

function parseAmount(raw: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]+))?sol$/i.exec(raw.trim());
  if (!m) {
    if (!/^[0-9]+$/.test(raw.trim())) {
      throw new Error(`amount must be integer lamports or "<decimal>sol": ${raw}`);
    }
    return BigInt(raw.trim());
  }
  const frac = m[2] ?? '';
  if (frac.length > 9) throw new Error(`more than 9 decimal places of SOL: ${raw}`);
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, '0') || '0');
}

const sol = (lamports: bigint): string => {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0');
  return `${whole}.${frac}`;
};

// --- wallets ----------------------------------------------------------------

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[])
  );
}

/** Every NN.json in the wallets directory, in filename order so that index i
 * is stable across runs (the rehearsal population is seat-indexed). */
function loadWallets(dir: string): Keypair[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error(`no keypair JSON files in ${dir}`);
  return files.map((f) => loadKeypair(join(dir, f)));
}

function funder(): Keypair {
  const path = process.env.FEE_PAYER_KEYPAIR;
  if (!path) throw new Error('FEE_PAYER_KEYPAIR is not set (path to the funding keypair JSON)');
  return loadKeypair(path);
}

/** Balances in one RPC round trip per 100 accounts. */
async function balances(connection: Connection, keys: PublicKey[]): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const infos = await connection.getMultipleAccountsInfo(keys.slice(i, i + 100), 'confirmed');
    for (const info of infos) out.push(BigInt(info?.lamports ?? 0));
  }
  return out;
}

async function send(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: 'confirmed',
      });
      console.log(`  ${label}: ${sig}`);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`  ${label}: attempt ${attempt} failed, retrying — ${String(e)}`);
      tx.recentBlockhash = undefined;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// --- commands ---------------------------------------------------------------

async function cmdStatus(connection: Connection, wallets: Keypair[], target?: bigint) {
  const payer = funder();
  const [funderBalance] = await balances(connection, [payer.publicKey]);
  const bals = await balances(connection, wallets.map((w) => w.publicKey));

  console.log(`funder ${payer.publicKey.toBase58()}  ${sol(funderBalance)} SOL\n`);
  let total = 0n;
  let shortfall = 0n;
  let empty = 0;
  bals.forEach((b, i) => {
    total += b;
    if (b === 0n) empty++;
    if (target !== undefined && b < target) shortfall += target - b;
    console.log(
      `  [${String(i).padStart(2, '0')}] ${wallets[i].publicKey.toBase58()}  ${sol(b)}`
    );
  });
  console.log(`\n${wallets.length} wallets, ${empty} empty, ${sol(total)} SOL held`);
  if (target !== undefined) {
    console.log(`shortfall to ${sol(target)} each: ${sol(shortfall)} SOL`);
    if (shortfall > funderBalance) {
      console.log(`FUNDER SHORT by ${sol(shortfall - funderBalance)} SOL (before fees)`);
    }
  }
}

async function cmdFund(connection: Connection, wallets: Keypair[], cli: Cli) {
  const targetRaw = cli.flags.get('target');
  if (!targetRaw) throw new Error('--target is required (e.g. --target 0.115sol)');
  const target = parseAmount(targetRaw);
  const batch = Number(cli.flags.get('batch') ?? 18);
  if (!Number.isInteger(batch) || batch < 1 || batch > 20) {
    throw new Error('--batch must be an integer 1-20 (transaction size bound)');
  }

  const payer = funder();
  const bals = await balances(connection, wallets.map((w) => w.publicKey));

  const needed = wallets
    .map((w, i) => ({ wallet: w, top: target > bals[i] ? target - bals[i] : 0n }))
    .filter((x) => x.top > 0n);

  if (needed.length === 0) {
    console.log(`every wallet already holds at least ${sol(target)} SOL — nothing to do`);
    return;
  }

  const totalTop = needed.reduce((a, x) => a + x.top, 0n);
  const [funderBalance] = await balances(connection, [payer.publicKey]);
  console.log(
    `topping up ${needed.length} wallets to ${sol(target)} SOL each — ` +
      `${sol(totalTop)} SOL from ${sol(funderBalance)} SOL held`
  );
  if (totalTop >= funderBalance) {
    throw new Error('funder cannot cover the top-up plus fees — fund it first, then re-run');
  }

  for (let i = 0; i < needed.length; i += batch) {
    const slice = needed.slice(i, i + batch);
    const tx = new Transaction();
    for (const { wallet, top } of slice) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: wallet.publicKey,
          lamports: Number(top),
        })
      );
    }
    await send(connection, tx, [payer], `fund ${i}..${i + slice.length - 1}`);
  }
  console.log('done — re-run `status --target` to confirm');
}

async function cmdSweep(connection: Connection, wallets: Keypair[], cli: Cli) {
  const batch = Number(cli.flags.get('batch') ?? 8);
  if (!Number.isInteger(batch) || batch < 1 || batch > 10) {
    throw new Error('--batch must be an integer 1-10 (signature size bound)');
  }
  const payer = funder();
  const bals = await balances(connection, wallets.map((w) => w.publicKey));

  // The funder is fee payer, so each wallet can send its ENTIRE balance and
  // be reaped. Rent sunk in Entry PDAs and pass assets is NOT recoverable
  // here — the program owns those.
  const holding = wallets
    .map((w, i) => ({ wallet: w, lamports: bals[i] }))
    .filter((x) => x.lamports > 0n);

  if (holding.length === 0) {
    console.log('every wallet is already empty');
    return;
  }
  const total = holding.reduce((a, x) => a + x.lamports, 0n);
  console.log(`sweeping ${sol(total)} SOL from ${holding.length} wallets`);

  for (let i = 0; i < holding.length; i += batch) {
    const slice = holding.slice(i, i + batch);
    const tx = new Transaction();
    for (const { wallet, lamports } of slice) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: payer.publicKey,
          lamports: Number(lamports),
        })
      );
    }
    await send(
      connection,
      tx,
      [payer, ...slice.map((x) => x.wallet)],
      `sweep ${i}..${i + slice.length - 1}`
    );
  }
  console.log('done');
}

// --- entry point ------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.command || cli.command === 'help' || cli.command === '--help') {
    console.log(readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const connection = new Connection(
    cli.flags.get('rpc') ?? process.env.RPC_URL ?? DEFAULT_RPC,
    { commitment: 'confirmed' }
  );
  const wallets = loadWallets(cli.flags.get('wallets') ?? './keys/wallets');

  switch (cli.command) {
    case 'status': {
      const t = cli.flags.get('target');
      return cmdStatus(connection, wallets, t ? parseAmount(t) : undefined);
    }
    case 'fund':
      return cmdFund(connection, wallets, cli);
    case 'sweep':
      return cmdSweep(connection, wallets, cli);
    default:
      throw new Error(`unknown command: ${cli.command}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
