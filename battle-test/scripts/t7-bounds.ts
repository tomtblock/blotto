/**
 * T7's unconditional bounds, computed rather than asserted.
 *
 * T7 differs from every earlier test in TWO ways that change what can honestly
 * be predicted, and this script exists to say exactly which claims survive both.
 *
 *   1. AN ENTRANT WE DO NOT CONTROL. Pool 36 already held one wallet before
 *      this plan existed. Its seven allocations are sealed until reveal and are
 *      then whatever that player chose. So the pool is 63 frozen sets plus one
 *      free one, and a claim is only worth freezing if it holds for ALL of the
 *      free one's possible values.
 *
 *   2. A DELIBERATE TIE. W00 and W01 carry byte-identical battle sets
 *      (`twinWall`), because two prize shares — the thing the escrow path needs
 *      — exist only when two seats tie at rank 1 under D-E2's single paid place.
 *
 * Both are handled by the same fact: SCORING IS PAIRWISE ADDITIVE. A seat's
 * final score is its score among the 63 frozen seats plus its half-points
 * against the stranger, which is an integer in 0..14 and nothing else. So every
 * bound below is "the frozen part, plus the widest the free part can be".
 *
 * The premises are CHECKED against the generated shapes, not assumed:
 *
 *   P1  each wall holds three stats at 26 or above in every battle and no
 *       capped seat holds any stat above 25 — so a wall beats any capped seat
 *       at least 3-2 in all seven battles, taking 14 and yielding 0. This binds
 *       the two founder seats too: they are capped by their recipe, and the
 *       claim holds for ANY allocation inside 1..25, not just the recipe.
 *   P3  W00 and W01 are equal allocation-for-allocation across all seven
 *       battles.
 *
 * Run (from battle-test/):
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' scripts/t7-bounds.ts
 *
 * Exit 1 if any claim fails, so the plan cannot be frozen against arithmetic
 * that has quietly stopped working.
 */
import { t7Field } from './oracle';
import { scorePool } from '../../backend/scoring/src/engine';
import type { BattleSet, Allocation } from '../../backend/scoring/src/allocation';

const field = t7Field();
const N = field.length;            // 63 frozen seats
const B = 7;
const WIN = 2;
const MAX_VS_ONE = B * WIN;        // 14 — the most one opponent can ever be worth
const CAPACITY = 64;
const STRANGERS = CAPACITY - N;    // 1

const asSet = (b: number[][]): BattleSet => b.map((x) => x as unknown as Allocation);
const wallSeats = field
  .map((s, i) => (s.role === 'wall' || s.role === 'twin' ? i : -1))
  .filter((i) => i >= 0);
const uiSeats = field.map((s, i) => (s.route === 'ui' ? i : -1)).filter((i) => i >= 0);
const isWall = (i: number) => wallSeats.includes(i);
const isUI = (i: number) => uiSeats.includes(i);

// ---- the premises, checked against the frozen shapes ----------------------
const bad: string[] = [];
if (wallSeats.length !== 2) bad.push(`P3: expected exactly two wall seats, found ${wallSeats.length}`);
for (const w of wallSeats) {
  for (const b of field[w].battles) {
    if (b.filter((v) => v >= 26).length < 3) {
      bad.push(`P1: ${field[w].wallet} battle ${JSON.stringify(b)} has fewer than three stats at 26+`);
    }
  }
}
if (wallSeats.length === 2) {
  const [a, c] = wallSeats;
  const same = JSON.stringify(field[a].battles) === JSON.stringify(field[c].battles);
  if (!same) bad.push('P3: the two wall seats do not carry identical battle sets');
  if (JSON.stringify(field[a].timingsMs) === JSON.stringify(field[c].timingsMs)) {
    bad.push('the two wall seats carry identical TIMINGS too — the duplicate should show as one signal, not two');
  }
}
for (let i = 0; i < N; i++) {
  if (isWall(i) || isUI(i)) continue;
  for (const b of field[i].battles) {
    if (b.some((v) => v > 25)) bad.push(`P1: ${field[i].wallet} battle ${JSON.stringify(b)} exceeds 25`);
  }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`premises P1 and P3 hold on all ${N - uiSeats.length} seed-generated shapes`);
console.log(`field: ${N} frozen seats + ${STRANGERS} entrant whose allocation is unknown = ${CAPACITY}\n`);

// ---- the frozen part ------------------------------------------------------
// Scored over the 63 frozen seats alone. Every seat's FINAL score is this plus
// 0..14 from the stranger; every seat's FINAL zones is this plus 0..35.
const frozen = scorePool(asSet(field.map((s) => s.battles)));
const score63 = (i: number) => frozen[i].scoreHalf;
const zones63 = (i: number) => frozen[i].zones;

/** Head-to-head half-points for seat a against seat b, by the engine's own rule. */
const h2h = (a: number, b: number) => scorePool(asSet([field[a].battles, field[b].battles]))[0].scoreHalf;

const claims: { id: string; text: string; ok: boolean }[] = [];
const claim = (id: string, ok: boolean, text: string) => claims.push({ id, text, ok });

// ---- U1. The two walls tie, whatever anyone else plays --------------------
// P3 makes their seven comparisons against any third player the SAME seven
// comparisons, so the stranger yields each of them the same amount and the
// founder yields each of them the same amount. Equal score and equal zones is
// what `assignRanks` requires for a shared rank.
const [wA, wB] = wallSeats;
const tie = score63(wA) === score63(wB) && zones63(wA) === zones63(wB);
claim(
  'U1',
  tie,
  `W00 and W01 finish on the SAME score and the SAME zones and therefore SHARE a rank — ` +
    `whatever the stranger plays and whatever the founder plays. Among the 63 frozen seats both ` +
    `stand at ${score63(wA)} half-points and ${zones63(wA)} zones; the stranger adds the same ` +
    `amount to each, because their battle sets are equal allocation-for-allocation.`
);

// ---- U2. No capped seat can outscore a wall -------------------------------
// A capped seat loses all 7 battles to BOTH walls (P1), so its ceiling is
// beating every other one of its 61 opponents. A wall's floor is losing every
// battle to the stranger.
const cappedCeiling = (CAPACITY - 1 - wallSeats.length) * B * WIN;
const wallFloor = score63(wA) + 0;
claim(
  'U2',
  cappedCeiling < wallFloor,
  `NO CAPPED SEAT CAN OUTSCORE A WALL. By P1 a capped seat takes 0 from each wall, so its ` +
    `ceiling is ${CAPACITY - 1 - wallSeats.length} opponents × ${B} battles × ${WIN} = ` +
    `${cappedCeiling}. A wall's FLOOR is ${wallFloor} — its ${score63(wA)} among the frozen ` +
    `seats plus nothing at all from the stranger. ${cappedCeiling} < ${wallFloor}. This covers ` +
    `both founder seats for ANY allocation they place inside 1..25.`
);

// ---- U3. The founder cannot win and cannot change who does ----------------
const bestFrozenRival = Math.max(
  ...Array.from({ length: N }, (_, i) => i).filter((i) => !isWall(i)).map((i) => score63(i))
);
claim(
  'U3',
  bestFrozenRival + MAX_VS_ONE < wallFloor,
  `THE FOUNDER CANNOT DECIDE THIS POOL. The best score any frozen non-wall seat reaches is ` +
    `${bestFrozenRival}, and the most the stranger can add to it is ${MAX_VS_ONE}, for ` +
    `${bestFrozenRival + MAX_VS_ONE} — still below the walls' floor of ${wallFloor}. Nothing ` +
    `UI-A or UI-B does moves the winner.`
);

// ---- C1. The one thing the stranger CAN do --------------------------------
// The stranger takes `s` half-points off each wall (the same s from each, by
// P3) and at most 14 off every other seat. It outscores the walls when
//   854 + 2s  >  875 - s   →   3s > 21   →   s > 7,
// derived here from the numbers rather than by hand.
const strangerVsOthers = (CAPACITY - 1 - wallSeats.length) * B * WIN;
let threshold: number | null = null;
for (let s = 0; s <= MAX_VS_ONE; s++) {
  const strangerMax = strangerVsOthers + wallSeats.length * s;
  const wallScore = score63(wA) + (MAX_VS_ONE - s);
  if (strangerMax > wallScore) { threshold = s; break; }
}
const thresholdText =
  threshold === null
    ? 'never — the stranger cannot outscore the walls on any play'
    : `${threshold} or more half-points against ONE wall out of the ${MAX_VS_ONE} on offer — ` +
      `${threshold / 2} wins of ${B}, or fewer wins topped up by draws to the same total`;
console.log(
  `CONDITIONAL — the stranger's reach: a wall's final score is ${score63(wA)} + (${MAX_VS_ONE} − s), ` +
    `where s is the stranger's half-points against ONE wall (the same s against both, by P3).\n` +
    `  the walls hold rank 1 unless the stranger takes ${thresholdText}.\n` +
    `  if it does, the walls STILL tie (U1 is unconditional) — they tie at rank 2, nothing is\n` +
    `  escrowed, and that is the result to report rather than work around.\n`
);

// ---- the wall-score table, published in advance ---------------------------
console.log('wall score by the stranger\'s half-points against one wall (s):');
const rows: string[] = [];
for (let s = 0; s <= MAX_VS_ONE; s++) rows.push(`  s=${String(s).padStart(2)} → ${score63(wA) + (MAX_VS_ONE - s)}`);
console.log(rows.join('\n'));
console.log(
  `\n  s=0 (the stranger loses all seven to a wall) is the case every capped opponent produces,\n` +
    `  and gives ${score63(wA) + MAX_VS_ONE}. An even split, a single-stat spike and any capped set all sit there.\n`
);

// ---- report ---------------------------------------------------------------
let failed = 0;
for (const c of claims) {
  console.log(`${c.ok ? 'HOLDS ' : 'FAILS '} ${c.id}  ${c.text}\n`);
  if (!c.ok) failed++;
}
console.log(
  `head-to-head check: a wall takes ${h2h(wA, 4)} of ${MAX_VS_ONE} from ${field[4].wallet}, ` +
    `and ${h2h(wA, wB)} from its twin (seven draws).`
);
if (failed) { console.error(`\n${failed} claim(s) FAILED — do not freeze this plan.`); process.exit(1); }
console.log(`\nall ${claims.length} unconditional claims hold.`);
