# CHANGE — 2026-09-24: the battle board (Phase A), and the two modes it prepares for

**Status: Phase A merged to `main` (PR #176, 2026-09-24); the board is the only run. The switch
that made it the default (PR #177) and the dial run it guarded were removed the same evening
(§8); a rollback is now a revert of that removal, not a setting.**
Phase B (the hard-mode pool) is in progress: the program change is §11; the backend, the app
and the upgrade window follow in that order. The Phase A plan the founder approved is
`https://claude.ai/artifact/RufrDt16swq46bCkNkdyGP`; the Phase B plan (approved 2026-09-24,
"go with all recommendations") is `https://claude.ai/artifact/UWMVuKAWrbvsLENSnDiNUT`; the
wireframes are `https://www.figma.com/design/cIzgzj8m77Oeo0JMOK2zZ4`.

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

Built since (§11): `Pool.mode` and the appended hard ladder on `Config` with their migrations;
`open_pool(…, mode)`; `PoolOpened.mode`. Still to build: the mode-aware invariant and the `u16`
encoding for hard battle sets; bundle version 3; the crank reading the pool's mode; the verify
page's mode; indexer migration `0025`; the keeper per (tier, mode); `admin.ts set-open-tiers
--mode`; the hard-mode evidence run; the terms version bump (plan A7, founder to confirm); the
docs sweep (`AS-BUILT`, `PRODUCT-FACTS`, `HOW-IT-WORKS`, TECH-ARCH appendix, the register rows).
The program upgrade needs a drain window agreed with the battle-test session — the upgrade
pre-flight refuses while any pool is Open.

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

## 11. Phase B, the program change (2026-09-24, night)

The first of the Phase B changes: one program, two ladders. Nothing here is deployed — the
upgrade waits for the drain window the founder sets once the current test pool resolves (Phase B
plan, decision 1). Merging it changes no account on devnet and no running service.

**What the program now holds.** Every tier has an easy slot and a hard slot. `Config` gains an
appended tail — `hard_open_tiers`, `hard_active_pool_by_tier`, `hard_tier_next_open_at`
(`HARD_TAIL_LEN` 119; `Config::LEN` 595, `SPACE` 603, both pinned) — read through
`open_tiers_for(mode)`, `active_pool(mode, tier)` and `next_open_at(mode, tier)`, so every gate
in `open_pool`, `free_tier_slot` and the treasury reserve is per (mode, tier) by construction
rather than by a second copy of the code. `Pool` gains `mode: u8` after `min_seats`
(`Pool::LEN` 842, `SPACE` 850). `open_pool` takes `mode` as an appended argument, refuses
anything but 0 and 1 (`UnknownMode`, 6074 — appended, so no earlier code moved), and records it;
nothing after the open reads it on-chain. `set_hard_open_tiers` is a new instruction with the
same restamp rule as `set_open_tiers`, kept separate so a Squads proposal drafted against the
easy setter keeps its payload and an easy change can never flip a hard tier. Prices, pots and
ceilings stay per tier, shared by both ladders. An idle enabled hard tier reserves a pot exactly
as an idle enabled easy tier does.

**Events.** `mode` appended to `PoolOpened`, `TierSlotFreed` and `PoolMigrated`; two new events,
`HardLadderAdded { migrated_at }` and `HardTiersOpened { open_tiers }`. The shared decoder reads
the appended byte only when it is there (`Reader.tailU8`, `null` on a pre-Phase-B event, which
a consumer treats as easy), so a backfill over the devnet ledger keeps decoding every event it
already holds. `check-mirrors.py` learned that reader.

**Migrations.** `migrate_config` is now the V2 → V3 migration (484 → 603 bytes; hard ladder all
disabled, hard clocks stamped at the migration) and takes no argument. `migrate_pool` accepts
both old sizes: a pre-R7-b pool (847) gets `MIN_SEATS_V1` and `mode`; a pre-Phase-B pool (849)
gets `mode` alone, its floor kept. Both write `MODE_EASY` — hard did not exist when those pools
opened. Permissionless, as before.

**Judgement calls (architect-owned, one line each).**

- *The V1 → V2 Config migration is retired, not kept beside the new one.* Its stated retirement
  condition (every deployment at `SPACE_V2`) was met on 2026-09-13; a 380-byte account is now
  refused (`ConfigNotMigratable`) rather than grown with a zeroed keeper. `ConfigMigrated` stays
  in the decoder for the one event the devnet ledger holds.
- *Two off-chain readers moved into this change rather than the backend one.* The settlement
  client's pool reader (`backend/reveal/src/chain-web3.ts`) is pinned by its own test against
  `Pool::SPACE` in the Rust source, so it had to learn 850 here; it also accepts 849 (the
  pre-migration pools it will keep settling in the window) and reports their mode as easy. The
  shared `Config` decoder likewise accepts 603 and 484 and reports whether the hard ladder is
  present. The keeper's `open_pool` encoding and `admin.ts` are NOT changed here — they are the
  backend change's — which is one more reason nothing may deploy before it lands.
- *The event fixture is regenerated without a hard pool in it.* The indexer's projection does not
  yet know `mode` (migration `0025` is the backend change), and a fourth pool would have moved
  every count its suite pins for no gain until it does. The fixture does carry both new events
  and both `migrate_pool` shapes.

**Verified.** Program unit tests (the layout pins updated); the whole LiteSVM suite against the
built artifact, with a new `hard_mode.rs` (the hard ladder starts disabled and has its own
switch; easy and hard pools run side by side on one tier with separate slots and cooldowns; an
idle enabled hard tier reserves a pot, at the open gate and the withdraw floor, to the lamport;
a full hard pool settles to Paid and frees the hard slot; the 849-byte `migrate_pool` path keeps
the floor and marks the pool easy) and the config-migration test rewritten for V2 → V3; the
shared, reveal, indexer and app suites and typechecks; every `ci-fast` gate. Two indexer specs
that addressed the fixture by transaction index, and one that took "the first seat 0" from a
map ordered by random player keys, were made to find their rows instead.

## 12. Phase B, the backend change (2026-09-25)

The second Phase B change: every service learns the pool's mode. Nothing here is deployed either;
the backend deploys in the drain window, after the program upgrade (Phase B plan, decision 1), and
this change is the reason nothing may deploy before it — the keeper's `open_pool` now carries the
appended `mode` byte the upgraded program requires.

**The hard rule, in one module.** `backend/scoring/src/allocation.ts` holds both placing rules:
easy (each battle sums to 100, one byte per stat, 35 bytes) and hard (the thirty-five stats sum to
700, two bytes little-endian per stat, 70 bytes). Every function takes the mode and defaults to
easy, so every pre-Phase-B caller keeps its meaning; the comparison and the ranking are mode-blind.
The commitment is `sha256(canonical bytes ‖ salt)` over the mode's encoding, so the same numbers
commit differently under the two modes — the mode is part of what was committed to. The sealed
payload follows (127 bytes easy, 162 hard; `backend/sealing/src/payload.ts`).

**The Python oracle** (`backend/scoring/fixtures/gen_vectors.py`) gained a hard stream (700 over
35 cells by 34 sorted dividers), six hand-checked hard comparisons (a 5–0 sweep, which easy cannot
produce; a battle holding nothing; a board in one battle), five four-player pools, a full 64 with
the tree, the minimum field, a stacked-edges pool, a lost-ciphertext pool, and hash cases including
the same numbers hashed under both modes. `check-fixtures.sh` reproduces all of it.

**The crank and the keeper.** The crank reads `Pool.mode` and decodes, hashes and scores every
payload by it; a payload of the other mode's length fails to decode and is scored as a lost
ciphertext, never guessed. The bundle is **version 3** and names `mode`; a version-2 bundle reads
as easy. The keeper walks both ladders (`backend/reveal/src/treasury.ts`): lowest tier first, easy
before hard at one tier, an idle enabled hard tier reserving a pot exactly as an idle easy one; the
parity suite drives the mirror and `FakeChain` through the two-ladder cases. The next-place driver
recomputes the ranking under the pool's mode.

**The indexer.** Migration `0025_pool_mode.sql` adds `pools.mode` and keys `tier_status` per
(tier, mode), with the rederive marker. `GET /pools` serves `mode` (`'easy' | 'hard'`) and takes
`?mode=`; `GET /tiers` carries the hard ladder per tier under `hard` (its own switch, resolved
chain → `HardTiersOpened` ledger → all closed, and its own cooldown stamp) — the app decides from
`hard.enabled` alone whether a hard card exists. `GET /treasury` counts both ladders in the floor
and publishes the hard slot's status per tier.

**The packet service** accepts a sealed box of either mode's length up front and then holds it to
the POOL's mode, so a board placed under the wrong rule is refused before the player pays rather
than scored all-losses after.

**Operator tools.** `admin.ts migrate-config` takes no argument (V2 → V3, 484 → 603);
`migrate-pool --all` walks every pool and grows either old size; `set-open-tiers --mode hard`
sends `set_hard_open_tiers` and refuses until the Config is migrated; `status` prints the hard
ladder and `pools` a mode column. `check-deployed` expects the new layout and the new
instruction. The runbook these messages point at (`docs/RUNBOOK_phase-b-window.md`) is written
with the window steps in the next change.

**Judgement calls (architect-owned, one line each).**

- *Detection thresholds are unchanged.* The near-duplicate rule is an L1 distance over the
  thirty-five compared values, and a board's total mass is 700 in both modes, so the same
  threshold means the same thing; the "multiples of 10" and "identical battles" signals read the
  same shape. Noted in `signals.ts` rather than tuned.
- *The rehearsal harness still plays easy.* Its two hand-built pool views carry `mode: 0`; hard
  strategies for the evidence run are the next change's.
- *`decodePayload` takes an explicit mode rather than inferring it from the length.* Inference
  would have let a hard box in an easy pool decode "successfully" and then fail the hash — a
  quieter failure than the length refusal, and one the packet route now catches earlier anyway.

**Verified.** Scoring 137, sealing 40, reveal 207, indexer 130, packet 226, Postgres 45 (the
migrations from an empty database, against a local Postgres 16), rehearsal 29 and app 552 passing;
every typecheck including the two operator scripts; every fast gate (language, standing rules,
mirrors, fixtures, env examples, published numbers, dead files, the two self-tests).

## 13. Phase B, the app change (2026-09-25)

The third Phase B change: the app reads the pool's mode and shows two pools. It auto-deploys on
merge and is SAFE AGAINST TODAY'S BACKEND by construction: `PoolSummary.mode` and
`TierStatusRow.hard` are optional, absent reads as easy / not enabled through `poolMode()`
(`app/src/data/format.ts`) and one `hard?.enabled === true` test, and a version-2 bundle reads as
easy (`bundleMode()` in `app/src/verify/logic.ts`). Until the backend redeploys in the window,
every page renders exactly what it rendered before this change.

**The landing (founder: "two long rectangle playing cards side by side").** `app/src/app/page.tsx`
now renders one `PoolCard` per open pool — the lowest-tier easy pool on the left, the lowest-tier
hard pool on the right, each with its mode on the top edge, its own seat ring, pot, entry and
deadline clock (the pools run on separate timers), the §8.6 line above its own Enter, which goes
to `/pools/{pool}` and from there the play page reads the same record. When the hard ladder is
enabled on chain (`GET /tiers` → `hard.enabled`) and no hard pool is open yet, the right card is
"Opens soon" (`HardOpensSoonCard`); when the hard ladder is not enabled the page is single-card as
before. There is no switch in the app — the card exists on the data alone (Phase B plan, 3). The
hero's own control goes to the easy pool when one is open; the landing demo stays easy (5). The
motion rule (one ambient loop per viewport) is kept: the loop plays on the first card only, the
second wears the clip's poster still. The fixtures ladder gains a hard row per tier where the hard
ladder is enabled or a hard pool is running.

**Every pool surface names the rule.** The pool page badge (`data-testid="pool-mode"`) and the
"How this pool plays" box read the record; the pools index sorts easy before hard within a tier
and prints the mode per row; the results page carries the badge; `BoardFlow` validates the
finished board under the pool's rule (each battle 100, or the board 700) and `submitForReveal`
encodes and hashes the payload under it (`app/src/entry/submit.ts`); the verify page and the
what-beat-you view decode the bundle under its own `mode` and treat a payload that fails to decode
as a mismatch rather than a crash.

**Fixtures and the journey.** The catalogue gains `hard-open` (id `FIXTURE-HARD`, tier 0, five
seated, its own clock) and the fixture `GET /tiers` enables the hard ladder at tier 0, so the
fixture landing renders both cards. The journey suite asserts the two cards, each badge, each
clock, no "Opens soon" placeholder while a hard pool is open, and that each card's Enter lands on
its own pool page wearing the right badge. The committed screenshots are regenerated by that run.

**Copy (PHASE-N-REVIEW: drafts; founder and counsel own the words).** The landing's "Opens soon"
title and body and the card's mode label; a hard-pool clause in the metaDescription and in the
"Set seven battles" step; one sentence in the rules' how-to-enter naming the hard rule. The
battle-timer paragraph is unchanged on purpose: the even-split default and its three-to-two loss
hold in both modes (a hard board also opens at seven even splits, 7 × 100 = 700).

**Verified.** App typecheck, 552 unit tests, lint, the fixture-mode production build and the
journey suite (18 of 18, both viewports); the language, dead-files and published-numbers gates.

## 14. Phase B, the evidence run and the window (2026-09-25)

**Merged.** #181 (program), #182 (backend) and #183 (app) are on `main`, in that order, each with
its lane green. Merging deployed nothing on chain or on Fly (`deploy-backend` runs only when the
founder clicks it); the app deployed on merge and renders as before until the read API serves a
mode. The window that deploys the rest is `docs/RUNBOOK_phase-b-window.md`: ten steps, the two
Squads proposal payloads emitted against the live account (`migrate_config`: `XIM6adKa4ME=`;
`set_hard_open_tiers` tier 0: `UB9Khs8AtqgBAAAAAAAA`), and the terms bump as its last step.

**The hard-board evidence** (`docs/skill-evidence/hard/REPORT.md`, plan decision 6). The
rehearsal's ladder learned the hard rule (`tests/rehearsal/src/ladder.ts`, "THE HARD LADDER"):
uniform is still 20 a stat (the hard board's buzzer default, 700 / 35); random is 700 over 35
cells; heuristic concedes two battles and stacks five at 140 across a trio; optimised is that
family tuned. `runOfflinePool` takes a `mode` and the study runs under it through the same crank.
Two hundred pools per run at 64 and 40 seats, deterministic from the base seed, checked nightly
beside the easy study. What it reports: **optimised takes 6.09% of seats' pots at 64 (baseline
1.56%) and 9.25% at 40 (baseline 2.50%); heuristic 0.16% / 0.80%; random and the default 0.00%**
— the spread between considered and unconsidered play is wider under the hard rule than the easy
one, because conceding a battle is a decision the easy rule cannot express. The **draw rate** of
free-integer boards against each other is **4.65%** at 64 seats (the easy study's construction
sits near 7%); stacked classes draw 37% of their battles against each other, almost all of them two
conceded battles meeting. Homogeneous fields sit at the baseline exactly, as in easy.

**Judgement calls (architect-owned).**

- *The stacked-five shape is this architect's reading of the rule, not a measured optimum*
  (`PHASE-N-REVIEW` in `ladder.ts`). The report claims what it measured against the other rungs
  and no more.
- *The hard report's reading of the default rows carries the 2026-09-19 correction* (structural
  versus population) rather than the superlative the renderer still prints for easy. The easy
  `REPORT.md` was corrected by hand on 2026-09-19 and its renderer was not, so **the nightly
  skill-evidence lane has been red since 2026-09-20** (runs 24–28); the CSV and JSON reproduce,
  only the report's prose differs. Not fixed here — the correction's table was measured by a run
  that is not in the repository, and porting numbers into a generator by hand is the thing the
  generator exists to prevent. Recorded in `docs/INDEX.md`'s skill-evidence row for the founder.
- *No `PRODUCT-FACTS` edit*: `../01_PRODUCT_FACTS/` is outside this repository. Its "each battle
  100 points" facts need the same sentence `AS-BUILT.md` §1 now carries, in the same change set
  as the window.

**Verified.** Rehearsal typecheck and suite (the hard ladder's validity, determinism, the two
conceded / five stacked shape, a four-pool hard study conserving the pot); the easy study's CSV and
JSON reproduce byte for byte after the change; the language gate.

