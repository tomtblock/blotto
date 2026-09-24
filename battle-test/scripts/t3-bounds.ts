/**
 * T3's unconditional bounds, computed rather than asserted.
 *
 * 38 of the 40 seats are seed-generated, so every battle between two of them is
 * DETERMINED by the frozen plan. The only free variables are UI-A and UI-B,
 * whose allocations the founder dials by hand against a 90-second clock.
 *
 * Two structural facts bound the founder's freedom, and both are CHECKED below
 * against the generated shapes rather than assumed:
 *
 *   P1  the wall holds three stats at 26 or above in every battle, and a capped
 *       seat holds none above 25 — so the wall beats any capped seat 3-2 or
 *       better in all 7. A founder seat yields the wall 14 and takes 0.
 *   P2  a capped seat holds five non-zero stats and the pole holds one — so the
 *       capped seat wins the other four stats and takes all 7. A founder seat
 *       takes 14 from the pole and yields it 0.
 *
 * Everything else a founder seat plays is free: 0..14 per opponent.
 *
 * Run (from battle-test/):
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' scripts/t3-bounds.ts
 *
 * Exit 1 if any of the four claims does not hold, so a plan cannot be frozen
 * against arithmetic that has quietly stopped working. This is the same method
 * `T6.deviation.json` used, promoted to a script because T6 showed the value of
 * being able to re-run it: the addendum there was checkable in seconds while a
 * pool was already half-filled.
 */
import { t3Field } from './oracle';
import { scorePool } from '../../backend/scoring/src/engine';
import type { BattleSet, Allocation } from '../../backend/scoring/src/allocation';

const field = t3Field();
const N = field.length;
const B = 7;
const WIN = 2;
const asSet = (b: number[][]): BattleSet => b.map((x) => x as unknown as Allocation);
const uiSeats = field.map((s, i) => (s.route === 'ui' ? i : -1)).filter((i) => i >= 0);
const isUI = (i: number) => uiSeats.includes(i);
const wallSeat = field.findIndex((s) => s.role === 'wall');
const poleSeat = field.findIndex((s) => s.role === 'pole');

// ---- the premises, checked against the frozen shapes --------------------
const bad: string[] = [];
for (const b of field[wallSeat].battles) {
  if (b.filter((v) => v >= 26).length < 3) bad.push(`P1: wall battle ${JSON.stringify(b)} has fewer than three stats at 26+`);
}
for (const b of field[poleSeat].battles) {
  if (b.filter((v) => v > 0).length !== 1) bad.push(`P2: pole battle ${JSON.stringify(b)} is not a single spike`);
}
for (let i = 0; i < N; i++) {
  if (i === wallSeat || i === poleSeat || isUI(i)) continue;
  for (const b of field[i].battles) {
    if (b.some((v) => v > 25)) bad.push(`P1: ${field[i].wallet} battle ${JSON.stringify(b)} exceeds 25`);
    if (b.some((v) => v < 1)) bad.push(`P2: ${field[i].wallet} battle ${JSON.stringify(b)} has a zero stat`);
  }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`premises P1 and P2 hold on all ${N - uiSeats.length} seed-generated shapes\n`);

/** Head-to-head half-points for seat a against seat b, by the engine's own rule. */
const h2h = (a: number, b: number) => scorePool(asSet([field[a].battles, field[b].battles]))[0].scoreHalf;

/**
 * Bounds for a seed-generated seat: its determined score against the other 37,
 * plus what P1/P2 fix for the two founder seats — 14 each for the wall
 * (it beats any capped seat), 0 each for the pole (any capped seat beats it),
 * and 0..14 each for an ordinary field seat.
 */
function bounds(i: number): { determined: number; floor: number; ceiling: number } {
  let determined = 0;
  for (let j = 0; j < N; j++) if (j !== i && !isUI(j)) determined += h2h(i, j);
  const perUI = i === wallSeat ? [B * WIN, B * WIN] : i === poleSeat ? [0, 0] : [0, B * WIN];
  return { determined, floor: determined + perUI[0] * uiSeats.length, ceiling: determined + perUI[1] * uiSeats.length };
}

const wall = bounds(wallSeat);
const pole = bounds(poleSeat);
const others = field.map((_, i) => i).filter((i) => i !== wallSeat && !isUI(i)).map(bounds);
const notPole = field.map((_, i) => i).filter((i) => i !== poleSeat && !isUI(i)).map(bounds);

// A founder seat: 0 from the wall (P1), 14 from the pole (P2), 0..14 from the other 37.
const uiFloor = B * WIN;
const uiCeiling = B * WIN + (N - 2) * B * WIN - B * WIN + B * WIN * 0; // pole + free 37, never the wall
const uiCeilingReal = B * WIN * (N - 2); // beats everyone except the wall

const bestOtherCeiling = Math.max(...others.map((r) => r.ceiling), uiCeilingReal);
const worstOtherFloor = Math.min(...notPole.map((r) => r.floor), uiFloor);

console.log(`T3 — ${N} seats · max score ${(N - 1) * B * WIN}\n`);
console.log(`wall  W00   determined ${wall.determined}   floor ${wall.floor}   ceiling ${wall.ceiling}`);
console.log(`pole  W01   determined ${pole.determined}   floor ${pole.floor}   ceiling ${pole.ceiling}`);
console.log(`founder seats (free)                 floor ${uiFloor}   ceiling ${uiCeilingReal}`);
console.log(`\nbest ceiling among every seat that is NOT the wall : ${bestOtherCeiling}`);
console.log(`worst floor  among every seat that is NOT the pole  : ${worstOtherFloor}`);

const claims: [string, boolean, string][] = [
  ['W00 takes rank 1, whatever the founder plays', wall.floor > bestOtherCeiling, `${wall.floor} > ${bestOtherCeiling}`],
  [`W01 takes rank ${N}, whatever the founder plays`, pole.ceiling < worstOtherFloor, `${pole.ceiling} < ${worstOtherFloor}`],
  ['no founder seat can take rank 1', uiCeilingReal < wall.floor, `${uiCeilingReal} < ${wall.floor}`],
  [`no founder seat can finish ${N}th`, uiFloor > pole.ceiling, `${uiFloor} > ${pole.ceiling}`],
];
console.log('');
claims.forEach(([name, ok, math], k) =>
  console.log(`claim ${k + 1}  ${name.padEnd(46)} ${math.padEnd(14)} ${ok ? 'HOLDS' : 'FAILS'}`)
);
if (!claims.every(([, ok]) => ok)) { console.error('\nAT LEAST ONE CLAIM DOES NOT HOLD — do not freeze this plan'); process.exit(1); }
console.log('\nall four unconditional claims hold on the frozen shapes');

// Where the 532 actually comes from — the theoretical founder ceiling, or a real seed?
const headlessCeilings = field
  .map((s, i) => ({ w: s.wallet, i }))
  .filter(({ i }) => i !== wallSeat && !isUI(i))
  .map(({ w, i }) => ({ w, ...bounds(i) }))
  .sort((a, b) => b.ceiling - a.ceiling);
console.log('\ntop 5 ceilings among the seed-generated non-wall seats:');
for (const r of headlessCeilings.slice(0, 5)) console.log(`  ${r.w}  determined ${r.determined}  floor ${r.floor}  ceiling ${r.ceiling}`);
console.log(`\nSo the 532 bound is the THEORETICAL founder ceiling, not a real seed.`);
console.log(`The best seed-generated rival tops out at ${headlessCeilings[0].ceiling}, ${wall.floor - headlessCeilings[0].ceiling} below W00's fixed ${wall.floor}.`);
