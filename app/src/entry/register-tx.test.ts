/*
 * C9 builder specs. The Ed25519 instruction is pinned byte-for-byte against
 * the layout `entry_packet.rs` verifies (and `tests/litesvm`'s `ed25519_ix`
 * emits); the PDAs are cross-checked against @solana/web3.js — a SECOND,
 * independent implementation of findProgramAddress — so the derivation
 * cannot be self-confirming; the EntryRegistered decode runs over a log
 * line assembled with node's own crypto, not the module under test.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { AccountRole } from '@solana/kit';
import {
  ED25519_PROGRAM_ADDRESS,
  buildEd25519Instruction,
  buildRegisterInstruction,
  deriveRegisterPdas,
  entryRegisteredFromLogs,
} from './register-tx';

const PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const PLAYER = new PublicKey(createHash('sha256').update('player').digest()).toBase58();

describe('buildEd25519Instruction', () => {
  const packet = {
    message: Uint8Array.from({ length: 85 }, (_, i) => i),
    signature: Uint8Array.from({ length: 64 }, (_, i) => 100 + (i % 100)),
    publicKey: Uint8Array.from({ length: 32 }, (_, i) => 200 + (i % 50)),
  };

  it('emits the exact 16 + 32 + 64 + message layout the program verifies', () => {
    const ix = buildEd25519Instruction(packet);
    expect(ix.programAddress).toBe(ED25519_PROGRAM_ADDRESS);
    const d = ix.data!;
    expect(d.length).toBe(16 + 32 + 64 + 85);
    expect(d[0]).toBe(1); // one signature
    expect(d[1]).toBe(0); // padding
    const dv = new DataView(d.buffer, d.byteOffset);
    // sig offset, sig ix, pk offset, pk ix, msg offset, msg len, msg ix.
    const header = [48, 0xffff, 16, 0xffff, 112, 85, 0xffff];
    header.forEach((v, i) => expect(dv.getUint16(2 + i * 2, true)).toBe(v));
    expect([...d.slice(16, 48)]).toEqual([...packet.publicKey]);
    expect([...d.slice(48, 112)]).toEqual([...packet.signature]);
    expect([...d.slice(112)]).toEqual([...packet.message]);
  });

  it('refuses malformed key or signature lengths', () => {
    expect(() =>
      buildEd25519Instruction({ ...packet, publicKey: new Uint8Array(31) })
    ).toThrow(/32/);
    expect(() =>
      buildEd25519Instruction({ ...packet, signature: new Uint8Array(63) })
    ).toThrow(/64/);
  });
});

describe('deriveRegisterPdas', () => {
  it('matches @solana/web3.js findProgramAddressSync exactly', async () => {
    const poolId = 7n;
    const pdas = await deriveRegisterPdas(PROGRAM_ID, poolId, PLAYER);
    const program = new PublicKey(PROGRAM_ID);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const expectPda = (seeds: Buffer[]) =>
      PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();
    const pool = expectPda([Buffer.from('pool'), le]);
    expect(pdas.pool).toBe(pool);
    expect(pdas.config).toBe(expectPda([Buffer.from('config')]));
    expect(pdas.vault).toBe(expectPda([Buffer.from('vault'), le]));
    expect(pdas.platform).toBe(expectPda([Buffer.from('platform')]));
    expect(pdas.entry).toBe(
      expectPda([
        Buffer.from('entry'),
        new PublicKey(pool).toBuffer(),
        new PublicKey(PLAYER).toBuffer(),
      ])
    );
    expect(pdas.passCollection).toBe(
      expectPda([Buffer.from('pass_collection'), new PublicKey(pool).toBuffer()])
    );
  });
});

describe('buildRegisterInstruction', () => {
  it('encodes discriminator ‖ pool_id LE ‖ battles_hash with the 12 accounts in order', async () => {
    const poolId = 42n;
    const pdas = await deriveRegisterPdas(PROGRAM_ID, poolId, PLAYER);
    const battlesHash = Uint8Array.from({ length: 32 }, (_, i) => 50 + i);
    const passAsset = new PublicKey(createHash('sha256').update('asset').digest()).toBase58();
    const ix = buildRegisterInstruction({
      programId: PROGRAM_ID,
      poolId,
      player: PLAYER,
      passAsset,
      battlesHash,
      pdas,
    });
    // The Anchor discriminator, computed here with node crypto (not @noble).
    const disc = createHash('sha256').update('global:register').digest().subarray(0, 8);
    expect([...ix.data!.slice(0, 8)]).toEqual([...disc]);
    const dv = new DataView(ix.data!.buffer, ix.data!.byteOffset);
    expect(dv.getBigUint64(8, true)).toBe(poolId);
    expect([...ix.data!.slice(16)]).toEqual([...battlesHash]);

    const a = ix.accounts!;
    expect(a.length).toBe(12);
    expect(a[0]).toEqual({ address: PLAYER, role: AccountRole.WRITABLE_SIGNER });
    expect(a[1].address).toBe(pdas.config);
    expect(a[2].address).toBe(pdas.pool);
    // The prize vault is READ-ONLY: entries never touch it (D-A1 revised);
    // the program only asserts the pre-funded pot is present.
    expect(a[3]).toEqual({ address: pdas.vault, role: AccountRole.READONLY });
    expect(a[4].address).toBe(pdas.platform);
    expect(a[5].address).toBe(pdas.entry);
    expect(a[6].address).toBe(pdas.passCollection);
    expect(a[7]).toEqual({ address: passAsset, role: AccountRole.WRITABLE_SIGNER });
    expect(a[8].address).toBe('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
    expect(a[9].address).toBe('Sysvar1nstructions1111111111111111111111111');
    expect(a[10].address).toBe('SysvarS1otHashes111111111111111111111111111');
    expect(a[11]).toEqual({
      address: '11111111111111111111111111111111',
      role: AccountRole.READONLY,
    });
    for (const i of [1, 2, 4, 5, 6]) expect(a[i].role).toBe(AccountRole.WRITABLE);
    for (const i of [3, 8, 9, 10]) expect(a[i].role).toBe(AccountRole.READONLY);
  });
});

describe('entryRegisteredFromLogs', () => {
  /** Assemble a real `Program data:` line: event discriminator + Borsh body. */
  function entryRegisteredLog(player: string, cls: number, index: number, asset: string): string {
    const disc = createHash('sha256').update('event:EntryRegistered').digest().subarray(0, 8);
    const pool = createHash('sha256').update('pool').digest(); // 32 raw bytes
    const body = Buffer.concat([
      pool,
      new PublicKey(player).toBuffer(),
      (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(index);
        return b;
      })(),
      Buffer.alloc(32, 7), // battles_hash
      Buffer.from([cls]),
      Buffer.alloc(32, 9), // slot_hash
      new PublicKey(asset).toBuffer(),
      (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(1); // terms_version
        return b;
      })(),
    ]);
    return `Program data: ${Buffer.concat([disc, body]).toString('base64')}`;
  }

  const asset = new PublicKey(createHash('sha256').update('asset2').digest()).toBase58();

  it('finds this player’s entry and yields class, seat and pass', () => {
    const logs = ['Program log: Instruction: Register', entryRegisteredLog(PLAYER, 3, 17, asset)];
    const got = entryRegisteredFromLogs(logs, PLAYER);
    expect(got).not.toBeNull();
    expect(got!.class).toBe(3);
    expect(got!.entryIndex).toBe(17);
    expect(got!.passAsset).toBe(asset);
  });

  it('ignores another player’s event and unreadable logs', () => {
    const other = new PublicKey(createHash('sha256').update('other').digest()).toBase58();
    expect(entryRegisteredFromLogs([entryRegisteredLog(other, 1, 2, asset)], PLAYER)).toBeNull();
    expect(entryRegisteredFromLogs(['Program log: nothing'], PLAYER)).toBeNull();
    expect(entryRegisteredFromLogs([], PLAYER)).toBeNull();
  });
});
