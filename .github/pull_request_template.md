<!--
  Keep this short. The diff says what changed; this says why, and how you know
  it works. Delete any section that does not apply rather than writing "n/a".
-->

## What this changes, and why

<!-- One paragraph. If it fixes something, say what was wrong. -->

## How it was verified

<!--
  Paste what you ran and what it said. CONTRIBUTING.md lists the twelve
  standing-rules checks; a change to `programs/` or `tests/litesvm/` is NOT
  covered by the fast lane and needs the on-chain lane too.
-->

- [ ] `./scripts/check-language.sh` and `./scripts/check-standing-rules.sh`
- [ ] The suites for what this touches (`app`, the backend package, `cargo test --workspace`)
- [ ] For a program change: `anchor build` and `cd tests/litesvm && cargo test`

## Anything a reviewer should know

<!--
  Judgement calls made under uncertainty, anything deliberately left out, and
  anything you are unsure about. A `PHASE-N-REVIEW` comment in the diff belongs
  here too.
-->

## Rules this touches

<!--
  Tick only what applies, and say where in the body. These are the ones that do
  not bend — CLAUDE.md has them in full.
-->

- [ ] On-chain money paths, or the pass mint
- [ ] Anything in PID §8 (the legal characterisation) — **founder and counsel own this**
- [ ] A founder-owned value: `config/*.json`, prices, pots, the fill rule, the territory schedule
- [ ] A published claim a player reads — is it still true after this change?
