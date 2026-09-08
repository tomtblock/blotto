# Fair play, and the pages checked against the PID — 2026-09-08

Branch `claude/fair-play` (carries #89, whose 52-seat evidence the page shows). Answers the
founder's ask for a page that puts the skill evidence, the wallet screening, the 18+ rule and
the territory list in front of players, and for every page to say what is built.

## What is built

- **`/fair-play`** (`app/src/app/fair-play/`): "Skill, measured" (the study's first-place
  rate per player class at 64 and 52 seats, straight from `docs/skill-evidence/results.json`),
  "Every wallet is checked" (entry and winner screening as mechanisms), "Adults only", "Where
  you can enter" (the founder-owned schedule), "Nothing random decides a result", and "Check
  it yourself" (Verify, custody, rules). Linked from the landing rail, the pool page and the
  rules page.
- **`results.json`**: the study runner now writes the CSV re-shaped as JSON beside it and the
  nightly reproduction compares all three files. `fair-play.test.ts` asserts JSON == CSV, so
  the page cannot show a number the nightly run does not reproduce.
- **`config/custody.json`** populated with the devnet register (program, upgrade authority,
  1-of-1 multisig, admin vault, entry signer, settlement signer, publishing wallet). The
  custody page had rendered nine "not yet set" values since 2026-08-27; it now renders one
  (the timelock, which is genuinely unset).

## Copy that now matches the build (PHASE-N-REVIEW, founder may veto any line)

1. `COPY.pool.sealed` said "a key nobody holds"; the key is generated and held by our
   systems, export-locked until the pool closes (`backend/sealing/src/custody.ts`,
   `rules.sealing`). Now says so.
2. `COPY.howItWorks.steps[1]` said "fifteen seconds per screen" (R9); the client runs one
   ninety-second budget for all seven (R9-b, `run-clock.ts`), and two other strings already
   say so. Now "about ninety seconds for all seven".
3. `COPY.rules.howToEnter` now discloses that every wallet is screened **at entry** (it was
   true and unstated — only the winner check was published). Registered in
   `published-claims.test.ts` with its proof.
4. `COPY.custody.upgradeAuthorityNote` said "held by a multisig" beside a value that is a
   single operator key on devnet; it now says both halves.

## Title

`COPY.fairPlay.title` is "Fair play". The founder's working title asserts a legal status,
which D-B7 forbids in public copy; counsel decides the final wording, and it is one key.

## Not changed, founder / counsel

The territory list (BE + AU vs PID §9); KYC threshold; the "different reviewer" sentence
against a one-member registry (reviewer #2 stays a placeholder as directed); PID v0.6.

## Verification

tsc · eslint 0 errors · 285 app tests (43 files; `fair-play.test.ts` new,
`custody.config.test.ts` re-pinned to the populated register) · rehearsal 25 · the three
gates · `next build` · browser: `/fair-play` renders the four rows with the study's figures,
`/custody` renders one "not yet set".
