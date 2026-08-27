/**
 * `Web3Chain` — the production `SettlementChain` over `@solana/web3.js`.
 *
 * Instruction bytes are hand-encoded against the program's wire contract
 * (Anchor global discriminators + Borsh args + the exact account orders in
 * `programs/blotto_cup/src/instructions/`), the same encoding the LiteSVM
 * suite drives the artifact with — those tests are what pin this file's
 * correctness. Account layouts are read by the byte offsets asserted in
 * `state.rs` size tests.
 *
 * Exercised for real on devnet in the Phase 5 rehearsal (the offline crank
 * suite runs on `FakeChain`).
 */

import { createHash } from 'crypto';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type {
  ChainEntryView,
  ChainPoolView,
  CommittedPayout,
  PoolStateName,
  SettlementChain,
} from './chain';

const STATE_NAMES: PoolStateName[] = ['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'];

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export interface Web3ChainConfig {
  connection: Connection;
  programId: PublicKey;
  /** Signs reveal / commit / pay — the settlement signer (Turnkey-backed in prod). */
  settlementSigner: Keypair;
}

export class Web3Chain implements SettlementChain {
  constructor(private readonly cfg: Web3ChainConfig) {}

  private pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds as Buffer[], this.cfg.programId)[0];
  }
  private poolPda(id: bigint): PublicKey {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(id);
    return this.pda([Buffer.from('pool'), le]);
  }
  private vaultPda(id: bigint): PublicKey {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(id);
    return this.pda([Buffer.from('vault'), le]);
  }
  private configPda(): PublicKey {
    return this.pda([Buffer.from('config')]);
  }
  private entryPda(pool: PublicKey, player: PublicKey): PublicKey {
    return this.pda([Buffer.from('entry'), pool.toBuffer(), player.toBuffer()]);
  }

  private async send(ixs: TransactionInstruction[]): Promise<void> {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...ixs
    );
    await sendAndConfirmTransaction(this.cfg.connection, tx, [this.cfg.settlementSigner], {
      commitment: 'confirmed',
    });
  }

  async getPool(poolId: bigint): Promise<ChainPoolView> {
    const info = await this.cfg.connection.getAccountInfo(this.poolPda(poolId), 'confirmed');
    if (!info) throw new Error(`pool ${poolId} account not found`);
    const d = info.data;
    // Offsets mirror state.rs (asserted by its serialize-LEN tests and the
    // LiteSVM readers): disc 8 | id 8 | tier 1 | entry_lamports 8 |
    // entrants 2 | opened_at 8 | fill_deadline 8 | state 1 | sealing 32 |
    // hash 32 | vrf 32 | counters 10 | secret_revealed 1 | root 32 |
    // committed 1 | payouts_len 2 | payouts 64×(seat 2 + amount 8) |
    // paid_mask 8 | ...
    const committed = d[183] !== 0;
    const payouts: CommittedPayout[] = [];
    if (committed) {
      const len = d.readUInt16LE(184);
      for (let i = 0; i < len; i++) {
        const off = 186 + i * 10;
        payouts.push({
          entryIndex: d.readUInt16LE(off),
          amountLamports: d.readBigUInt64LE(off + 2),
        });
      }
    }
    return {
      poolId,
      state: STATE_NAMES[d[43]],
      entryLamports: d.readBigUInt64LE(17),
      fillDeadline: BigInt(d.readBigInt64LE(35)),
      secretRevealed: d[150] !== 0,
      resultsCommitted: committed,
      paidMask: d.readBigUInt64LE(826),
      payouts,
      entrants: d.readUInt16LE(25),
    };
  }

  async getEntries(poolId: bigint): Promise<ChainEntryView[]> {
    const pool = this.poolPda(poolId);
    // Entry layout: disc 8 | pool 32 | player 32 | index 2 | battles_hash 32
    // | class 1 | pass_asset 32 | entered_at 8 | slot_hash 32 | flagged 1 |
    // settled 1 | refunded 1 | escrow 8 | bump 1.
    const accounts = await this.cfg.connection.getProgramAccounts(this.cfg.programId, {
      commitment: 'confirmed',
      filters: [
        { dataSize: 8 + 32 + 32 + 2 + 32 + 1 + 32 + 8 + 32 + 1 + 1 + 1 + 8 + 1 },
        { memcmp: { offset: 8, bytes: pool.toBase58() } },
      ],
    });
    return accounts
      .map(({ account }) => {
        const d = account.data;
        return {
          player: new PublicKey(d.subarray(40, 72)).toBase58(),
          index: d.readUInt16LE(72),
          battlesHash: d.subarray(74, 106).toString('hex'),
          flagged: d[179] !== 0,
          refunded: d[181] !== 0,
        };
      })
      .sort((a, b) => a.index - b.index);
  }

  async revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('reveal_pool_secret'), le, Buffer.from(secret)]),
      }),
    ]);
  }

  async commitResults(poolId: bigint, root: Uint8Array, payouts: CommittedPayout[]): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Borsh Vec<Payout { entry_index: u16, amount: u64 }>.
    const list = Buffer.alloc(4 + payouts.length * 10);
    list.writeUInt32LE(payouts.length);
    payouts.forEach((p, i) => {
      list.writeUInt16LE(p.entryIndex, 4 + i * 10);
      list.writeBigUInt64LE(p.amountLamports, 4 + i * 10 + 2);
    });
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('commit_results'), le, Buffer.from(root), list]),
      }),
    ]);
  }

  async payPrizes(poolId: bigint, seats: number[]): Promise<void> {
    const pool = await this.getPool(poolId);
    if (!pool.resultsCommitted) throw new Error('results not committed');
    // The Entry accounts are the on-chain seat→player map; resolve each
    // seat's wallet from them (the program re-checks the binding).
    const entries = await this.getEntries(poolId);
    const walletBySeat = new Map(entries.map((e) => [e.index, e.player]));
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    // Borsh Vec<u16>.
    const list = Buffer.alloc(4 + seats.length * 2);
    list.writeUInt32LE(seats.length);
    seats.forEach((s, i) => list.writeUInt16LE(s, 4 + i * 2));
    const data = Buffer.concat([disc('pay_prizes'), le, list]);
    const keys = [
      { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
      { pubkey: this.configPda(), isSigner: false, isWritable: false },
      { pubkey: poolKey, isSigner: false, isWritable: true },
      { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    for (const seat of seats) {
      const player = walletBySeat.get(seat);
      if (!player) throw new Error(`no entry for seat ${seat} in pool ${poolId}`);
      const wallet = new PublicKey(player);
      keys.push({ pubkey: wallet, isSigner: false, isWritable: true });
      keys.push({ pubkey: this.entryPda(poolKey, wallet), isSigner: false, isWritable: true });
    }
    await this.send([
      new TransactionInstruction({ programId: this.cfg.programId, keys, data }),
    ]);
  }

  async flagEntry(poolId: bigint, player: string): Promise<void> {
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: poolKey, isSigner: false, isWritable: false },
          { pubkey: this.entryPda(poolKey, new PublicKey(player)), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('flag_entry'), le]),
      }),
    ]);
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: true },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('trigger_refund'), le]),
      }),
    ]);
  }

  async refund(poolId: bigint, player: string): Promise<void> {
    const poolKey = this.poolPda(poolId);
    const playerKey = new PublicKey(player);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const feesPda = this.pda([Buffer.from('fees'), le]);
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: poolKey, isSigner: false, isWritable: true },
          { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
          { pubkey: feesPda, isSigner: false, isWritable: true },
          { pubkey: this.entryPda(poolKey, playerKey), isSigner: false, isWritable: true },
          { pubkey: playerKey, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('refund'), le]),
      }),
    ]);
  }
}
