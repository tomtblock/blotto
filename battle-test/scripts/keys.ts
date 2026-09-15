/**
 * Deterministic devnet keys for the battle test.
 *
 * The session container is ephemeral, so nothing under `battle-test/keys/`
 * survives between sessions and nothing there may be committed. Every key the
 * test uses is therefore DERIVED from one 32-byte master seed the founder
 * holds, and re-derived at the start of every session:
 *
 *   seed_label = HMAC-SHA256(key = master, msg = "blotto-battle-test/v1/" + label)
 *   keypair    = Ed25519 from that 32-byte seed (Keypair.fromSeed)
 *
 * Labels: "funder", and "wallet/00" … "wallet/71" for the headless entrants.
 * The same master always yields the same 73 addresses, so `registry/wallets.json`
 * (addresses only) is reproducible and a lost container loses nothing.
 *
 * Run (from the repo root until battle-test has its own package):
 *   BLOTTO_BT_SEED=<64 hex chars> npx ts-node --transpile-only battle-test/scripts/keys.ts derive
 *   BLOTTO_BT_SEED=<64 hex chars> npx ts-node --transpile-only battle-test/scripts/keys.ts addresses
 *   npx ts-node --transpile-only battle-test/scripts/keys.ts new-master     # prints a fresh master; never stored
 *
 * `derive` writes `battle-test/keys/funder.json` and `battle-test/keys/wallets/NN.json`
 * in the Solana CLI keypair format (64-byte secret key as a JSON number array),
 * which is what `fan-out.ts` and `enter.ts` load. `battle-test/.gitignore`
 * keeps `keys/` out of git.
 */

import { createHmac, randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { Keypair } from '@solana/web3.js';

export const WALLET_COUNT = 72;
export const DERIVATION_DOMAIN = 'blotto-battle-test/v1/';

const KEYS_DIR = resolve(__dirname, '..', 'keys');

export function masterFromEnv(): Buffer {
  const hex = process.env.BLOTTO_BT_SEED?.trim();
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('BLOTTO_BT_SEED must be 64 hex characters (32 bytes); ask the founder for it');
  }
  return Buffer.from(hex, 'hex');
}

export function deriveKeypair(master: Buffer, label: string): Keypair {
  const seed = createHmac('sha256', master).update(DERIVATION_DOMAIN + label).digest();
  return Keypair.fromSeed(new Uint8Array(seed));
}

export function walletLabel(i: number): string {
  return `wallet/${String(i).padStart(2, '0')}`;
}

export function deriveAll(master: Buffer): { funder: Keypair; wallets: Keypair[] } {
  const funder = deriveKeypair(master, 'funder');
  const wallets = Array.from({ length: WALLET_COUNT }, (_, i) => deriveKeypair(master, walletLabel(i)));
  return { funder, wallets };
}

function writeKeypair(path: string, kp: Keypair): void {
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)) + '\n', { mode: 0o600 });
}

function main(): void {
  const cmd = process.argv[2] ?? '';
  if (cmd === 'new-master') {
    console.log(randomBytes(32).toString('hex'));
    return;
  }
  const master = masterFromEnv();
  const { funder, wallets } = deriveAll(master);
  if (cmd === 'addresses') {
    console.log(`funder  ${funder.publicKey.toBase58()}`);
    wallets.forEach((w, i) => console.log(`W${String(i).padStart(2, '0')}     ${w.publicKey.toBase58()}`));
    return;
  }
  if (cmd === 'derive') {
    mkdirSync(join(KEYS_DIR, 'wallets'), { recursive: true });
    writeKeypair(join(KEYS_DIR, 'funder.json'), funder);
    wallets.forEach((w, i) => writeKeypair(join(KEYS_DIR, 'wallets', `${String(i).padStart(2, '0')}.json`), w));
    console.log(`wrote funder.json + ${wallets.length} wallets to ${KEYS_DIR}`);
    console.log(`funder ${funder.publicKey.toBase58()}`);
    return;
  }
  throw new Error('usage: keys.ts new-master | derive | addresses');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
