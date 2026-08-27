/**
 * The crank's on-chain seam. `SettlementChain` is everything 2.4 needs from
 * the cluster; `FakeChain` mirrors the program's state machine for offline
 * tests; `Web3Chain` (chain-web3.ts) is the real client the devnet
 * rehearsal drives.
 */

export type PoolStateName = 'Open' | 'Sealed' | 'Scored' | 'Paid' | 'Refunding' | 'Closed';

export interface ChainPoolView {
  poolId: bigint;
  state: PoolStateName;
  entryLamports: bigint;
  fillDeadline: bigint;
  secretRevealed: boolean;
  resultsCommitted: boolean;
  paidMask: number;
  /** Base58, rank order; empty until committed. */
  winners: string[];
  entrants: number;
}

export interface ChainEntryView {
  /** Base58 wallet. */
  player: string;
  index: number;
  /** Hex — what `register` committed. */
  battlesHash: string;
  flagged: boolean;
  refunded: boolean;
}

export interface SettlementChain {
  getPool(poolId: bigint): Promise<ChainPoolView>;
  getEntries(poolId: bigint): Promise<ChainEntryView[]>;
  revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void>;
  commitResults(poolId: bigint, root: Uint8Array, winners: string[]): Promise<void>;
  /** Settle a batch of ranks (1-based); accounts resolved by the implementation. */
  payPrizes(poolId: bigint, ranks: number[]): Promise<void>;
  /** Detection's lever (R11) — must land BEFORE the rank is paid. */
  flagEntry(poolId: bigint, player: string): Promise<void>;
  triggerRefund(poolId: bigint): Promise<void>;
  refund(poolId: bigint, player: string): Promise<void>;
}

/**
 * In-memory chain mirroring the program's checks — enough of the state
 * machine that a crank bug (double commit, pay before commit, wrong batch)
 * fails the same way it would on-chain.
 */
export class FakeChain implements SettlementChain {
  pools = new Map<string, ChainPoolView>();
  entries = new Map<string, ChainEntryView[]>();
  /** Lamports paid per player (base58) — asserted by tests. */
  paid = new Map<string, bigint>();
  /** Lamports escrowed per player at payout (flagged entries). */
  escrowed = new Map<string, bigint>();
  revealed = new Map<string, Uint8Array>();
  committedRoots = new Map<string, Uint8Array>();
  /** amount per rank, injected by tests via `bandAmount`. */
  constructor(private readonly bandAmount: (entry: bigint, rank: number) => bigint) {}

  async getPool(poolId: bigint): Promise<ChainPoolView> {
    const p = this.pools.get(poolId.toString());
    if (!p) throw new Error(`no pool ${poolId}`);
    return { ...p, winners: [...p.winners] };
  }

  async getEntries(poolId: bigint): Promise<ChainEntryView[]> {
    return (this.entries.get(poolId.toString()) ?? []).map((e) => ({ ...e }));
  }

  async revealPoolSecret(poolId: bigint, secret: Uint8Array): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.secretRevealed) throw new Error('SecretAlreadyRevealed');
    if (p.state === 'Open') throw new Error('PoolNotSealed');
    p.secretRevealed = true;
    this.revealed.set(poolId.toString(), secret.slice());
  }

  async commitResults(poolId: bigint, root: Uint8Array, winners: string[]): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Sealed') throw new Error('PoolNotSealed');
    if (!p.secretRevealed) throw new Error('SecretNotRevealed');
    if (p.resultsCommitted) throw new Error('ResultsAlreadyCommitted');
    if (new Set(winners).size !== winners.length) throw new Error('WinnersNotDistinct');
    p.resultsCommitted = true;
    p.winners = [...winners];
    p.state = 'Scored';
    this.committedRoots.set(poolId.toString(), root.slice());
  }

  async payPrizes(poolId: bigint, ranks: number[]): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Scored') throw new Error('ResultsNotCommitted');
    const entries = this.entries.get(poolId.toString()) ?? [];
    for (const rank of ranks) {
      const bit = 1 << (rank - 1);
      if (p.paidMask & bit) throw new Error('RankAlreadySettled');
      const player = p.winners[rank - 1];
      const amount = this.bandAmount(p.entryLamports, rank);
      const flagged = entries.find((e) => e.player === player)?.flagged ?? false;
      if (flagged) {
        // Escrowed: the lamports stay put (mirrors the program).
        this.escrowed.set(player, (this.escrowed.get(player) ?? 0n) + amount);
      } else {
        this.paid.set(player, (this.paid.get(player) ?? 0n) + amount);
      }
      p.paidMask |= bit;
    }
    if (p.paidMask === 0xffff) p.state = 'Paid';
  }

  async flagEntry(poolId: bigint, player: string): Promise<void> {
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    e.flagged = true;
  }

  async triggerRefund(poolId: bigint): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Open') throw new Error('PoolNotOpen');
    p.state = p.entrants === 0 ? 'Closed' : 'Refunding';
  }

  async refund(poolId: bigint, player: string): Promise<void> {
    const p = this.pools.get(poolId.toString())!;
    if (p.state !== 'Refunding') throw new Error('PoolNotRefunding');
    const e = (this.entries.get(poolId.toString()) ?? []).find((x) => x.player === player);
    if (!e) throw new Error('EntryMismatch');
    if (e.refunded) throw new Error('AlreadyRefunded');
    e.refunded = true;
    this.paid.set(player, (this.paid.get(player) ?? 0n) + p.entryLamports);
    if ((this.entries.get(poolId.toString()) ?? []).every((x) => x.refunded)) {
      p.state = 'Closed';
    }
  }
}
