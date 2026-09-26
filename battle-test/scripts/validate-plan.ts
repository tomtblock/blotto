/**
 * Plan validation — the gate that makes a freeze mean something (manual §5.5).
 *
 * A prediction is only evidence if it is (a) well formed, (b) internally
 * consistent, and (c) reproducible by someone who does not trust us. This
 * script is (a) and (b); the oracle re-run in CI is (c).
 *
 * Checks, and why each one exists:
 *
 *   - every allocation is five non-negative integers summing to exactly 100
 *     in the fixed stat order — the invariant the program cannot enforce
 *     (CLAUDE.md), so it is enforced here and at the submission boundary;
 *   - no two entrants share an identical seven-battle set, UNLESS the plan
 *     declares the pair in `intentionalDuplicateSets` and says why. An
 *     identical pair is the `duplicate_sets` signal at severity `strong`
 *     (`detection/src/signals.ts`) and puts both players in the report's
 *     `hardBlocks` list — which under ruling D-E9 is REPORTED AND READ BY NO
 *     CODE THAT MOVES ANYTHING (`detection/src/pipeline.ts`). Earlier copies
 *     of this header called it "the one allocation signal that hard-blocks",
 *     and T7's research showed that is not true of the system as built:
 *     nothing blocks, and detection runs at reveal, long after the entry it
 *     would have refused. The check stays a default because an ACCIDENTAL
 *     duplicate is still a plan bug; a declared one is a test of the policy;
 *   - at least three distinct shapes per entrant — `allocation_entropy`
 *     fires "strong" at two or fewer, and the evidence should be clean;
 *   - every wallet exists in `wallets.json`, and no wallet appears twice in
 *     one pool — a seat map that double-books a wallet cannot be entered;
 *   - declared expectations are self-consistent (entrant count matches the
 *     seat list; a refund plan predicts Closed and no payout).
 *
 * A plan with no battle sets is VALID: a refund pool is never scored, so
 * T1-style plans legitimately carry no allocations. The rule is that what is
 * present must be well formed, not that everything must be present.
 *
 * Run:  npx ts-node --transpile-only --compiler-options \
 *         '{"module":"commonjs","moduleResolution":"node"}' \
 *         scripts/validate-plan.ts registry/T1.plan.json [...more]
 * Exit: 0 when every plan passes, 1 otherwise (every failure printed).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STATS = 5;
const BATTLES = 7;
const ALLOCATION_SUM = 100;

interface Seat {
  wallet: string;
  route?: string;
  role?: string;
  battles?: number[][];
  target?: number[][];
  expectedRank?: number | null;
  expectedLamports?: string;
}

interface Plan {
  schema: string;
  test: string;
  cluster?: string;
  /**
   * Wallet ids the plan deliberately gives identical battle sets, with the
   * reason recorded in the plan itself. Declaring a pair here suppresses the
   * duplicate failure for THOSE wallets and nothing else — an undeclared
   * duplicate still fails, which is the case that is a bug.
   */
  intentionalDuplicateSets?: { wallets: string[]; why: string };
  expectations?: {
    terminalState?: string;
    entrants?: number;
    paidSeatCount?: number;
  };
  seats: Seat[];
}

const problems: string[] = [];
const fail = (plan: string, msg: string) => problems.push(`${plan}: ${msg}`);

function checkAllocation(plan: string, who: string, k: number, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== STATS) {
    fail(plan, `${who} battle ${k}: expected ${STATS} stats, got ${JSON.stringify(a)}`);
    return false;
  }
  let sum = 0;
  for (const v of a as unknown[]) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      fail(plan, `${who} battle ${k}: every stat must be a non-negative integer, got ${JSON.stringify(a)}`);
      return false;
    }
    sum += v;
  }
  if (sum !== ALLOCATION_SUM) {
    fail(plan, `${who} battle ${k}: stats sum to ${sum}, not ${ALLOCATION_SUM}`);
    return false;
  }
  return true;
}

function validate(path: string, roster: Set<string>): void {
  const name = path.split('/').pop() ?? path;
  let plan: Plan;
  try {
    plan = JSON.parse(readFileSync(path, 'utf8')) as Plan;
  } catch (e) {
    fail(name, `unreadable JSON — ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  if (!plan.schema?.startsWith('blotto-rehearsal-plan/')) {
    fail(name, `schema must be blotto-rehearsal-plan/*, got ${JSON.stringify(plan.schema)}`);
  }
  if (!Array.isArray(plan.seats) || plan.seats.length === 0) {
    fail(name, 'seats must be a non-empty array');
    return;
  }

  const seen = new Set<string>();
  const fingerprints = new Map<string, string>();
  const declaredDuplicate = new Set(plan.intentionalDuplicateSets?.wallets ?? []);
  if (plan.intentionalDuplicateSets && !plan.intentionalDuplicateSets.why) {
    fail(name, 'intentionalDuplicateSets is declared without a `why` — a duplicate with no stated reason is a bug, not a design');
  }

  for (const seat of plan.seats) {
    const who = seat.wallet ?? '(unnamed seat)';

    if (!seat.wallet) { fail(name, 'a seat has no wallet id'); continue; }
    if (roster.size > 0 && !roster.has(seat.wallet)) {
      fail(name, `${who} is not in registry/wallets.json`);
    }
    if (seen.has(seat.wallet)) {
      fail(name, `${who} appears twice in the same pool`);
    }
    seen.add(seat.wallet);

    const sets = seat.battles ?? seat.target;
    if (!sets) continue; // legitimately absent on a refund plan or a UI seat

    if (!Array.isArray(sets) || sets.length !== BATTLES) {
      fail(name, `${who}: expected ${BATTLES} battles, got ${Array.isArray(sets) ? sets.length : typeof sets}`);
      continue;
    }
    let allOk = true;
    for (let k = 0; k < sets.length; k++) {
      if (!checkAllocation(name, who, k, sets[k])) allOk = false;
    }
    if (!allOk) continue;

    // Measured as `backend/detection/src/signals.ts` measures it: unsorted,
    // `b.join(',')`. A sorted comparison would call a rotating `pole` a single
    // shape and reject a legitimate plan, since a pole's sorted form never
    // changes however far it rotates.
    const shapes = new Set(sets.map((b) => b.join(',')));
    if (shapes.size < 3) {
      fail(name, `${who}: only ${shapes.size} distinct shapes across 7 battles — allocation_entropy fires strong at 2 or fewer`);
    }

    const fp = JSON.stringify(sets);
    const twin = fingerprints.get(fp);
    if (twin) {
      if (declaredDuplicate.has(seat.wallet) && declaredDuplicate.has(twin)) {
        // Declared, with a reason, in the plan. Announced rather than passed
        // over in silence: a reader of the CI log should see that this plan
        // contains a duplicate on purpose.
        console.log(`${name}: ${who} and ${twin} share a battle set BY DECLARATION — ${plan.intentionalDuplicateSets?.why ?? ''}`);
      } else {
        fail(name, `${who} and ${twin} have an identical seven-battle set, and the plan does not declare it in intentionalDuplicateSets`);
      }
    } else {
      fingerprints.set(fp, seat.wallet);
    }
  }

  const exp = plan.expectations;
  if (exp?.entrants !== undefined && exp.entrants !== plan.seats.length) {
    fail(name, `expectations.entrants is ${exp.entrants} but the seat list has ${plan.seats.length}`);
  }
  if (exp?.terminalState === 'Closed' && (exp.paidSeatCount ?? 0) !== 0) {
    fail(name, `a pool predicted Closed cannot pay ${exp.paidSeatCount} seats`);
  }
  if (exp?.terminalState && !['Closed', 'Paid'].includes(exp.terminalState)) {
    fail(name, `expectations.terminalState must be Closed or Paid, got ${exp.terminalState}`);
  }
}

function main(): void {
  const paths = process.argv.slice(2);
  if (paths.length === 0) throw new Error('usage: validate-plan.ts <plan.json> [...]');

  const rosterPath = resolve(__dirname, '..', 'registry', 'wallets.json');
  const roster = new Set<string>();
  if (existsSync(rosterPath)) {
    const doc = JSON.parse(readFileSync(rosterPath, 'utf8')) as { wallets: { id: string }[] };
    for (const w of doc.wallets) roster.add(w.id);
  } else {
    console.warn('registry/wallets.json not found — roster membership not checked');
  }

  for (const p of paths) validate(p, roster);

  if (problems.length > 0) {
    console.error(`plan validation FAILED — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`plan validation passed — ${paths.length} plan(s), roster of ${roster.size} wallets`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
