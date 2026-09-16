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

import { compareBattle } from '../../backend/scoring/src/engine';
import {
  cappedField, wall, pole, uiWall, uiPole, distinctShapes, roundShare,
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

// 9. The founder instruction and these numbers must not drift apart. Re-derive
//    both sets from the APP'S OWN dial rule and require an exact match: if
//    someone changes `rebalance.ts`, this fails here rather than in a 4 SOL
//    pool. The alias below is only so the app's `@/...` imports resolve from
//    this runner; nothing under app/ is touched.
{
  const Module = require('module');
  const { join } = require('path');
  const APP = join(__dirname, '..', '..', 'app', 'src');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return orig.call(this, request.startsWith('@/') ? join(APP, request.slice(2)) : request, ...rest);
  };
  try {
    const { rebalance } = require(join(APP, 'components', 'blot', 'rebalance'));
    const { EVEN_SPLIT } = require(join(APP, 'battle', 'allocation'));

    const pairs: [number, number][] = [[0,1],[1,2],[2,3],[3,4],[4,0],[0,2],[1,3]];
    pairs.forEach(([x, y], k) => {
      const got = [...rebalance(rebalance(EVEN_SPLIT, x, 0), y, 0)];
      const want = uiWall().battles[k];
      if (got.join(',') !== want.join(',')) {
        fail(`uiWall battle ${k}: the dials produce ${JSON.stringify(got)} but populations.ts says ${JSON.stringify(want)}`);
      }
    });

    const spikes = [0, 1, 2, 3, 4, 2, 0];
    spikes.forEach((x, k) => {
      const got = [...rebalance(EVEN_SPLIT, x, 100)];
      const want = uiPole().battles[k];
      if (got.join(',') !== want.join(',')) {
        fail(`uiPole battle ${k}: the dials produce ${JSON.stringify(got)} but populations.ts says ${JSON.stringify(want)}`);
      }
    });
    console.log('  dial recipe: all 14 founder drags reproduce uiWall and uiPole exactly, through app/ rebalance.ts');
  } finally {
    Module._resolveFilename = orig;
  }
}

console.log('\nALL PROPERTIES HOLD — the engineered outcome is arithmetic, not hope.');
