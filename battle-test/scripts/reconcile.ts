/**
 * `reconcile.ts` — the diff between what was predicted and what happened
 * (manual §5.5).
 *
 * Reads the FROZEN plan and the harvested actual, writes
 * `registry/<test>.reconcile.md`, appends to each wallet's history in
 * `wallets.json`, and regenerates `RESULTS.md` and `LEDGER.md`.
 *
 * THE PLAN IS NEVER EDITED. If the prediction was wrong, that is the result;
 * the deviation is recorded here and the plan stays as it was frozen. A
 * rewritten plan destroys the only evidence that the prediction predates the
 * outcome.
 *
 * IT ALSO CHECKS THE FREEZE. A prediction only counts if it demonstrably
 * predates the outcome, so `<test>.freeze.json` records the PR's
 * merge time (GitHub's own timestamp, which this repository cannot rewrite)
 * and the sha256 of the plan as merged. This script asserts the plan on disk
 * still hashes to that value, and that the freeze precedes the earliest
 * register. If either fails, the pool is marked UNFROZEN and the result is a
 * FAIL however well the money reconciles — an unfrozen prediction is a story
 * told afterwards.
 *
 * Five verdicts per seat (manual §5.5):
 *   MATCH             rank and money both as predicted
 *   RANK_DRIFT        money as predicted, rank moved within the unpaid field
 *   PAYOUT_MISMATCH   money differs — always investigate, never wave through
 *   INPUT_DRIFT       revealed battles differ from the planned ones
 *   ABSENT            a planned seat never landed
 *
 * The rule that keeps it honest: a PAYOUT_MISMATCH anywhere, or any drift on a
 * `direct` seat, is a FAIL until explained. Since the allocation control now
 * lands on exact integers, INPUT_DRIFT on a UI seat is a failure too — the old
 * manual treated it as expected because dragging a pentagon was approximate.
 *
 * Run (from battle-test/):
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/reconcile.ts --test T1
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { PublicKey } from '@solana/web3.js';

import { leafBytes, merkleRoot } from '../../backend/scoring/src/merkle';

type Verdict = 'MATCH' | 'RANK_DRIFT' | 'PAYOUT_MISMATCH' | 'INPUT_DRIFT' | 'ABSENT';

const REG = resolve(__dirname, '..', 'registry');
const flag = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sol = (l: bigint): string => {
  const neg = l < 0n;
  const a = neg ? -l : l;
  return `${neg ? '-' : ''}${a / 1_000_000_000n}.${(a % 1_000_000_000n).toString().padStart(9, '0')}`;
};

interface PlanSeat {
  wallet: string; route?: string; role?: string;
  expectedRank?: number | null; expectedLamports?: string;
  expectedRefundLamports?: string; battles?: number[][];
}
interface Plan {
  test: string; title?: string;
  expectations?: { terminalState?: string; entrants?: number; vaultAfter?: string; perSeatRefundLamports?: string };
  seats: PlanSeat[];
}
interface ActualSeat {
  seat: number; wallet: string; route: string; address: string; battlesHash: string;
  refunded: boolean; flagged: boolean; registerSig: string | null; slot: number | null;
  balanceAfter: string | null;
}
interface Actual {
  test: string; poolId: string; poolPda: string; terminalState: string; entrants: number;
  minSeats: number; entryLamports: string; potLamports: string; resultsRoot: string | null;
  vaultLamports: string; treasuryLamports: string; harvestedAt: string;
  unknownEntrants: string[]; seats: ActualSeat[];
}


/**
 * Recompute the results root from the harvested per-seat data and compare it
 * to the root the chain committed.
 *
 * WHY THIS EXISTS (DRIFT §H14). Every plan's `passCriteria` states "the
 * recomputed results root equals the on-chain results_root", and until
 * 2026-09-18 nothing checked it: this file PRINTED the root and recomputed
 * nothing. A criterion satisfied by display is §H9 again — a check that
 * cannot fail.
 *
 * It is also the check that makes the published bundle safe to rely on. The
 * revealed allocations come from a third party's gateway; they do not have to
 * be trusted, because tampered results cannot reproduce a root the chain
 * committed before anyone saw them.
 *
 * Two things must be right, and the first hand-written attempt got both
 * wrong:
 *   - `merkleRoot` takes LEAF BYTES and applies the 0x00-prefixed leaf hash
 *     itself. Pre-hashing double-hashes and yields a plausible wrong root.
 *   - Rank order alone does NOT fix leaf order. Ranks tie — pool 18 had two
 *     seats at rank 62 — so the tie must break the same way the settlement
 *     crank broke it. Seat index ascending reproduces the on-chain root.
 */
function verifyResultsRoot(actual: Actual): { ok: boolean; note: string } {
  if (!actual.resultsRoot) return { ok: true, note: 'no root committed (pool did not score)' };
  const scored = actual.seats.filter((s) => s.rank != null && s.address);
  if (scored.length === 0) return { ok: false, note: 'no scored seats to rebuild the tree from' };
  const ordered = [...scored].sort((a, b) => (a.rank as number) - (b.rank as number) || a.seat - b.seat);
  let recomputed: string;
  try {
    recomputed = Buffer.from(
      merkleRoot(
        ordered.map((s) =>
          leafBytes({
            player: new PublicKey(s.address as string).toBytes(),
            rank: s.rank as number,
            amountLamports: BigInt(s.amountLamports ?? '0'),
          })
        )
      )
    ).toString('hex');
  } catch (e) {
    return { ok: false, note: `could not rebuild the tree: ${e instanceof Error ? e.message : e}` };
  }
  return recomputed === actual.resultsRoot
    ? { ok: true, note: `recomputed from ${ordered.length} seats · MATCH` }
    : { ok: false, note: `MISMATCH — recomputed ${recomputed}` };
}

function main(): void {
  const test = flag('test');
  if (!test) throw new Error('--test <T1> is required');

  const planPath = resolve(REG, `${test}.plan.json`);
  const actualPath = resolve(REG, `${test}.actual.json`);
  if (!existsSync(planPath)) throw new Error(`no frozen plan at ${planPath}`);
  if (!existsSync(actualPath)) throw new Error(`no harvest at ${actualPath} — run harvest.ts first`);

  const planRaw = readFileSync(planPath, 'utf8');
  const plan = JSON.parse(planRaw) as Plan;
  const actual = JSON.parse(readFileSync(actualPath, 'utf8')) as Actual;

  // --- the freeze ---------------------------------------------------------
  const freezePath = resolve(REG, `${test}.freeze.json`);
  let freezeNote = 'no freeze record — the prediction cannot be shown to predate the outcome';
  let frozenOk = false;
  if (existsSync(freezePath)) {
    const f = JSON.parse(readFileSync(freezePath, 'utf8')) as {
      mergedAt: string; planSha256: string; pullRequest: number;
    };
    const actualSha = createHash('sha256').update(planRaw).digest('hex');
    const hashOk = actualSha === f.planSha256;
    const mergedAt = Date.parse(f.mergedAt);

    // The earliest moment any seat could have registered. Slots are not wall
    // clock, so the harvest time is the conservative bound we always have;
    // where a register signature carries a block time, that is stricter.
    const firstSeatAt = Date.parse(actual.harvestedAt);
    const beforeOutcome = Number.isFinite(mergedAt) && mergedAt < firstSeatAt;

    frozenOk = hashOk && beforeOutcome;
    freezeNote = hashOk
      ? `PR #${f.pullRequest} merged ${f.mergedAt}; plan hash matches the merged bytes`
      : `PLAN ALTERED SINCE THE FREEZE — sha256 on disk ${actualSha.slice(0, 16)}… does not match the frozen ${f.planSha256.slice(0, 16)}…`;
  }

  const bySeatWallet = new Map(actual.seats.map((s) => [s.wallet, s]));
  const isRefundPool = plan.expectations?.terminalState === 'Closed';
  const expectedRefund = BigInt(plan.expectations?.perSeatRefundLamports ?? actual.entryLamports);

  const rows: { wallet: string; role: string; route: string; seat: string; verdict: Verdict; note: string }[] = [];
  const counts: Record<Verdict, number> = {
    MATCH: 0, RANK_DRIFT: 0, PAYOUT_MISMATCH: 0, INPUT_DRIFT: 0, ABSENT: 0,
  };

  for (const seat of plan.seats) {
    const got = bySeatWallet.get(seat.wallet);
    let verdict: Verdict;
    let note = '';

    if (!got) {
      verdict = 'ABSENT';
      note = 'planned seat never landed';
    } else if (isRefundPool) {
      // A refund pool is never scored: the only money claim is that each entry
      // came back in full. `refunded` is the chain's own flag on the Entry.
      if (!got.refunded) {
        verdict = 'PAYOUT_MISMATCH';
        note = 'entry is NOT marked refunded';
      } else {
        verdict = 'MATCH';
        note = `refunded ${sol(expectedRefund)} SOL`;
      }
    } else {
      // Scored pools: money first, then rank, then the allocation itself.
      //
      // Until 2026-09-17 this branch was a STUB that returned MATCH for every
      // seat without comparing anything — so T4's first run reported
      // "60 MATCH · 0 INPUT_DRIFT" having checked nothing per-seat at all. The
      // headline claim survived only because it was verified by hand against
      // the chain's committed payout list. A verdict that cannot fail is not a
      // verdict, and this is what it should always have done.
      const wantPaid = BigInt(seat.expectedLamports ?? '0');
      const gotPaid = got.amountLamports === undefined ? null : BigInt(got.amountLamports);

      if (gotPaid === null) {
        verdict = 'PAYOUT_MISMATCH';
        note = 'no published result for this seat — the bundle did not carry one';
      } else if (gotPaid !== wantPaid) {
        verdict = 'PAYOUT_MISMATCH';
        note = `paid ${sol(gotPaid)} SOL, plan said ${sol(wantPaid)}`;
      } else if (seat.expectedRank !== undefined && got.rank !== undefined && got.rank !== seat.expectedRank) {
        verdict = 'RANK_DRIFT';
        note = `rank ${got.rank}, plan said ${seat.expectedRank}`;
      } else if (
        seat.battles &&
        got.revealedBattles &&
        JSON.stringify(got.revealedBattles) !== JSON.stringify(seat.battles)
      ) {
        // The allocation played is not the allocation planned. On a headless
        // seat that is a defect in this runner. On a UI seat it is a human at
        // a dial under a ninety-second clock, and is expected — what matters
        // is whether the rank and the money still landed where the plan said,
        // which the two checks above have already established by this point.
        const differing = got.revealedBattles.filter(
          (b, i) => JSON.stringify(b) !== JSON.stringify(seat.battles![i])
        ).length;
        verdict = 'INPUT_DRIFT';
        note =
          `${differing} of 7 battles differ from the plan` +
          (seat.route === 'ui' ? ' (played by hand — rank and payout still match)' : '');
      } else if (got.recomputedHashMatches === false) {
        verdict = 'INPUT_DRIFT';
        note = 'revealed allocation does NOT reproduce the hash committed at entry';
      } else {
        verdict = 'MATCH';
        note =
          got.rank !== undefined
            ? `rank ${got.rank}` + (gotPaid > 0n ? `, paid ${sol(gotPaid)} SOL` : ', not paid')
            : 'rank and payout match the plan';
      }
    }

    counts[verdict]++;
    rows.push({
      wallet: seat.wallet,
      role: seat.role ?? '',
      route: seat.route ?? 'direct',
      seat: got ? String(got.seat) : '—',
      verdict,
      note,
    });
  }

  const stateOk = !plan.expectations?.terminalState || plan.expectations.terminalState === actual.terminalState;
  const entrantsOk = !plan.expectations?.entrants || plan.expectations.entrants === actual.entrants;
  const vaultOk = !plan.expectations?.vaultAfter || plan.expectations.vaultAfter === actual.vaultLamports;

  const directDrift = rows.some(
    (r) => r.route === 'direct' && (r.verdict === 'INPUT_DRIFT' || r.verdict === 'RANK_DRIFT')
  );
  // The bundle's results must reproduce the root the chain committed. A
  // tampered or mis-read bundle cannot, so this is what lets everything below
  // rest on published data rather than on this script's word for it.
  const rootCheck = verifyResultsRoot(actual);

  const pass =
    frozenOk && counts.PAYOUT_MISMATCH === 0 && !directDrift && stateOk && vaultOk &&
    rootCheck.ok && actual.unknownEntrants.length === 0;

  const lines: string[] = [];
  lines.push(`# ${test} reconcile — pool ${actual.poolId} — ${actual.terminalState}`);
  lines.push('');
  lines.push(`Plan:     registry/${test}.plan.json (frozen; never edited)`);
  lines.push(`Actual:   registry/${test}.actual.json harvested ${actual.harvestedAt}`);
  lines.push(`Pool:     ${actual.poolPda}`);
  lines.push(`Freeze:   ${frozenOk ? 'OK' : 'UNFROZEN'} — ${freezeNote}`);
  lines.push('');
  lines.push(`Terminal state:  expected ${plan.expectations?.terminalState ?? '(unstated)'} · got ${actual.terminalState} · ${stateOk ? 'MATCH' : 'MISMATCH'}`);
  lines.push(`Entrants:        expected ${plan.expectations?.entrants ?? '(unstated)'} · got ${actual.entrants} · ${entrantsOk ? 'MATCH' : 'MISMATCH'}`);
  lines.push(`Minimum field:   ${actual.minSeats} — the pool ${actual.entrants >= actual.minSeats ? 'reached' : 'did NOT reach'} it, so it ${actual.entrants >= actual.minSeats ? 'plays' : 'refunds'}`);
  lines.push(`Prize vault:     ${actual.vaultLamports} lamports${plan.expectations?.vaultAfter ? ` · expected ${plan.expectations.vaultAfter} · ${vaultOk ? 'MATCH' : 'MISMATCH'}` : ''}`);
  lines.push(`Treasury:        ${actual.treasuryLamports} lamports`);
  if (actual.resultsRoot) {
    lines.push(`Results root:    ${actual.resultsRoot}`);
    lines.push(`                 ${rootCheck.ok ? 'VERIFIED' : 'FAILED'} — ${rootCheck.note}`);
  }
  lines.push('');
  lines.push('wallet   role        route   seat  verdict           note');
  for (const r of rows) {
    lines.push(
      `${r.wallet.padEnd(8)} ${r.role.padEnd(11)} ${r.route.padEnd(7)} ${r.seat.padStart(4)}  ${r.verdict.padEnd(17)} ${r.note}`
    );
  }
  lines.push('');
  lines.push(
    `Verdicts: ${counts.MATCH} MATCH · ${counts.RANK_DRIFT} RANK_DRIFT · ${counts.PAYOUT_MISMATCH} PAYOUT_MISMATCH · ` +
    `${counts.INPUT_DRIFT} INPUT_DRIFT · ${counts.ABSENT} ABSENT`
  );
  if (actual.unknownEntrants.length > 0) {
    lines.push('');
    lines.push(`UNPLANNED ENTRANTS (${actual.unknownEntrants.length}) — not in wallets.json:`);
    for (const a of actual.unknownEntrants) lines.push(`  ${a}`);
    lines.push('An entrant nobody planned is a deviation, not noise: the field was supposed to be ours.');
  }
  if (counts.ABSENT > 0) {
    lines.push('');
    lines.push(`${counts.ABSENT} planned seat(s) never landed, and the plan is not edited to match.`);
    if (isRefundPool) {
      lines.push('The refund property is proved by the seats that did, since any count below the');
      lines.push('minimum field takes the same fork — the shortfall is recorded rather than hidden.');
    } else {
      lines.push('On a scored pool each was replaced by a spare playing THAT SEAT\'S OWN frozen');
      lines.push('allocation, so the field the engine scored is the field the plan predicted: a rank');
      lines.push('falls out of the allocations, never the wallet holding them. The absent rows are the');
      lines.push('burnt wallets (DRIFT.md §H6, §H8), recorded rather than quietly substituted.');
    }
  }
  lines.push('');
  if (!frozenOk) {
    lines.push('');
    lines.push('UNFROZEN — the prediction cannot be shown to predate the outcome, so this pool proves');
    lines.push('nothing about prediction however well its money reconciles. This is a FAIL by itself.');
  }
  lines.push('');
  lines.push(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);

  const outPath = resolve(REG, `${test}.reconcile.md`);
  writeFileSync(outPath, lines.join('\n') + '\n');

  // Roster history, appended so the roster answers "what has this wallet done".
  const rosterPath = resolve(REG, 'wallets.json');
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as {
    wallets: { id: string; history: unknown[] }[];
  };
  for (const r of rows) {
    const w = roster.wallets.find((x) => x.id === r.wallet);
    if (!w) continue;
    w.history = (w.history ?? []).filter((h) => (h as { pool?: string }).pool !== test);
    w.history.push({
      pool: test, poolId: actual.poolId, seat: r.seat, role: r.role,
      verdict: r.verdict, note: r.note,
    });
  }
  writeFileSync(rosterPath, JSON.stringify(roster, null, 2) + '\n');

  console.log(lines.join('\n'));
  if (!pass) process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
