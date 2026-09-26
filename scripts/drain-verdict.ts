/**
 * The drain verdict — what `admin.ts pools` decides after it has read the
 * chain, separated from the reading.
 *
 * WHY ITS OWN FILE. Same reasoning as `scripts/ci-gate.sh`: the live inputs
 * need a cluster, so the only way to prove the decision still refuses is to
 * drive the pure half through fixtures. Keeping it here rather than inside
 * `admin.ts` means the fixtures run with **no dependencies at all** — this
 * module imports nothing — so CI can execute it in the `standing-rules` lane
 * beside the other gates, which installs no workspace. `admin.ts` imports
 * `@solana/web3.js` and is not loadable there.
 *
 * A gate that cannot fail is not a gate.
 *
 * Run the fixtures:  npx tsx scripts/drain-verdict.ts --self-test
 * Operators use the familiar command instead — `admin.ts pools --self-test`
 * calls straight through to `selfTestDrainVerdict` below.
 */

/** The six `PoolState` variants, in the program's own discriminant order
 * (`programs/blotto_cup/src/state.rs`). Re-declared rather than imported so
 * this module stays dependency-free; `admin.ts` holds the byte offsets that
 * map a raw account to one of these. */
export const POOL_STATES = [
  'Open',
  'Sealed',
  'Scored',
  'Paid',
  'Refunding',
  'Closed',
] as const;

/**
 * States in which a pool is mid-settlement — the drain gate of the D-E2/D-E4
 * runbook section (proposal E1 §8): no upgrade or backend deploy while any
 * pool sits here, because the prize rule is enforced by the engine that
 * settles it.
 *
 * `Open` is deliberately NOT in this set, and must not be added to it: the
 * whole justification for `Pool.min_seats` is that an upgrade CAN land while a
 * pool is taking entries, so the floor is carried per pool rather than read
 * from a constant. Widening this set would quietly retire that reasoning. The
 * open-pool refusal is a separate, opt-in verdict — see `drainVerdict`.
 */
export const MID_SETTLEMENT = new Set(['Sealed', 'Scored', 'Refunding']);

export interface PoolRow {
  id: bigint;
  state: string;
}

export interface Verdict {
  lines: string[];
  blocked: boolean;
}

/**
 * TWO VERDICTS, not one widened verdict:
 *
 *   drain    — mid-settlement pools. Always checked. Blocks an upgrade OR a
 *              backend deploy, because the prize rule is enforced by the
 *              engine that settles them.
 *   upgrade  — open pools. Checked only with `--upgrade-preflight`, because a
 *              pool is Open almost always and `pools` is the ordinary status
 *              command; a permanent non-zero exit would make it useless.
 *
 * WHY THE SECOND ONE EXISTS (R7-b, 2026-09-13). A pool open across the program
 * upgrade keeps the floor it opened under — 52, written by `migrate_pool` —
 * while `backend/indexer/src/read-api.ts` serves the shared constant, 40. Such
 * a pool sitting between the two numbers at its deadline would be shown "this
 * pool will play" and would refund instead. Upgrading only when no pool is
 * Open makes every live pool's floor equal the constant, which is what makes
 * that read honest. The durable fix is to carry each pool's floor through
 * `PoolOpened` so the site never has to assume; until then this refusal is the
 * guarantee, and the read API's comment names it.
 */
export function drainVerdict(rows: readonly PoolRow[], upgradePreflight: boolean): Verdict {
  const settling = rows.filter((r) => MID_SETTLEMENT.has(r.state)).map((r) => r.id);
  const open = rows.filter((r) => r.state === 'Open').map((r) => r.id);
  const lines: string[] = [];

  lines.push(
    settling.length === 0
      ? 'drain: CLEAR — no pool is Sealed, Scored or Refunding'
      : `drain: BLOCKED — mid-settlement pool ids: ${settling.join(', ')}`
  );

  if (upgradePreflight) {
    lines.push(
      open.length === 0
        ? 'upgrade: CLEAR — no pool is taking entries'
        : `upgrade: BLOCKED — taking entries, pool ids: ${open.join(', ')}. ` +
            'A pool open across the upgrade keeps the floor it opened with, ' +
            'which the site does not read. Wait for it to close, stop the ' +
            'daemon so the next one cannot open, then re-run. ' +
            'docs/guide/OPERATING-MANUAL.md'
    );
  }

  return { lines, blocked: settling.length > 0 || (upgradePreflight && open.length > 0) };
}

/** Fixtures. Both verdicts, both ways, and the two cases that matter most: an
 * Open pool must NOT block the default command, and MUST block the pre-flight.
 * Returns a process exit code. */
export function selfTestDrainVerdict(): number {
  const row = (id: number, state: string): PoolRow => ({ id: BigInt(id), state });
  const cases: Array<[string, readonly PoolRow[], boolean, boolean]> = [
    ['empty, default', [], false, false],
    ['empty, preflight', [], true, false],
    ['all terminal, default', [row(1, 'Closed'), row(2, 'Paid')], false, false],
    ['all terminal, preflight', [row(1, 'Closed'), row(2, 'Paid')], true, false],
    // The live shape on devnet: terminal pools and one taking entries.
    ['one Open, default — must NOT block', [row(1, 'Closed'), row(10, 'Open')], false, false],
    ['one Open, preflight — MUST block', [row(1, 'Closed'), row(10, 'Open')], true, true],
    ['Sealed blocks both', [row(3, 'Sealed')], false, true],
    ['Scored blocks both', [row(4, 'Scored')], false, true],
    ['Refunding blocks both', [row(5, 'Refunding')], false, true],
    ['Sealed blocks the pre-flight too', [row(3, 'Sealed')], true, true],
    ['both kinds at once', [row(3, 'Sealed'), row(10, 'Open')], true, true],
  ];
  const failures: string[] = [];
  for (const [name, rows, preflight, want] of cases) {
    const got = drainVerdict(rows, preflight).blocked;
    if (got !== want) failures.push(`  ${name}: expected blocked=${want}, got ${got}`);
  }
  // The default verdict must never mention an upgrade, or an operator reading
  // the status command would think it had checked one.
  const quiet = drainVerdict([row(10, 'Open')], false);
  if (quiet.lines.some((l) => l.startsWith('upgrade:'))) {
    failures.push('  default mode printed an upgrade verdict it did not check');
  }
  // Every state the program can hold must be classified, or a new variant
  // would silently fall through as "not blocking".
  for (const state of POOL_STATES) {
    const v = drainVerdict([row(1, state)], true);
    const expected = state === 'Open' || MID_SETTLEMENT.has(state);
    if (v.blocked !== expected) {
      failures.push(`  state ${state}: expected blocked=${expected}, got ${v.blocked}`);
    }
  }
  if (failures.length > 0) {
    console.error(`pools self-test FAILED:\n${failures.join('\n')}`);
    return 2;
  }
  console.log(
    `pools self-test passed: ${cases.length} verdicts and ${POOL_STATES.length} states correct ` +
      `(${cases.filter((c) => c[3]).length} of them refusals)`
  );
  return 0;
}

// Run directly (CI's standing-rules lane) rather than through admin.ts, which
// needs @solana/web3.js and a workspace install this lane does not do.
if (process.argv[2] === '--self-test') {
  process.exit(selfTestDrainVerdict());
}
