/*
 * The `register` transaction, client side (C9) — the two instructions the
 * entry lands with, encoded against the program's wire contract:
 *
 *   1. the Ed25519Program verification of the service-issued entry packet
 *      (the program reads it from the instructions sysvar — TECH-ARCH §8);
 *   2. `register` itself: discriminator ‖ pool_id u64 LE ‖ battles_hash,
 *      with the exact account order of `register.rs`'s #[derive(Accounts)].
 *
 * Byte-for-byte these mirror `tests/litesvm/src/lib.rs` (`ed25519_ix`,
 * `register_ix`) — the builders the compiled program is tested against.
 * The layouts are pinned by register-tx.test.ts.
 *
 * Everything here is pure over its inputs: no RPC, no wallet, no React.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { decodeEventsFromLogs } from '@blotto/shared/events';
import { registerBlottoEventLayouts } from '@blotto/shared/blotto-events';
import type { RevealClass } from '@/reveal/types';

export const ED25519_PROGRAM_ADDRESS = address(
  'Ed25519SigVerify111111111111111111111111111'
);
const MPL_CORE_ADDRESS = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
const SLOT_HASHES_SYSVAR = address('SysvarS1otHashes111111111111111111111111111');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/** The packet exactly as the service issued it — bytes, not base64. */
export interface IssuedPacketBytes {
  /** The canonical entry-packet message (85 bytes since D-B4). */
  message: Uint8Array;
  /** Ed25519 signature over the message, 64 bytes. */
  signature: Uint8Array;
  /** The service signer's public key, 32 bytes (`Config.entry_signer`). */
  publicKey: Uint8Array;
}

/**
 * The Ed25519Program instruction verifying the packet: one signature, all
 * offsets pointing into this instruction's own data (`u16::MAX` for the
 * instruction indices), layout `header 16 ‖ pubkey 32 ‖ signature 64 ‖
 * message` — the same fixed shape `entry_packet.rs` expects to find via
 * the instructions sysvar.
 */
export function buildEd25519Instruction(packet: IssuedPacketBytes): Instruction {
  if (packet.publicKey.length !== 32) throw new Error('packet publicKey must be 32 bytes');
  if (packet.signature.length !== 64) throw new Error('packet signature must be 64 bytes');
  const msgLen = packet.message.length;
  const data = new Uint8Array(16 + 32 + 64 + msgLen);
  const dv = new DataView(data.buffer);
  data[0] = 1; // num signatures
  data[1] = 0; // padding
  const u16s: number[] = [
    16 + 32, // signature offset
    0xffff, // signature instruction index: this instruction
    16, // pubkey offset
    0xffff, // pubkey instruction index
    16 + 32 + 64, // message offset
    msgLen,
    0xffff, // message instruction index
  ];
  u16s.forEach((v, i) => dv.setUint16(2 + i * 2, v, true));
  data.set(packet.publicKey, 16);
  data.set(packet.signature, 16 + 32);
  data.set(packet.message, 16 + 32 + 64);
  return { programAddress: ED25519_PROGRAM_ADDRESS, data };
}

const u64le = (v: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
};

/** Anchor's global instruction discriminator. */
const discriminator = (name: string): Uint8Array =>
  sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);

export interface RegisterPdas {
  config: Address;
  pool: Address;
  vault: Address;
  /** The platform treasury PDA `["platform"]` (D-A1 revised) — receives
   * 100% of the entry price. */
  platform: Address;
  entry: Address;
  passCollection: Address;
}

/** Derive every PDA `register` touches (seed prefixes per `state.rs`). */
export async function deriveRegisterPdas(
  programId: string,
  poolId: bigint,
  player: string
): Promise<RegisterPdas> {
  const programAddress = address(programId);
  const enc = getAddressEncoder();
  const idLe = u64le(poolId);
  const pda = async (seeds: (Uint8Array | string)[]) =>
    (await getProgramDerivedAddress({ programAddress, seeds }))[0];
  const pool = await pda(['pool', idLe]);
  const poolBytes = new Uint8Array(enc.encode(pool));
  return {
    config: await pda(['config']),
    pool,
    vault: await pda(['vault', idLe]),
    platform: await pda(['platform']),
    entry: await pda(['entry', poolBytes, new Uint8Array(enc.encode(address(player)))]),
    passCollection: await pda(['pass_collection', poolBytes]),
  };
}

export interface RegisterInstructionParams {
  programId: string;
  poolId: bigint;
  /** Base58 — the entrant, fee payer, and signer. */
  player: string;
  /** Base58 — the fresh pass-asset keypair's address (must also SIGN). */
  passAsset: string;
  /** 32 bytes — `sha256(battle set ‖ salt)`. */
  battlesHash: Uint8Array;
  pdas: RegisterPdas;
}

/** The `register` instruction, account order mirroring `register.rs`. */
export function buildRegisterInstruction(p: RegisterInstructionParams): Instruction {
  if (p.battlesHash.length !== 32) throw new Error('battlesHash must be 32 bytes');
  const data = new Uint8Array(8 + 8 + 32);
  data.set(discriminator('register'), 0);
  data.set(u64le(p.poolId), 8);
  data.set(p.battlesHash, 16);
  return {
    programAddress: address(p.programId),
    accounts: [
      { address: address(p.player), role: AccountRole.WRITABLE_SIGNER },
      { address: p.pdas.config, role: AccountRole.WRITABLE },
      { address: p.pdas.pool, role: AccountRole.WRITABLE },
      // Read-only: the belt-and-braces pot assertion (entries never touch
      // a prize vault — D-A1 revised).
      { address: p.pdas.vault, role: AccountRole.READONLY },
      { address: p.pdas.platform, role: AccountRole.WRITABLE },
      { address: p.pdas.entry, role: AccountRole.WRITABLE },
      { address: p.pdas.passCollection, role: AccountRole.WRITABLE },
      { address: address(p.passAsset), role: AccountRole.WRITABLE_SIGNER },
      { address: MPL_CORE_ADDRESS, role: AccountRole.READONLY },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: SLOT_HASHES_SYSVAR, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data,
  };
}

/** What the confirmed transaction's `EntryRegistered` event yields. */
export interface RegisteredEntry {
  pool: string;
  entryIndex: number;
  class: RevealClass;
  passAsset: string;
}

/**
 * Decode the entry's own `EntryRegistered` from a confirmed transaction's
 * log messages, or null when the logs don't carry it (withheld/truncated
 * logs — the caller renders the honest `outcome-unreadable` state, never a
 * guess).
 */
export function entryRegisteredFromLogs(
  logs: readonly string[],
  player: string
): RegisteredEntry | null {
  registerBlottoEventLayouts();
  for (const { event } of decodeEventsFromLogs(logs)) {
    if (event.event !== 'EntryRegistered') continue;
    const e = event as unknown as {
      pool: string;
      player: string;
      index: number;
      class: number;
      pass_asset: string;
    };
    if (e.player !== player) continue;
    if (e.class < 0 || e.class > 4) return null;
    return {
      pool: e.pool,
      entryIndex: e.index,
      class: e.class as RevealClass,
      passAsset: e.pass_asset,
    };
  }
  return null;
}
