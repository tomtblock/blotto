# app/src/rules

**Status: empty scaffold created in Phase 0. New work — nothing was carried here.**

## What Phase 3 must build here

The published rules page. This is compliance item C4 and it blocks launch, so its contents are not a
matter of taste. It must state, before payment:

- The scoring formula in full, and that every player faces the identical field — no pairing, no
  bracket, no clock.
- The allocation rules: free integers, live normalisation, no presets. PID §8.6 requires these to be
  published *because they are part of why the game is skilful*.
- That decisions are final on submission.
- The fill deadline (12 hours, one clock), the minimum field (52), and the automatic full refund
  below it.
- The fixed prize pool per tier: the winner receives it whole; a tie for first splits it equally;
  a forfeited share passes to the next eligible players and never to the operator.
- How sealing works, described accurately — see the fixed wording in `backend/sealing/README.md`.
- The detection criteria and the appeal route.
- The restricted-territory schedule, matching the block actually enforced (PID §9).
- The Squads vault address and signer list (playbook §4.2).

Language is governed by PID §8.7 — see `CONTRIBUTING.md` → "The language gate".
