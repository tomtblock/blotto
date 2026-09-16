# REPORT — the devnet battle test

One document that makes the week's result unambiguous. `RESULTS.md` is the
one-screen scoreboard; this is the reasoning behind it, the product findings
the test turned up, and the open items.

Written as the week runs, not at the end. A section that says "not yet" says so
honestly rather than being left blank.

---

## 1. What was tested and what it cost

See `RESULTS.md` for the per-test verdict table and `registry/*.reconcile.md`
for each test's line-by-line diff of prediction against outcome.

## 2. Product findings

Findings about the **product**, discovered by running it. Each one is traced to
source in `DRIFT.md` §H and repeated here in the terms a decision needs. None of
them has been fixed here: `app/`, `programs/`, `backend/` and `tests/` are
outside this week's source boundary by design, so the test observes and reports
and changes nothing.

### F-1 · A refunded pool never reveals its sealing secret

**Severity: the verifiability claim, on the refund path only.** Not money, not
the legal position. Nobody is out a lamport — every refund landed correctly.

**What the product promises.** The program's own reveal handler says it, in its
doc comment: reveal is allowed past the fill deadline so that *"a `Refunding`
pool's entrants can then verify no one — operator included — could have read
allocations before the refund."* The on-chain gate delivers on that: it accepts
a reveal from any pool that is not `Open`, or is past its deadline.

**What the product does.** Nothing asks. The only production call to
`revealPoolSecret` sits inside `assembleBundle`, and `crankPool` returns for a
`Refunding` pool and no-ops for a `Closed` one, both before reaching it. There
is no operator fallback either — `admin.ts` has twenty-one commands and none of
them reveals a secret. Custody would release the secret if anything asked; the
export policy already permits it.

**Evidence.** Pool 14 refunded all twelve seats correctly and reached `Closed`
at 13:50 UTC on 2026-09-16. Its `secret_revealed` byte still reads `0` on
chain. And it is not pool 14: **every** pool that has ever closed by refund on
this devnet — 9, 10, 11, 12, 13, 14 — reports no secret. Not one has ever
revealed. Full citation chain in `DRIFT.md` §H1.

**What it costs a player.** An entrant in a refunded pool gets their money back
but cannot check the one thing the reveal exists to let them check: that their
sealed allocation stayed sealed. They are asked to take the operator's word on
the one point the whole design exists to put beyond anyone's word. That is
tradeoff-order #3, and it is why this is written up rather than noted.

**What it cost the test.** T1's twelve allocations are permanently `COMMITTED`
and can never reach `VERIFIED`. T2 (39 seats) will land in the same place. It
does not change T1's verdict: T1 tested the refund path and every frozen
prediction held.

**Proposed fix — a founder call, not an architect one (F-20).** Reveal before
the refund fork returns. The natural shape is to hoist the export-and-reveal
step out of `assembleBundle` into `crankPool` ahead of the `Refunding` branch,
so both forks pass through it, and to let the `Closed` branch reveal too when
the secret is still unrevealed — that second half is what would repair pools
9–14 retroactively, because the on-chain gate still accepts them today. An
`admin.ts reveal-secret` command is the smaller alternative and leaves the
promise depending on an operator remembering to run it. The recommendation is
the first: a published promise should not need a human in the loop.

---

## 9. Open items

Every `FAIL` or `UNFROZEN` row in `RESULTS.md` must appear here by test id, and
CI refuses the default branch otherwise.

**No `FAIL` or `UNFROZEN` result so far.** T1 is `PASS`.

Open, but not a failing test:

| # | Item | Blocks | Owner |
|---|---|---|---|
| F-20 | Does the reveal gap (§2, F-1) become a product PR after the week? | nothing — every remaining test proceeds either way | founder |
