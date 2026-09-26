/**
 * The engineered outcome, tested before it is trusted.
 *
 * T4 predicts all 64 ranks from arithmetic. If `wall` does not in fact beat
 * `cappedField` on every battle, or `pole` does not lose every battle, the
 * prediction is wrong and the pool would pay the wrong wallet real money. So
 * this asserts the property over many seeds, using the SAME comparison the
 * crank will use at reveal (`compareBattle` from backend/scoring), not a local
 * re-implementation of the rule.
 *
 * Run: npx ts-node --transpile-only --compiler-options \
 *   '{"module":"commonjs","moduleResolution":"node"}' src/populations.test.ts
 */

import { compareBattle, scorePool } from '../../backend/scoring/src/engine';
// The app's LIVE buzzer rule. Relative, so it needs no module-resolution shim
// (the retired dial module did, because it imported through the app's `@/` alias).
import { spreadUnplaced } from '../../app/src/battle/board/spread';
import {
  cappedField, wall, twinWall, pole, uiWall, uiPole, uiFieldA, uiFieldB, uiBoardA, uiBoardB,
  distinctShapes, roundShare,
  BATTLES, FIELD_CAP, ALLOCATION_SUM, WALL_MIN,
} from './populations';

const SEEDS = 400;
let checks = 0;
const fail = (m: string): never => { throw new Error(m); };

// 1. Every generator produces a legal allocation, every time.
for (let s = 0; s < SEEDS; s++) {
  for (const e of [cappedField(s), wall(s), pole(s)]) {
    if (e.battles.length !== BATTLES) fail(`${e.generator}(${s}): ${e.battles.length} battles`);
    for (const b of e.battles) {
      const sum = b.reduce((a, v) => a + v, 0);
      if (sum !== ALLOCATION_SUM) fail(`${e.generator}(${s}): sums to ${sum}`);
      if (b.length !== 5 || b.some((v) => !Number.isInteger(v) || v < 0)) {
        fail(`${e.generator}(${s}): ${JSON.stringify(b)} is not five non-negative integers`);
      }
      checks++;
    }
    // At least three distinct shapes, or `allocation_entropy` fires "strong".
    // Measured unsorted, exactly as signals.ts measures it.
    const shapes = distinctShapes(e.battles);
    if (shapes < 3) fail(`${e.generator}(${s}): only ${shapes} distinct shapes`);
  }
}
console.log(`  legal allocations: ${checks} battle sets across ${SEEDS} seeds, all sum to 100, all >= 3 shapes`);

// 2. The field really is capped, which is what makes the wall's margin real.
for (let s = 0; s < SEEDS; s++) {
  for (const b of cappedField(s).battles) {
    if (b.some((v) => v > FIELD_CAP)) fail(`cappedField(${s}): ${JSON.stringify(b)} exceeds the cap`);
    if (b.some((v) => v < 1)) fail(`cappedField(${s}): ${JSON.stringify(b)} has a zero stat — the pole would not lose to it`);
  }
}
console.log(`  field cap: every stat in 1..${FIELD_CAP} across ${SEEDS} seeds`);

// 3. THE CLAIM T4 RESTS ON: wall beats cappedField on EVERY battle.
let wallWins = 0;
for (let ws = 0; ws < 40; ws++) {
  const w = wall(ws);
  for (let fs = 0; fs < 40; fs++) {
    const f = cappedField(fs * 7 + 3);
    for (let k = 0; k < BATTLES; k++) {
      const r = compareBattle(w.battles[k] as never, f.battles[k] as never).outcome;
      if (r !== 'win') {
        fail(`wall(${ws}) battle ${k} ${JSON.stringify(w.battles[k])} did NOT beat cappedField ${JSON.stringify(f.battles[k])} — got ${r}`);
      }
      wallWins++;
    }
  }
}
console.log(`  wall beats cappedField: ${wallWins}/${wallWins} battles won, 40 walls x 40 fields`);

// 4. And the pole loses every battle to that same field.
let poleLosses = 0;
for (let ps = 0; ps < 40; ps++) {
  const p = pole(ps);
  for (let fs = 0; fs < 40; fs++) {
    const f = cappedField(fs * 11 + 5);
    for (let k = 0; k < BATTLES; k++) {
      const r = compareBattle(p.battles[k] as never, f.battles[k] as never).outcome;
      if (r !== 'loss') {
        fail(`pole(${ps}) battle ${k} ${JSON.stringify(p.battles[k])} did NOT lose to cappedField ${JSON.stringify(f.battles[k])} — got ${r}`);
      }
      poleLosses++;
    }
  }
}
console.log(`  pole loses to cappedField: ${poleLosses}/${poleLosses} battles lost, 40 poles x 40 fields`);

// 5. Wall vs pole: the wall must never LOSE. It does not always win, and that
//    is correct arithmetic rather than a defect. A wall is three stats >= 26
//    and two at zero; a pole is 100 on one stat and zero elsewhere.
//      - pole's spike on one of the wall's ZEROS  -> wall takes 3 stats, wins.
//      - pole's spike on one of the wall's THREE  -> wall takes 2, pole takes 1,
//        two stats tie at zero, nobody reaches 3  -> DRAW.
//    A draw scores 1 half-point each instead of 2, which changes the wall's
//    total slightly but not its rank: no other entrant takes a single battle
//    off it, and the pole still loses all seven to each of the 62 field seats.
//    The oracle computes the exact scores; this only guards the invariant that
//    the engineered winner can never be beaten by the engineered loser.
let wpWin = 0, wpDraw = 0;
for (let s = 0; s < 60; s++) {
  for (let k = 0; k < BATTLES; k++) {
    const r = compareBattle(wall(s).battles[k] as never, pole(s + 7).battles[k] as never).outcome;
    if (r === 'loss') fail(`wall(${s}) battle ${k} LOST to pole(${s + 7}) — the engineered winner must never lose to the engineered loser`);
    if (r === 'win') wpWin++; else wpDraw++;
  }
}
console.log(`  wall never loses to pole: ${wpWin} wins, ${wpDraw} draws, 0 losses (draws are expected when the spike lands on a wall stat)`);

// 6. No two entrants share an identical seven-battle set — the one allocation
//    signal that hard-blocks (R11). Check across the whole T4 field shape.
const sets = new Map<string, string>();
const add = (id: string, e: { battles: number[][] }) => {
  const k = JSON.stringify(e.battles);
  const twin = sets.get(k);
  if (twin) fail(`${id} and ${twin} have an identical seven-battle set`);
  sets.set(k, id);
};
for (let i = 0; i < 62; i++) add(`W${i}`, cappedField(4000 + i));
add('UI-A', wall(4100));
add('UI-B', pole(4200));
console.log(`  uniqueness: ${sets.size} sets in a full-pool field, no duplicates`);

// 7. The other half of allocation_entropy: a pole is all zeroes and a hundred,
//    so it is 100% multiples of ten and WILL draw a "note". Assert that, so the
//    plan predicts it rather than the report discovering it.
const poleRound = roundShare(pole(1).battles);
if (poleRound < 0.9) fail(`pole roundShare ${poleRound} — expected >= 0.9, the note is predicted`);
const fieldRound = roundShare(cappedField(1).battles);
if (fieldRound >= 0.9) fail(`cappedField roundShare ${fieldRound} — the field should NOT draw the round-number note`);
console.log(`  allocation_entropy round-number half: pole ${Math.round(poleRound*100)}% (note expected), field ${Math.round(fieldRound*100)}% (clean)`);


// 8. The two sets the FOUNDER actually plays. `wall(seed)` and `pole(seed)`
//    are for wallets we drive; UI-A and UI-B are typed into the live dials
//    under a 90-second run clock, so T4 uses `uiWall()` and `uiPole()` — the
//    exact output of the shortest drag sequence that reaches each role. The
//    claim T4 rests on has to hold for THESE, not just for the generated ones.
{
  const w = uiWall();
  const p = uiPole();
  for (const [name, e] of [['uiWall', w], ['uiPole', p]] as const) {
    if (e.battles.length !== BATTLES) fail(`${name}: ${e.battles.length} battles`);
    for (const b of e.battles) {
      const sum = b.reduce((a, v) => a + v, 0);
      if (sum !== ALLOCATION_SUM) fail(`${name}: ${JSON.stringify(b)} sums to ${sum}`);
    }
    const shapes = distinctShapes(e.battles);
    if (shapes < 3) fail(`${name}: only ${shapes} distinct shapes — allocation_entropy fires strong`);
  }
  for (const b of w.battles) {
    const big = b.filter((v) => v >= WALL_MIN).length;
    if (big < 3) fail(`uiWall ${JSON.stringify(b)}: only ${big} stats at ${WALL_MIN}+`);
  }

  let uw = 0;
  let up = 0;
  for (let fs = 0; fs < 200; fs++) {
    const f = cappedField(4000 + fs);
    for (let k = 0; k < BATTLES; k++) {
      const a = compareBattle(w.battles[k] as never, f.battles[k] as never).outcome;
      if (a !== 'win') fail(`uiWall battle ${k} did NOT beat cappedField(${4000 + fs}) — got ${a}`);
      uw++;
      const b = compareBattle(p.battles[k] as never, f.battles[k] as never).outcome;
      if (b !== 'loss') fail(`uiPole battle ${k} did NOT lose to cappedField(${4000 + fs}) — got ${b}`);
      up++;
    }
  }
  for (let k = 0; k < BATTLES; k++) {
    const r = compareBattle(w.battles[k] as never, p.battles[k] as never).outcome;
    if (r === 'loss') fail(`uiWall battle ${k} LOST to uiPole — the whole prediction inverts`);
  }
  console.log(`  uiWall beats the field ${uw}/${uw}, uiPole loses ${up}/${up}, and uiWall never loses to uiPole`);
}

// 9. The founder instruction and these numbers must not drift apart.
//
//    THIS CHECK USED TO RUN AGAINST THE APP'S DIAL RULE (`app/src/components/
//    blot/rebalance.ts`) and re-derive uiWall and uiPole from it, so that a
//    change to the dials failed here rather than in a 4 SOL pool. **The dial
//    run no longer exists**: main's 59ca085 of 2026-09-24, "Retire the dial
//    run: the board is the only run", deleted rebalance.ts along with the
//    seven screens, the drag, the per-screen timer and the 90-second budget.
//    DRIFT §H31 has the whole entry.
//
//    So the cross-check cannot be kept and must not be quietly dropped. The
//    dial generators stay exactly as they are — T3, T4, T5 and T6 are frozen
//    against them and their results roots must keep reproducing, which CI
//    checks separately — but they are now HISTORICAL DATA rather than a
//    derivation of anything live. Pinned here as an explicit snapshot so a
//    careless edit still fails loudly.
{
  const wallWant = [
    [0, 0, 34, 33, 33], [34, 0, 0, 33, 33], [34, 33, 0, 0, 33],
    [34, 33, 33, 0, 0], [0, 34, 33, 33, 0], [0, 34, 0, 33, 33],
    [34, 0, 33, 0, 33],
  ];
  const poleWant = [
    [100, 0, 0, 0, 0], [0, 100, 0, 0, 0], [0, 0, 100, 0, 0],
    [0, 0, 0, 100, 0], [0, 0, 0, 0, 100], [0, 0, 100, 0, 0],
    [100, 0, 0, 0, 0],
  ];
  uiWall().battles.forEach((got, k) => {
    if (got.join(',') !== wallWant[k].join(',')) {
      fail(`uiWall battle ${k}: ${JSON.stringify(got)} moved from the frozen ${JSON.stringify(wallWant[k])}`);
    }
  });
  uiPole().battles.forEach((got, k) => {
    if (got.join(',') !== poleWant[k].join(',')) {
      fail(`uiPole battle ${k}: ${JSON.stringify(got)} moved from the frozen ${JSON.stringify(poleWant[k])}`);
    }
  });
  console.log('  dial generators: uiWall and uiPole match their frozen snapshots (the app-side rule they derived from is gone)');
}

// 9b. The BOARD generators, cross-checked against the app's LIVE rule — the
//     protection §9 used to give the dial generators, moved to the ones a
//     founder now actually plays.
//
//     The claim being checked is the one the T7 recipe rests on: if the
//     founder fills every field to exactly 100 and locks it, the buzzer rule
//     adds nothing and the entry is what the plan says. And if a field were
//     left HALF FILLED, the spread would push points back into the stats
//     already placed and could break the 25 cap — which is why the recipe
//     says fill every field, and why that is worth a test rather than a note.
{
  const allLocked = Array.from({ length: BATTLES }, () => true);
  const noneLocked = Array.from({ length: BATTLES }, () => false);

  for (const [name, e] of [['uiBoardA', uiBoardA()], ['uiBoardB', uiBoardB()]] as const) {
    // Filled and locked: the buzzer changes nothing.
    const locked = spreadUnplaced(e.battles, allLocked, 'easy');
    if (JSON.stringify(locked) !== JSON.stringify(e.battles)) {
      fail(`${name}: the buzzer rule altered a fully filled, locked board`);
    }
    // Filled but NOT locked: still nothing to spread, because each field
    // already holds 100. This is the case the founder is actually in if they
    // fill every field and forget to lock.
    const unlocked = spreadUnplaced(e.battles, noneLocked, 'easy');
    if (JSON.stringify(unlocked) !== JSON.stringify(e.battles)) {
      fail(`${name}: the buzzer rule altered a fully filled board that was left unlocked`);
    }
    for (const bt of e.battles) {
      if (bt.some((v) => v > FIELD_CAP)) fail(`${name}: ${JSON.stringify(bt)} breaks the ${FIELD_CAP} cap`);
    }
  }

  // And the hazard, proven rather than asserted: 25 on one stat with the
  // other 75 unplaced does NOT stay capped. This is why the dial recipe could
  // not simply be reworded for the board.
  const halfFilled = Array.from({ length: BATTLES }, () => [25, 0, 0, 0, 0]);
  const spread = spreadUnplaced(halfFilled, noneLocked, 'easy');
  if (!spread[0].some((v: number) => v > FIELD_CAP)) {
    fail('the buzzer rule no longer pushes a half-filled field over the cap — DRIFT §H31 needs revisiting');
  }
  console.log(
    `  board generators: uiBoardA and uiBoardB survive the buzzer rule filled and unlocked; ` +
    `a 25-and-leave-it field becomes ${JSON.stringify(spread[0])}, which is why the recipe fills every field`
  );
}


// 9c. THE TWIN WALL — the one property T7 rests on.
//
//     Two seats with identical battle sets score identically against every
//     opponent, because compareBattle is positional: seat i's seven
//     comparisons against seat j depend only on the two sets, so equal sets
//     give equal results against ANY third player — including one whose
//     allocation nobody can read. Equal score AND equal zones is what
//     assignRanks needs for a shared rank, and a shared rank 1 is the only
//     way a pool holds two prize shares under D-E2's single paid place.
//
//     Checked by scoring a real pool rather than by argument, and checked
//     against an adversary chosen to be as awkward as possible.
{
  const SEED = 7100;
  const w = wall(SEED);
  const twin = twinWall(SEED, 7150);

  if (JSON.stringify(twin.battles) !== JSON.stringify(w.battles)) {
    fail('twinWall does not reproduce wall\'s battles — the tie is not a tie');
  }
  if (JSON.stringify(twin.timingsMs) === JSON.stringify(w.timingsMs)) {
    fail('twinWall reproduces wall\'s TIMINGS too — the duplicate should fire one signal, not two');
  }

  // Score a pool of the pair plus an assortment of third parties, including
  // the shapes an unknown entrant is most likely to play and the ones most
  // hostile to a wall.
  const others: number[][][] = [
    Array.from({ length: BATTLES }, () => [20, 20, 20, 20, 20]),   // the buzzer's even split
    Array.from({ length: BATTLES }, () => [100, 0, 0, 0, 0]),      // a single spike
    Array.from({ length: BATTLES }, () => [0, 0, 50, 25, 25]),     // built to beat a wall's zeros
    w.battles.map((b) => [...b]),                                  // a THIRD copy of the wall
    cappedField(9001).battles.map((b) => [...b]),
    pole(9002).battles.map((b) => [...b]),
  ];
  for (let take = 1; take <= others.length; take++) {
    const players = [w.battles, twin.battles, ...others.slice(0, take)];
    const scored = scorePool(players as never);
    if (scored[0].scoreHalf !== scored[1].scoreHalf) {
      fail(`twin pair scored ${scored[0].scoreHalf} vs ${scored[1].scoreHalf} against ${take} third parties`);
    }
    if (scored[0].zones !== scored[1].zones) {
      fail(`twin pair took ${scored[0].zones} vs ${scored[1].zones} zones against ${take} third parties`);
    }
    if (scored[0].rank !== scored[1].rank) {
      fail(`twin pair landed on ranks ${scored[0].rank} and ${scored[1].rank} against ${take} third parties`);
    }
  }

  // Their mutual battles are seven draws: all five stats equal every time,
  // so one half-point each and no zones from each other.
  const pair = scorePool([w.battles, twin.battles] as never);
  if (pair[0].scoreHalf !== BATTLES || pair[0].zones !== 0) {
    fail(`twin vs twin gave ${pair[0].scoreHalf} half-points and ${pair[0].zones} zones, expected ${BATTLES} and 0`);
  }
  console.log(
    `  twin wall: identical sets, different think-times; equal score, zones and rank against ` +
    `every one of ${others.length} adversaries tried, and ${BATTLES} draws between themselves`
  );
}

// 10. T5's founder seats. The whole test rests on two claims about them, and
//     both must hold for ANY allocation in 1..25 — not just for the recipe,
//     because T4 showed a human at a dial lands somewhere else (§H10).
//     Here we prove the recipe satisfies the range, and that the range implies
//     the claims.
{
  const a = uiFieldA();
  const b = uiFieldB();

  for (const [name, e] of [['uiFieldA', a], ['uiFieldB', b]] as const) {
    if (e.battles.length !== BATTLES) fail(`${name}: ${e.battles.length} battles`);
    for (const bt of e.battles) {
      const sum = bt.reduce((x, y) => x + y, 0);
      if (sum !== ALLOCATION_SUM) fail(`${name}: ${JSON.stringify(bt)} sums to ${sum}`);
      // The two halves of the range, and each carries one of the claims.
      if (bt.some((v) => v > FIELD_CAP)) fail(`${name}: ${JSON.stringify(bt)} exceeds the cap — it could beat the wall`);
      if (bt.some((v) => v < 1)) fail(`${name}: ${JSON.stringify(bt)} has a zero — it could draw with the pole`);
    }
    const shapes = distinctShapes(e.battles);
    if (shapes < 3) fail(`${name}: only ${shapes} distinct shapes — allocation_entropy fires strong`);
  }

  // duplicate_sets is the one allocation signal that HARD-BLOCKS. The two
  // founder wallets must never share a seven-battle set.
  if (JSON.stringify(a.battles) === JSON.stringify(b.battles)) {
    fail('uiFieldA and uiFieldB share an identical set — duplicate_sets hard-blocks');
  }

  // Claim 1: a founder seat cannot win. It loses every battle to the wall.
  // Claim 2: a founder seat cannot come last. It beats the pole every battle.
  let lost = 0;
  let beat = 0;
  for (let s = 0; s < 60; s++) {
    const w = wall(5100 + s);
    const p = pole(5200 + s);
    for (const [name, e] of [['uiFieldA', a], ['uiFieldB', b]] as const) {
      for (let k = 0; k < BATTLES; k++) {
        const vsWall = compareBattle(e.battles[k] as never, w.battles[k] as never).outcome;
        if (vsWall !== 'loss') fail(`${name} battle ${k} did NOT lose to a wall — got ${vsWall}; it could take rank 1`);
        lost++;
        const vsPole = compareBattle(e.battles[k] as never, p.battles[k] as never).outcome;
        if (vsPole !== 'win') fail(`${name} battle ${k} did NOT beat a pole — got ${vsPole}; it could come last`);
        beat++;
      }
    }
  }
  console.log(`  T5 founder seats: lose to the wall ${lost}/${lost}, beat the pole ${beat}/${beat} — so ranks 2..63, unconditionally`);
}

// 11. The T5 founder recipe, pinned as a snapshot.
//
//     This block used to re-derive uiFieldA and uiFieldB from the app's own
//     dial arithmetic, so a change to rebalance.ts broke here rather than in
//     a 4 SOL pool. The dial run was retired on 2026-09-24 (DRIFT §H31) and
//     rebalance.ts is gone, so there is nothing live left to derive from:
//     these values are now frozen history, held here so an edit still fails.
//     §9b gives the BOARD generators the live cross-check this one lost.
{
  const want: Record<string, number[][]> = {
    uiFieldA: [
      [25, 19, 19, 19, 18], [19, 25, 19, 19, 18], [19, 19, 25, 19, 18],
      [19, 19, 19, 25, 18], [19, 19, 19, 18, 25], [25, 19, 19, 19, 18],
      [19, 19, 25, 19, 18],
    ],
    uiFieldB: [
      [19, 19, 19, 18, 25], [19, 19, 19, 25, 18], [19, 19, 25, 19, 18],
      [19, 25, 19, 19, 18], [25, 19, 19, 19, 18], [19, 19, 19, 25, 18],
      [19, 25, 19, 19, 18],
    ],
  };
  for (const [name, e] of [['uiFieldA', uiFieldA()], ['uiFieldB', uiFieldB()]] as const) {
    e.battles.forEach((got, i) => {
      if (got.join(',') !== want[name][i].join(',')) {
        fail(`${name} battle ${i}: ${JSON.stringify(got)} moved from the frozen ${JSON.stringify(want[name][i])}`);
      }
    });
  }
  console.log('  T5 dial generators: uiFieldA and uiFieldB match their frozen snapshots');
}

console.log('\nALL PROPERTIES HOLD — the engineered outcome is arithmetic, not hope.');
