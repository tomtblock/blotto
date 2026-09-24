# CHANGE — 2026-09-24: the battle board (Phase A), and the two modes it prepares for

**Status: Phase A merged to `main` (PR #176, 2026-09-24); the board is the only run. The switch
that made it the default (PR #177) and the dial run it guarded were removed the same evening
(§8); a rollback is now a revert of that removal, not a setting.**
Phase B (the hard-mode pool) is planned and not started. The plan the founder approved is
`https://claude.ai/artifact/RufrDt16swq46bCkNkdyGP`; the wireframes are
`https://www.figma.com/design/cIzgzj8m77Oeo0JMOK2zZ4`.

This report is the record of the founder's rulings of 2026-09-24, what was built to them, the
two places they override an earlier document, and what is deliberately not built yet. Where a
number appears here it is the founder's; where a judgement was made it is marked.

---

## 1. The founder's rulings (2026-09-24)

| # | Ruling | Where it lives |
|---|---|---|
| 1 | **The dials are replaced by a board**: seven fields around a castle, five troops, press-and-hold to send points, a stepper for steps. Everything from the pool page onward changes; the landing page's hero, steps and ladder do not. | `app/src/battle/board/`, `app/src/battle/components/board/` |
| 2 | **Two modes, two pools, two entries.** Easy: 100 points in each of the seven battles. Hard: 700 points placed anywhere across the thirty-five cells. A player pays 0.1 SOL to enter either; each pool has its own 4 SOL prize. Same price ladder; only 0.1 SOL opens first. | `mode.ts` carries both; Phase A wires easy only |
| 3 | **The competition mechanics are identical in both modes** — a stat won by the larger number, a battle by three of five, otherwise a draw; every player faces every other. Only the placing budget differs. | `backend/scoring/src/engine.ts`, unchanged |
| 4 | **Three minutes**, one clock for the whole board, in both modes. Replaces the ninety seconds of the 2026-09-06 brief. | `BOARD_CLOCK_BUDGET_MS` in `mode.ts` |
| 5 | **The clock starts on the first point placed**, and the rule is said on arrival. | `ReadyBanner`, `TimerCard`; `machine.ts` `place` |
| 6 | **Single points are the easy thing.** Hold to pour one at a time; a stepper offers ±1 as the big buttons and ±5 / ±10 / ±20 beside them, reducing at the same rate as adding. | `use-pour.ts`, `Stepper.tsx`, `STEP_SIZES` |
| 7 | **Lock-in stays, per field, in both modes.** A locked field is frozen and left out of the buzzer spread. | `machine.ts` `lock` / `unlock`, `spread.ts` |
| 8 | **Buzzer:** unplaced points spread evenly across every cell of the fields not locked in, remainder in fixed order. Applies on Submit as on expiry. | `spread.ts`, pinned by `spread.test.ts` |
| 9 | **What is left is always visible**: per field in easy ("41 placed · 59 left"), one total in hard ("Left to place 312 / 700"). | `chipLine`, `ProgressReadout` |
| 10 | **The homepage's dial toy becomes a board demo.** | `LiveDemo.tsx` |
| 11 | **Words:** troop, crowd, field, points; rival only on a demo replay. | `COPY.board` |
| 12 | The replay in the prototype is a visualisation of one 1-v-1 and stays as that — running the real engine. Not in Phase A. | plan §2 |
| 13 | **A hand key for grab mode** (second pass, after the founder's first look): pressing it disarms the troop in hand, so a drag only moves the view and a tap on a field opens that field's stepper for the troop — the ±5/±10/±20 keys without disarming the tray first. Tapping a troop card leaves grab mode. On the play page and the homepage demo alike (both are `BoardFlow`). | `GrabKey` in `hud.tsx`, `grab` on `Arena` |
| 14 | **Everything shows the board** (on the day Phase A merged). First as an opt-out switch (PR #177); then, on the founder's approval of the dead-code plan, the dial run and the switch were removed outright (§8). | §8 |

## 2. What Phase A is

Front end only. The program, the sealed payload format (`backend/sealing/src/payload.ts`), the
scoring engine and the published bundle are untouched: easy mode **is** the rule the platform has
always played, expressed through a board instead of dials.

| Piece | File | Note |
|---|---|---|
| Mode constants | `app/src/battle/board/mode.ts` | 100 per field / 700 total; 3-minute clock; `STEP_SIZES`. Nothing invented: 100 is `ALLOCATION_SUM`, 700 is `7 × 100`. |
| Reducer | `app/src/battle/board/machine.ts` | Pure. `select`, `place`, `fill_field`, `send_back`, `lock`, `unlock`, `tick`, `submit`, `resume`, `confirm`. A `place` never overshoots the field (easy) or the board (hard); a locked field takes and gives nothing. |
| Buzzer rule | `app/src/battle/board/spread.ts` | Deterministic, integer-only, never random (R9). Throws on the state the reducer forbids. |
| Tests | `machine.test.ts`, `spread.test.ts`, `arena/map.test.ts`, `arena/deploy.test.ts` | 46 tests. Two `fast-check` properties run **10,000 random event sequences per mode** and assert every in-play state legal, every entry legal, locked fields untouched by the spread, and the clock started only by a placement. The geometry and the deploy curve are pinned to the mockup's own numbers. |
| The arena | `components/board/arena/{map,camera,render,input,figures,deploy}.ts`, `Arena.tsx` | **The founder's mockup, carried over** (`timdontplay/blotto-game` at `9d3821f`, its `src/model/map.ts`, `canvas/{camera,render,input,figures}.ts`, `model/deploy.ts`): the 2048-unit painted world, sprite crowds on a sunflower spiral that wander on a deterministic loop, the pan/zoom/pinch camera with animated fits, the press-and-hold deploy curve (6 → 40 troops per second over two seconds, 120 ms arm timer, a quick tap sends one), plaques on the rim. Geometry unchanged so the painting lines up. What the port adds: a LOCKED look for a field, the plaque's second line saying what is left, and every deposit going through the reducer. The replay layer is not carried yet (results page, later). |
| Art and fonts | `public/board-art/*.webp`, `public/fonts/board/unbounded.woff2` | The mockup's painted map, forest tile and ten sprites (generated once there, committed here; the app never generates art). Unbounded is the mockup's display face, self-hosted for the board alone; body and numbers use the faces the app already ships. |
| Tray, stepper, HUD, review | `TroopTray.tsx`, `Stepper.tsx`, `hud.tsx`, `ReviewPanel.tsx`, `board.css` | The mockup's chrome — cream plaques, wood outlines, gold keys, one colour per stat — scoped under `.bb`/`.bba`. Every step button disables when it would overshoot. The hand key (ruling 13) sits under the mode badge and turns gold while grab mode is on; the hint line says what a tap does in that mode. |
| Host | `components/board/BoardFlow.tsx` | Same contract as `BattleFlow`: hosted review in the seal stage's slot, `onConfirm` with seven allocations and seven timings. |
| Switch | — (removed, §8) | Was `NEXT_PUBLIC_BATTLE_BOARD`: opt-in (`=1`) in PR #176, opt-out (`=0`) in PR #177, removed with the dial run. |
| Pool page | `app/src/app/pools/[pool]/page.tsx` | Mode badge; "How this pool plays" card, config-driven (the minutes come from the clock constant). |
| Homepage | `components/landing/LiveDemo.tsx`, `page.tsx` | Board demo; "Try the board". |
| Copy | `app/src/copy/index.ts` `board`, `pool.howItPlays`, `landing.tryBoard` | Every line a `PHASE-N-REVIEW` draft; the founder owns the words. Language gate clean. |
| Journey | `app/e2e/journey.spec.ts` | The board-demo test, at 375 and 1280 (the practice-machine test left with the dials, §8). |

### Timings for detection

The sealed payload's seven `u32` slots are unchanged in format. Under the board each carries the
run millisecond of that field's **last change** (0 if never touched) instead of time-on-screen,
because there are no screens. The detection signals that read them are the timing-profile
signals in `backend/detection/src/signals.ts`; their meaning shifts with this. The note there is
**still owed** now that the switch is gone (§8, open item). **The format is the same bytes, so
nothing sealed under the dials is affected.**

## 3. Two overrides of earlier documents — recorded, not buried

1. **PID §4.2 says the player "never sees a 'points remaining' counter."** Audit finding A-29
   (2026-09-11) removed one on that basis, and the note in `COPY.battle` says why. The founder's
   ruling 9 above asks for exactly that readout in both modes. The board is a points-placing
   interaction, so §4.2's premise changed with the prototype itself. **The ruling stands; §4.2's
   sentence is for the PID reissue** (`docs/INDEX.md`, "The PID is behind the build"). Marked
   `PHASE-N-REVIEW` in `machine.ts` and `copy/index.ts`.
2. **PID §4.3 rejects prominent round-number targets** because clustering raises the draw rate,
   and `allocation.ts` restates it. The founder heard the concern and ruled for ±5 / ±10 / ±20
   beside ±1 (ruling 6). The Phase B evidence run measures how much of the field lands on
   multiples of five, so the effect is known rather than argued.

## 4. Judgement calls (architect-owned, one line each)

- **The timer is calm.** The dial run's `<Timer />` states that never-red, never-pulsing is part
  of the §8.7 posture. The prototype's red `0:00` is **not** carried over; the last ten seconds
  are marked by the hint line's sentence. The Figma D7 screen showed red and is superseded here.
- **Gold on the board's chrome, as in the mockup.** `design/tokens.ts` reserves the app's prize
  yellow for paid amounts and says the Blot never shares a frame with a stat number. The founder's
  instruction is to stay close to the mockup, whose primary keys and Full plaques are gold and
  whose troops are yellow Blottos standing beside their counts. The board follows the mockup and
  this line records the departure from the token rule for the founder to ratify or reverse; it is
  a brand rule, not a legal one, and it is scoped to the board.
- **No undo.** The mockup has unlimited undo (a hold is one step). The founder's brief did not
  ask for it and the stepper's −1/−5/−10/−20 and "Send back" cover the need; recorded so it is a
  decision, not an omission.
- **Submit is available from the first point.** It applies the same spread as the buzzer, so
  submitting early is the player's own choice with a published effect — never a shortcut around
  the rule.
- **Two lock edge rules, awaiting ratification** (plan A3): easy locks only a Full field; hard
  cannot lock the last open field while points remain. `spread.ts` throws on the second, so the
  reducer's refusal is what keeps the throw unreachable — pinned by the property test.
- **The board is scoped CSS (`bb-*`)** inside the existing game layer rather than new tokens;
  the prototype's HTML, when it arrives, maps onto those variables.
- **Pointer positions go through the SVG's screen CTM, not the client rect** (found by the
  grab-mode journey at 1280: a tap on Field 2 opened Field 1). The app renders at `zoom: 0.9` on
  a wide screen with a fine pointer (`globals.css`), and under a zoom the client rect and the
  SVG's own units differ by 10% — the mockup's `clientX − rect.left` maths, which it can afford
  because nothing zooms it, put every tap and hold 10% off there, landing on the neighbouring
  field near a road. `arena/input.ts` now maps through `getScreenCTM()`, which carries zoom and
  transforms alike, and the camera's viewport is the stage's layout size. Phones, which are never
  zoomed, are unchanged.

## 5. Not built (Phase B, in the plan's order)

`Pool.mode` and the appended hard ladder on `Config` with their migrations; `open_pool(tier, mode)`;
`PoolOpened.mode`; the mode-aware invariant and the `u16` encoding for hard battle sets; bundle
version 3; the crank reading the pool's mode; the verify page's mode; indexer migration `0025`;
the keeper per (tier, mode); `admin.ts set-open-tiers --mode`; the hard-mode evidence run; the
terms version bump (plan A7, founder to confirm); the docs sweep (`AS-BUILT`, `PRODUCT-FACTS`,
`HOW-IT-WORKS`, TECH-ARCH appendix, the register rows). The program upgrade needs a drain window
agreed with the battle-test session — the upgrade pre-flight refuses while any pool is Open.

Also for later, not scheduled: a **board-native "share your seven"** — a picture of the seven
fields, offered only once a pool has closed, to replace the Blott-stills share retired in §9.
It needs a design decision first on what the picture shows.

## 6. Verified

`npm test` (598), `npm run lint`, `npm run typecheck`, `check-language.sh`,
`check-standing-rules.sh`, `check-env-examples.sh`, `check-published-numbers.ts` — every exit
code captured explicitly, every one 0.

## 7. The browser run (2026-09-24, 17:20Z)

Against a production build in fixture mode with the switch on (`NEXT_PUBLIC_FIXTURE_DATA=1
NEXT_PUBLIC_BATTLE_BOARD=1 npm run build`, `next start`), the way CI runs the journey:

- `e2e/journey.spec.ts` "the board demo pours points and locks a field": **passed at 375 and
  1280** (Chromium, `hasTouch` on the phone project). Real pointer coordinates on the painted
  field, the arm timer, the deploy curve, the plaque opening the stepper, +5, Fill, Lock in,
  Unlock offered, the readout "1 / 7 battles full · 1 locked in".
- A separate Chromium drive (scratch script, not committed) held Wit on Field 2 for 2.2 s,
  Durability on Field 4 for 1.4 s and Strength on Field 6 for 0.8 s, filled and locked Field 2,
  and submitted early. The review read, at both widths:
  `Field 1 11/11/10/58/10 · Field 2 100/0/0/0/0 (locked) · Field 3 20×5 · Field 4 20×5 ·
  Field 5 16/16/16/16/36 · Field 6 26/19/19/18/18 · Field 7 20×5`, every row summing to 100 —
  the placed points kept, the locked field untouched, the unplaced remainder spread evenly with
  its indivisible part in fixed stat order (the 8 Strength on Field 6 became 26/19/19/18/18).
- Seen in the captures: the painted map with its forest surround, wandering sprite crowds with
  count chips in the stat's colour, plaques reading `48 / 100` over `52 left`, the tray's five
  painted Blottos with the armed card lifted, the stepper with the sprite and the eight keys,
  the calm clock plaque, "0 / 7 battles full", the hint line in the mockup's words.
- One thing to watch on the play page: the app's sticky header overlaps the top of the stage when
  the page is scrolled so the stage's top edge sits under it, as any sticky header does with
  anything beneath it. The `#demo` anchor uses `scroll-mt` so the link lands clear; the journey
  test centres the board for the same reason.

## 8. Retiring the dial run (2026-09-24, evening)

The founder approved the dead-code plan (`https://claude.ai/artifact/365wm7k97EiDPFGWARAu6G`)
the day the board went live for everyone. This is its first change (PR): the dial run and the
switch that guarded it are gone, and a rollback to the dials is a `git revert` of this change.
The board, the seal stage, the payload format, the program and the engine are untouched.

| Removed | What it was |
|---|---|
| `battle/components/battle-flow.tsx`, `battle/machine.ts` (+ test) | the seven-screen dial host and its reducer |
| `battle/components/seven-tiles.tsx` + `.css` | the rack of seven under the machine |
| `components/blot/StatDials.tsx`, `Cabinet.tsx` + `cabinet.css`, `Timer.tsx` | the dials, the cabinet frame, the slate ring clock |
| `components/blot/dial-thermals.ts`, `rebalance.ts` (+ tests) | dial warmth and the dial-coupling rule |
| `battle/board/switch.ts`, its `.env.example` entry | the switch |
| `components/ui/prize-table.tsx`, `rank-badge.tsx` | per-position prize UI, unused since D-E2 (one paid place) |
| `components/blott/Antics.tsx` `Playground`, its `blott.css` rules | the dancing band under the dial rack |
| `public/candy/lock.webp` | the padlock beside the dial seal |
| 22 copy keys (`battle.screenOf` … `battle.sealAfter`, `landing.tryDials`, `demoHint`, `demoStatus`) | read by nothing once the above left |
| the dial and lock-in rules in `blot.css`; the RunClock value type and the 90 s budget in `run-clock.ts` | only the dial run and the dev gallery used them |
| the journey's practice-machine test; the gallery's dials, prize-table and rank-badge sections | their subjects are gone |

**Moved first, so no import broke:** `ReviewSealApi` now lives in `app/play/seal-stage.tsx`,
whose widget slot it describes. The dev seal-stage preview portals the board's own
`ReviewPanel` into that slot instead of the dial rack.

**Kept on purpose:** `usePrefersReducedMotion` in `components/blot/springs.ts` (used across the
site); `BlotMorph` and its geometry (the pool page's Blot); the Runner and Peeker antics; all
twelve Blott pose images, including the three nothing requests today (dance, sleep, strain),
because they are the founder's character art and a future screen may want them.

**Judgement call:** the `trophy` bounce on the sealed panel reused the Playground's
`blott-bounce` keyframes; they were kept, moved beside `.blott-sealed`, byte-for-byte.

**Open items this surfaced, not changed here:**
- **Player-facing copy still states the dial clock.** The landing's "Set seven battles" step
  (`landing.steps`) says "about ninety seconds for all seven", and the rules text
  (`copy/index.ts` near the "You then set seven battles" line) says "about ninety seconds in
  total". The board runs three minutes. Founder-owned words, so flagged rather than edited.
- **Detection's timing note** (§2, "Timings for detection") is owed in
  `backend/detection/src/signals.ts`, including its comment that `run-clock.ts` applies the even
  split — the board's buzzer spread does that now.
- **The Blott stills are dark for new entries** (nothing writes them since the board). Retired
  in §9.

## 9. Retiring the Blott stills (2026-09-24, evening)

The plan's second change, on the founder's approval ("go ahead as planned", which carried the
plan's recommendation (a): retire). The dial run drew each locked battle as a 1024² picture of the
Blott and kept it in the browser's IndexedDB (`blotto-blots`); the profile's "My Blotts" grid and
the results page's "Share your seven" read those pictures. The board draws none, so both had gone
dark for every new entry. Both are removed, and so is everything only they used.

| Removed | What it was |
|---|---|
| `components/blott/BlottRaster.tsx`, `render-still.ts`, `warp.ts` (+ test) | the WebGL-warped Blott and the still renderer |
| `battle/stills.ts`, `stills-sweep.ts` (+ test) | the IndexedDB store and its data-minimisation sweep |
| `battle/montage.ts` (+ test) | the seven-still share image |
| `app/profile/my-blots.tsx`, `app/pools/[pool]/results/share-seven.tsx` | the two features, unmounted from the profile and the results page |
| 13 copy keys (`profile.myBlots`, `myBlotsNote`; `results.sevenHeadline`, `sevenAlt`, `shareSeven*`; `battle.montageFooter`, `share`, `shareFallbackCopied`, `shareX`, `shareXNote`, `blottAria`) | read by nothing once the above left |
| the raster's rules in `blott.css` | `.blott-frame`, `.blott-canvas`, `.blott-fallback` |

**Added:** `storage/forget-blott-stills.ts` (+ test) and a render-nothing `<ForgetBlottStills />`
in the root layout. On each visit it asks the browser to delete the `blotto-blots` database, so
devices that played under the dials forget their pictures, in line with the 2026-09-15
data-minimisation ruling. It is best-effort and idempotent, never throws, and touches no
network. It can come out once returning devices have had time to visit.

**Unchanged on purpose:** the content security policy still allows `blob:` images, because the
character pass card is a canvas blob. The pass card's own share is untouched.

**Published claims:** the privacy notice never described the stills, so nothing in it changes.
It does say it keeps "the time you spent on each screen"; under the board that is each field's
last-change time (§2, "Timings for detection"). Founder-and-counsel text, flagged, not edited.

## 10. A standing gate against the next dead file (2026-09-24, evening)

The plan's third change. `scripts/check-dead-files.ts`, run in the `standing-rules` lane of
`ci-fast`, fails a build when an app source file is reachable from no route Next serves
(production or `page.dev.tsx`) and is not declared in the script with a reason. A file only its
own test imports counts as dead. One declaration today: `reveal/fixtures.ts`, test support.

It self-tests before reporting, reads `app/src` as text so the lane installs nothing, and
reports unresolvable imports and stale declarations too, so it cannot go quietly blind. Run
against the tree between §8 and §9 it named exactly the three orphans §9 removed
(`BlottRaster.tsx`, `render-still.ts`, `warp.ts`). It does not judge unused exports, copy keys or
public assets, which are often named by template strings; those stay with the next audit.
