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

### F-2 · The entry gate can close for everyone while `/health` reports healthy

**Severity: the highest the test has found.** On mainnet this is every entry failing while every
instrument says the platform is fine.

**What happened.** At 18:20Z on 2026-09-16 the founder's entry was refused by the live site. It was
not their account: probing from the test container with wallets we control got the same refusal for
all of them — a fresh wallet, a never-attested control, and a wallet that had entered pool 14
successfully sixteen hours earlier — on both open pools, with attestations the service itself
accepted. Every entry, everywhere, refused.

**Why it is invisible.** `issuePacket` wraps every check in one try/catch and answers a deliberately
uninformative rejection on any throw, so the gate cannot be probed. That is correct for a player and
correct for an attacker. The problem is what the OPERATOR can see. The sanctions mirror **throws**
once its snapshot passes 36 hours, on the sound principle that a stale list is a failed source
rather than a clean answer — and a failed background refresh **keeps the old list and clears no
flag**. Meanwhile `/health` reports `ofac_loaded`, which is set true at boot and **never set back to
false**: not on a failed refresh, not when the data ages out.

So the single endpoint an operator checks reports `ok: true, ofac_loaded: true` throughout a total
entry outage. It did while I wrote this.

**What it costs.** Here, a day of the test. In production, the entire entry revenue of however long
it takes somebody to notice by other means — and nothing in the monitoring path would be the thing
that told them. The staleness alert exists (B-28), so the alerting is there; the gap is that the
signal an operator actually reads cannot go red.

**Proposed fixes — two, and the second is the one that matters.**

1. Make the mirror refresh's failure visible where it is looked for: have `ofacLoaded` reflect
   whether the snapshot can still answer, rather than whether one ever loaded, and let `/health`
   report degraded when it cannot. That is a few lines in `backend/sanctions/src/wire.ts` and
   `backend/packet/src/server.ts`.
2. More generally: **every condition that closes the gate for all callers should be readable from
   the health endpoint.** The uniform rejection protects the gate from being probed by a player; it
   should not also hide the gate's state from the operator. Those are different audiences and the
   code currently serves them with one answer.

Neither is made here — `backend/` is outside this week's boundary. F-22 is the operational half:
which of the two possible causes it actually was, which one log line settles.

---

## 9. Open items

Every `FAIL` or `UNFROZEN` row in `RESULTS.md` must appear here by test id, and
CI refuses the default branch otherwise.

**No `FAIL` or `UNFROZEN` result so far.** T1 is `PASS`.

Open, but not a failing test:

| # | Item | Blocks | Owner |
|---|---|---|---|
| F-20 | Does the reveal gap (§2, F-1) become a product PR after the week? | nothing — every remaining test proceeds either way | founder |
| F-22 | The entry gate is refusing every entry (§2, F-2). One log line names the cause. | **T4, and every test after it** | founder |
