# app/src/rules

The published rules page. Built; the page renders from `app/src/app/rules/rules.config.ts`, whose
section bodies come from `app/src/copy/` and whose numbers come from the shared constants rather
than being typed in.

## What this page must always state, before payment

Compliance item C4. It blocks launch, so its contents are not a matter of taste:

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
- The detection criteria and the appeal route. ⚠ The appeal route is **published and not built** —
  see `01_PRODUCT_FACTS` §9 and the audit's open items; `app/src/copy/published-claims.test.ts`
  holds the register.
- The restricted-territory schedule, matching the block actually enforced (PID §9).
- The Squads vault address and signer list (playbook §4.2).

Language is governed by PID §8.7 — see `CONTRIBUTING.md` → "The language gate".
