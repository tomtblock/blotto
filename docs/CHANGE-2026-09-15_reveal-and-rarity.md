# 2026-09-15 — the reveal removed; rarity is a Common→Mythic ladder, shown on the profile only

**Produced:** 2026-09-15, on `claude/nice-turing-k0ipl5-reveal`, from `main` at `4a5f308`.
**Instructions this implements, in the founder's words and with their dates:**

| Date | Instruction |
|---|---|
| 2026-09-14 | *"I am also seeing the rarity draw (goblin, wizard etc) and the egg appearing on my screen … remove this step from the frontend UI. The rarity assignment will happen quietly under the hood and will not be something initially broadcast to users."* |
| 2026-09-14 | After the entry confirms: **"Share card, minus the character"** — straight from the wallet signature to a share card stripped of class and rarity. |
| 2026-09-14 | *"change the tiers to go from Common through to Mythic. Make sure to document wherever the rarity is mentioned for a player to view. Caveat it …"* — and, on the caveat's wording, *"I accept your suggestion re: wording"* (§4). |
| 2026-09-15 | Where a player still sees rarity: **profile only, with the caveat.** |
| 2026-09-15 | Creature names: **tier names only — drop Goblin / Knight / Wizard / Dragon / Titan.** |

**Status of this document:** a change report, written from the branch it describes. Nothing here
touches the program, the backend, `config/*.json`, or PID v0.5.

---

## 1. What a player sees now

| Moment | Before | After |
|---|---|---|
| Wallet signature → chain confirms | An egg to tap; it cracks per tap; on confirmation it bursts and **tells the class** (Goblin … Titan) with a colour flash | A quiet waiting hold — *"Confirming your entry with the network. Nothing more is needed from you."* — then the card |
| The card | Class name, rarity tier, "N of every 64 passes", a class-hue halo, the seat, Share / Post on X | **"I'm in." · Pool #n · Seat n of 64**, the mascot, Share / Post on X / Back to homepage. No class, no tier, no hue |
| The shared PNG | Same as the card, class and all | Same as the card: pool and seat, nothing drawn |
| The public card image (`/card/<pool>/<player>`) | Class name · seat | Seat only |
| Profile → "Character collection" | Five columns labelled Goblin … Titan | Five columns labelled **Common · Uncommon · Rare · Epic · Mythic**, with the caveat beneath (§4) — **the one place rarity is shown** |

The five looks and their hues are untouched; only the labels changed. The class is still drawn
on-chain from the published `class_counters` bag and stays replayable from published events — it
is simply not announced.

## 2. The ladder

Five classes, five tiers, in the program's own index order (`LAUNCH_CLASS_COUNTERS = [38, 15, 7, 3,
1]`, `programs/blotto_cup/src/constants.rs`). No on-chain value changes; the label is a copy string.

| Class index | In a pool of 64 | Was named | Now named |
|---|---|---|---|
| 0 | 38 | Goblin | **Common** |
| 1 | 15 | Knight | **Uncommon** |
| 2 | 7 | Wizard | **Rare** |
| 3 | 3 | Dragon | **Epic** |
| 4 | 1 | Titan | **Mythic** |

`COPY.reveal.rarityNames` already carried these five words (the card used to show both names);
`COPY.reveal.classNames` — the creature names — is gone, and every consumer with it.

## 3. The code

### 3.1 The machine kept its job and lost its theatre

`app/src/reveal/machine.ts` was a pure reducer driving seven beats: `entry → revealing → strain →
tell → unseal → card → settled`, plus `failed` and `stalled`. Four of those existed only to draw the
egg. They are gone; the invariants that were never about the egg survive unchanged:

- **Confirmed-before-card** — `card` holds a branded `ConfirmedOutcome` that only `tx_confirmed`
  can mint; the exhaustive reachability test still proves no state carries outcome data without it.
- **Stall ≠ failure** — `stalled` only via the stall timer, `failed` only via `tx_failed`. The timer
  moved from the old strain beat to the waiting beat, since waiting is now the entry beat.
- **Resume from stalled** (founder-ratified 2026-08-11) — a late confirmation on the come-back screen
  shows the card; never a restart, never a dropped outcome.
- **The three honest exits** (audit O25) and every per-failure-kind ruling (C-14, D-12) — untouched,
  test for test.

New in the machine: **the visual projection carries no class in any beat.** `RevealVisual.card` is
`{ entryIndex, asset }`. A component rendering from the projection cannot show the class even by
accident — the same structural guard the old tell used, now applied to everything.

### 3.2 Deleted, because it existed only to draw the egg

| File | What it was |
|---|---|
| `reveal/stages/reveal-stage.tsx` (558 lines) | The egg, the tapping, the tell, the unseal |
| `reveal/components/pass-shell.tsx` | The SVG shell the stage drew |
| `reveal/fragment-geometry.ts`, `reveal/reveal-geometry.ts` | Fixed shard-flight and reveal-line geometry (NG-007) |
| `reveal/class-colour.ts` | The class → hue token map the tell used |
| `reveal/copy.ts` | The `EGG_*` strings and the tap-target label |
| `reveal/stages/use-reduced-motion.ts` | The stage's reduced-motion hook; no other importer |
| ~40 constants in `reveal/constants.ts` | Tap count, jolt, leak, bleed, burst and flash magnitudes; the extended-tell class threshold. `STALL_THRESHOLD_MS` is the one that stays |

1,193 lines removed from `app/src/reveal/` across 11 files.

### 3.3 The surfaces

- `app/play/reveal-host.tsx` — renders the waiting hold, the come-back state, the failure, the card.
  No stage, no egg guide.
- `app/play/pass-card.tsx`, `compose-pass.ts` — no `classIndex`, no class line, no tier line, no
  class-hue halo (a fixed brand-pink one instead, the same on every pass).
- `app/card/[pool]/[player]/route.tsx` — the class name is out of the public OG image.
- `app/profile/profile-client.tsx` — the collection relabelled with the tier names; the caveat beneath.
- `components/ui/pending-panel.tsx` — `PendingPanel` extracted from `play-client.tsx` so the takeover's
  waiting beat can use the same hold without a circular import.
- `copy/index.ts` — `reveal.classNames` removed; `reveal.confirming` and `profile.rarityCaveat` added;
  `reveal.cardTitle` is "Your pass"; `reveal.passShareLine` no longer says "the look you drew".

## 4. The caveat — what was ruled, and what was not built

The founder's first wording was *"this rarity means nothing right now, but it might mean something
in the future…"*. The second half was flagged and not built: it tells a paying player that a random
draw may later carry value, which inverts the PID §8.4 position — the class is decorative and worth
nothing — that the legal characterisation rests on. Pay a fee → receive a random outcome → the
outcome may be worth something later is the structure regulators look at, and this would put it in
writing on the screen a player reads after paying. `CLAUDE.md` places anything touching §8 with the
founder and counsel without exception. **The founder accepted the safe wording on 2026-09-14**, and
that is what ships, beside the collection on the profile:

> Rarity is decorative. It changes nothing: not your battles, not your score, not your ranking, and
> no prize. A Mythic's Strength is worth exactly a Common's.

If a forward-looking line is ever wanted, it goes to counsel first. The reasoning sits in the code
beside the string (`copy/index.ts`, `profile.rarityCaveat`).

## 5. Tests — rule 0.7, and the one thing it does not cover

**Rewritten in place** (a test encoding a replaced rule is rewritten citing the instruction, never
deleted): `reveal/machine.test.ts` 27 → 22 cases and `reveal/host-timing.test.ts` 3 → 2, each file
headed with the instruction and each rewritten case commented with what it replaced. The five
machine cases that could not be rewritten because their subject is gone — the held-confirmation
pass-through, the extended tell, the tap no-op scan, the `beat_elapsed` advance, the `tapCount`
parameterisation — are named in the file header.

**Deleted with their modules** — a different act, recorded here rather than buried: a test whose
subject no longer exists cannot be rewritten. `fragment-geometry.test.ts` (4), `reveal-geometry.test.ts`
(5), `class-colour.test.ts` (4), `stage-discipline.test.ts` (6): **19 tests**, every one about the
egg's geometry, colour or choreography discipline.

25 fewer tests in all: 488 → 463, every remaining one green.

## 6. Docs

- `HOW-IT-WORKS.md`, `CLAUDE.md` (the §8.4 example line): *a Mythic's Strength is worth exactly what
  a Common's is.*
- `PID_Blotto-Cup_v0.6-DRAFT.md` §3: the creature column dropped; the profile-only rule stated.
- `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` Appendix A: a dated note — the body's names and its
  reveal are superseded.
- **`PID_Blotto-Cup_v0.5.md` is not edited.** It is founder-owned and still names the creatures in
  §3; it will disagree with the build until the founder reissues it.
- The program's own comments (`constants.rs:162`) still name the creatures. The program was
  redeployed hours before this change and is not rebuilt for a label; the mapping is recorded in §2
  and in the TECH-ARCH appendix.

## 7. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint --max-warnings=0` | 0 |
| `vitest` | 57 files, **463 tests**, all passing (488 − 25, §5) |
| `next build`, fixture mode | clean |
| `scripts/check-language.sh` (§8.7), including this report | clean |
| `scripts/check-standing-rules.sh` | exit 0, no failures |
| Playwright journey, 375 and 1280, fixture mode | **14/14** |
| The pass card cannot show a class | `RevealVisual` carries none — a type-level guard, pinned by the "no visual variant carries a class field" test |

End to end, on the Vercel preview against devnet pool 12: sign in → play a run → seal → **no egg, no
class, no rarity** → the card with pool and seat → the profile's collection under the tier names with
the caveat → `/card/<pool>/<player>` with no class name.

## 8. Still the founder's, and queued separately

- PID v0.5 §3 names the creatures until reissued.
- The ciphertext 409 lockout (a failed first attempt bars that wallet from the pool for good), and
  transaction failures never logging their detail — both found on 2026-09-14, neither in this change.
- The founder asked to scope the end-state of the sealing flow.
