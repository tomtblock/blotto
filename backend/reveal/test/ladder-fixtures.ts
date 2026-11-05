/**
 * Shared fixtures for the Ladder (D-E19) across the reveal specs.
 *
 * Every number here comes from the published tables in `@blotto/scoring`
 * (`LADDER_TABLES`, `MIN_FIELD_BY_CAPACITY`, `TIER_ENTRY_LAMPORTS`) or from
 * the program's own migration rule for a pre-Ladder pool — none is typed.
 */
import { FakeChain, type ChainPoolView } from '../src';
import {
  MAX_PAID_PLACES,
  TIER_ENTRY_LAMPORTS,
  ladderTable,
  minFieldFor,
  prizePoolFor,
} from '../../scoring/src';

/** The launch posture's eight pool types: both modes × the four sizes. */
export const LAUNCH_CAPACITIES = [8, 16, 32, 64] as const;

/** A table in its on-chain form: `[u8; 16]`, zero-padded. */
export function rawTable(table: readonly number[]): number[] {
  const raw = new Array<number>(MAX_PAID_PLACES).fill(0);
  table.forEach((m, i) => (raw[i] = m));
  return raw;
}

/** The `initConfig` arguments every spec uses (ceilings at 64 entries). */
export function configArgs(treasuryMinPlatformLamports = 0n) {
  return {
    entrySigner: 'entry',
    settlementSigner: 'settle',
    keeper: 'settle',
    vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
    treasuryMinPlatformLamports,
  };
}

/**
 * A FakeChain with Config initialised and the given pool types created,
 * priced at the launch economics and enabled (`addPoolType`). The default is
 * the one type most settlement specs need: easy, tier 0, 64 players — the
 * account `pay_prizes` / `trigger_refund` / `refund` name for such a pool.
 */
export async function ladderChain(
  now: () => bigint = () => 0n,
  types: ReadonlyArray<readonly [mode: number, tier: number, capacity: number]> = [[0, 0, 64]],
  treasuryMinPlatformLamports = 0n
): Promise<FakeChain> {
  const chain = new FakeChain(now);
  await chain.initConfig(configArgs(treasuryMinPlatformLamports));
  for (const [mode, tier, capacity] of types) chain.addPoolType(mode, tier, capacity);
  return chain;
}

/**
 * A Ladder pool's view for direct injection (`chain.pools.set`), Sealed and
 * full by default: easy, tier 0, 64 players, the launch table at the tier's
 * price — exactly what `openPool` would have copied from its pool type.
 */
export function ladderPoolView(over: Partial<ChainPoolView> = {}): ChainPoolView {
  const capacity = over.capacity ?? 64;
  const tier = over.tier ?? 0;
  const entryLamports = over.entryLamports ?? TIER_ENTRY_LAMPORTS[tier];
  const table = ladderTable(capacity);
  return {
    poolId: 1n,
    tier,
    state: 'Sealed',
    resultsRootHex: null,
    vrfCommitted: true,
    entryLamports,
    potLamports: prizePoolFor(table, entryLamports),
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0n,
    payouts: [],
    entrants: capacity,
    mode: 0,
    capacity,
    minSeats: minFieldFor(capacity),
    paidPlaces: table.length,
    prizeTable: rawTable(table),
    ...over,
  };
}

/**
 * Rewrite a pool's terms as `migrate_pool` records a PRE-Ladder pool
 * (`instructions/migrate.rs::pre_ladder_table`, mirrored by
 * `preLadderTable` in `_shared/src/pool-account.ts`): 64 seats and ONE paid
 * place worth the whole prize pool, in whole entries. The single-place rule
 * `pay_next_place` still serves — every pool opened before the Ladder.
 */
export function makePreLadder(pool: ChainPoolView): void {
  if (pool.potLamports % pool.entryLamports !== 0n) {
    throw new Error('fixture: a pre-Ladder pool here must hold a whole number of entries');
  }
  pool.capacity = 64;
  pool.paidPlaces = 1;
  pool.prizeTable = rawTable([Number(pool.potLamports / pool.entryLamports)]);
}
