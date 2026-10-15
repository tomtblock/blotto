/*
 * The watcher's read-only view of the chain: PDA derivation, one JSON-RPC
 * call shape, and decoders for the three accounts it reads.
 *
 * Deliberately not `@solana/web3.js`. The watcher needs `getMultipleAccounts`
 * and an off-curve check, nothing else, and every dependency it carries is
 * one more thing that can stop it starting — and a watcher that cannot start
 * is silent, which is the one failure it exists to prevent.
 *
 * Every layout here is the program's (`programs/blotto_cup/src/state.rs`),
 * read through the SAME decoders the daemon uses: Config through
 * `backend/_shared/src/config-account.ts`, Pool through
 * `backend/_shared/src/pool-account.ts`. No offset is copied into this package.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { base58Decode, base58Encode } from '../../_shared/src/blotto-events';
import { decodePoolHead, type PoolHead } from '../../_shared/src/pool-account';

export const PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
export const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

/** True when 32 bytes decode to a point on ed25519 — a PDA must not. */
function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * `findProgramAddressSync`: the first bump from 255 down whose hash is off
 * the curve. Returns the base58 address.
 */
export function findPda(seeds: Uint8Array[], programId: string = PROGRAM_ID): string {
  const program = base58Decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), program, PDA_MARKER];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      buf.set(p, off);
      off += p.length;
    }
    const hash = sha256(buf);
    if (!isOnCurve(hash)) return base58Encode(hash);
  }
  throw new Error('no off-curve bump for these seeds');
}

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

export const configPda = (): string => findPda([text('config')]);
export const poolPda = (id: bigint): string => findPda([text('pool'), u64le(id)]);
export const vaultPda = (id: bigint): string => findPda([text('vault'), u64le(id)]);
export const passCollectionPda = (pool: string): string =>
  findPda([text('pass_collection'), base58Decode(pool)]);

/** One account as `getMultipleAccounts` returns it, decoded from base64. */
export interface RawAccount {
  lamports: bigint;
  owner: string;
  data: Uint8Array;
}

/** What a failed RPC call looked like — kept whole so a cause can be read off it. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: string
  ) {
    super(message);
  }
}

export type Fetch = typeof fetch;

/** One JSON-RPC request. Throws `RpcError` with the HTTP status and body text. */
export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (e) {
    throw new RpcError(`${method}: ${(e as Error).message}`, null, '');
  }
  const body = await res.text();
  if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`, res.status, body);
  let json: { result?: T; error?: { code: number; message: string } };
  try {
    json = JSON.parse(body);
  } catch {
    throw new RpcError(`${method}: response is not JSON`, res.status, body);
  }
  if (json.error) {
    throw new RpcError(`${method}: ${json.error.code} ${json.error.message}`, res.status, body);
  }
  return json.result as T;
}

/** `getMultipleAccounts` (base64), in request order; a missing account is null. */
export async function getAccounts(
  url: string,
  addresses: string[],
  opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}
): Promise<(RawAccount | null)[]> {
  if (addresses.length === 0) return [];
  if (addresses.length > 100) throw new Error('getMultipleAccounts takes at most 100 addresses');
  const result = await rpcCall<{
    value: ({ lamports: number; owner: string; data: [string, string] } | null)[];
  }>(url, 'getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }], opts);
  return result.value.map((a) =>
    a === null
      ? null
      : {
          lamports: BigInt(a.lamports),
          owner: a.owner,
          data: new Uint8Array(Buffer.from(a.data[0], 'base64')),
        }
  );
}

/** `Clock.unix_timestamp`: slot 8 | epoch_start_timestamp 8 | epoch 8 | leader_schedule_epoch 8 | unix_timestamp 8. */
export function decodeClockUnix(data: Uint8Array): bigint {
  if (data.length < 40) throw new Error(`Clock sysvar is ${data.length} bytes; expected 40`);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(32, true);
}

/** A Pool's head as the watcher reads it, through the shared layout. */
export interface PoolView extends Omit<PoolHead, 'mode'> {
  mode: 'easy' | 'hard';
}

export function decodePool(data: Uint8Array): PoolView {
  const head = decodePoolHead(data);
  return { ...head, mode: head.mode === 1 ? 'hard' : 'easy' };
}
