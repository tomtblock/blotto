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
    // committed 1 | winners 512 | paid_mask 2 | ...
    const winners: string[] = [];
    const committed = d[183] !== 0;
    if (committed) {
      for (let i = 0; i < 16; i++) {
        winners.push(new PublicKey(d.subarray(184 + i * 32, 184 + (i + 1) * 32)).toBase58());
      }
    }
    return {
      poolId,
      state: STATE_NAMES[d[43]],
      entryLamports: d.readBigUInt64LE(17),
      fillDeadline: BigInt(d.readBigInt64LE(35)),
      secretRevealed: d[150] !== 0,
      resultsCommitted: committed,
      paidMask: d.readUInt16LE(696),
      winners,
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

  async commitResults(poolId: bigint, root: Uint8Array, winners: string[]): Promise<void> {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const winnerBytes = Buffer.concat(winners.map((w) => new PublicKey(w).toBuffer()));
    await this.send([
      new TransactionInstruction({
        programId: this.cfg.programId,
        keys: [
          { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: this.configPda(), isSigner: false, isWritable: false },
          { pubkey: this.poolPda(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('commit_results'), le, Buffer.from(root), winnerBytes]),
      }),
    ]);
  }

  async payPrizes(poolId: bigint, ranks: number[]): Promise<void> {
    const pool = await this.getPool(poolId);
    if (!pool.resultsCommitted) throw new Error('results not committed');
    const poolKey = this.poolPda(poolId);
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(poolId);
    const data = Buffer.concat([
      disc('pay_prizes'),
      le,
      (() => {
        const v = Buffer.alloc(4 + ranks.length);
        v.writeUInt32LE(ranks.length);
        Buffer.from(ranks).copy(v, 4);
        return v;
      })(),
    ]);
    const keys = [
      { pubkey: this.cfg.settlementSigner.publicKey, isSigner: true, isWritable: false },
      { pubkey: this.configPda(), isSigner: false, isWritable: false },
      { pubkey: poolKey, isSigner: false, isWritable: true },
      { pubkey: this.vaultPda(poolId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    for (const rank of ranks) {
      const winner = new PublicKey(pool.winners[rank - 1]);
      keys.push({ pubkey: winner, isSigner: false, isWritable: true });
      keys.push({ pubkey: this.entryPda(poolKey, winner), isSigner: false, isWritable: true });
    }
    await this.send([
      new TransactionInstruction({ programId: this.cfg.programId, keys, data }),
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
