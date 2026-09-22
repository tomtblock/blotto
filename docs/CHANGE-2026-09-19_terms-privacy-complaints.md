# CHANGE — 2026-09-19: terms of service, privacy notice, complaints route, retiring the reviewer

**Status: report written from the branch `step/terms-privacy-complaints-2026-09-19`.** Built to
`BRIEF_terms-privacy-complaints.md`. Every player-facing string is a **draft** carrying a
`PHASE-N-REVIEW` note: brand voice and all user-facing language are founder-reserved, and both
documents need counsel before real money moves.

**The documents are in the repository and the pages render, but the draft status is recorded HERE
and not on the page.** A page that announced itself as an unreviewed draft would be worse than one
that does not: a player cannot act on that caveat, and the honest disclosure a player *can* act on
is already on both pages — the operator is not yet named, and no real-money tournament runs until
it is.

---

## 1. What this change is for

There was no terms document. The clickwrap asked every wallet to accept "the terms" and linked to
`/rules`, so what a player agreed to was a description of the game; `config/terms.json` versioned a
document nobody had written. There was no privacy notice. And four player-facing strings said "tell
us" without naming anywhere to tell.

Alongside that, an audit finding (O24) had left a published right unexercisable: the terms and the
rules page promised an appeal "decided by a different reviewer", the founder-owned registry holds
one person, and the service refused a decision from the key that upheld the flag — so no appeal
could be decided by anybody.

---

## 2. What shipped

| # | Piece | Where |
|---|---|---|
| 1 | Founder-owned operator identity, seven keys, all `null`, with a gate that refuses a **mainnet** deploy while any is unset | `config/operator.json`, `scripts/check-operator-identity.ts` |
| 2 | Wallet blocklist: fail-closed parser, consulted in the packet refusal path beside territory, VPN and sanctions, answering the same generic refusal; README with one row per address and the ground relied on; CI check | `backend/packet/src/blocked-wallets.ts`, `config/blocked-wallets.{json,README.md}`, `scripts/check-blocked-wallets.ts` |
| 3 | Complaints route: shared canonical message, five categories, signature required for the two that ask for an outcome to change, append-only store, `GET`/`POST /complaints`, migration 0024 | `backend/detection/src/complaint-message.ts`, `complaints.ts`, `complaints-pg.ts`, `server.ts`, `backend/_shared/migrations/0024_complaints.sql` |
| 4 | `/complaints` page and an inline form reused on the results page in place of the appeal panel; the four dangling "tell us" strings now name it | `app/src/complaints/`, `app/src/app/complaints/`, `app/src/app/pools/[pool]/results/challenge-client.tsx` |
| 5 | The named reviewer out of the player-facing product: the appeals limb removed, the rules copy and the custody key rewritten, the register rows replaced | `backend/detection/src/appeals.ts`, `app/src/copy/index.ts`, `app/src/app/custody/custody.config.ts` |
| 6 | Terms of service (18 sections) and privacy notice (11 sections), server-rendered on the back-page pattern, every figure a function of the shared constant | `app/src/copy/terms.ts`, `privacy.ts`, `app/src/app/terms/`, `privacy/`, `app/src/components/doc/doc-parts.tsx` |
| 7 | The claims register extended to both documents: 66 registered phrases across three surfaces, and a second kind so a contractual term can be registered honestly without pointing at a file that does not prove it | `app/src/copy/published-claims.test.ts` |
| 8 | Footer links, within-page navigation, responsive pass at 390 / 1024 / 1440 | `app/src/components/shell/site-footer.tsx`, the two pages |
| 9 | `config/terms.json` to version 3 — **every wallet re-accepts once** | `config/terms.json` |

The program is untouched. Nothing was added to the exclusion list in `scripts/check-language.sh`.
`config/reviewers.json` is unchanged and still gates the admin surfaces.

---

## 3. The two-kind claims register

The tripwire previously held one kind of row: a promise and the file that keeps it. The terms carry
clauses no file can keep — the liability cap, governing law, tax, availability, a retention period
applied by hand — and registering those against a proof path would have been a lie in the one place
built to catch lies. So a row is now either a `mechanism` (with a `proof` path) or an `undertaking`
(with a `basis`), and the load-bearing condition is asserted: **an `undertaking`'s phrase must not
appear on the rules page.** The rules page describes what the system does, so anything there needs
code; if an operational promise turns up as an undertaking, somebody has reclassified it to escape
building a mechanism.

Proven to fire, each by making the repository wrong on purpose and watching the build fail: an
unregistered promise in the terms, an unregistered promise in the privacy notice, a `mechanism` row
whose proof path does not exist, and an `undertaking` phrase placed on the rules page.

---

## 4. What the verification found

The brief asked for an end-to-end walk of the complaints form against a local service. It found four
things, three of them mine.

**4.1 A brief assertion that is no longer true (reported, not worked around).** Part 4.3's second
disclosed residual says: *"If the settlement key were permanently lost after a pool seals, that
pool's funds have no on-chain route out."* That is false on this branch —
`set_settlement_signer` (`programs/blotto_cup/src/instructions/admin.rs:154`, admin-gated) rotates
it. The real residual is the **pool sealing key**: entries are encrypted to it, nothing can rotate
it, and `trigger_refund` requires `PoolState::Open` (`refund.rs:70`), so a pool whose sealing key is
lost after it seals cannot be revealed, settled or refunded. The terms carry the accurate version.

**4.2 An unsigned complaint could not be read by its own author once they signed in.**
`mayReadComplaint` required a reader of an unsigned complaint to supply **no** wallet. The form
sends the signed-in wallet with every lookup, so the exact player the unsigned route exists for — one
who complained while locked out of their wallet and then got back in — was told their own complaint
did not exist. The rule guarded nothing: the identical request without the parameter already served
the row, and the row carries no address to protect. Fixed; a signed complaint is still served only
to the wallet that signed it, and every refusal is still the same 404.

**4.3 A service 400 was reported to the player as "too long".** The client's own length check runs
before anything is sent, so a 400 from the service means a shape it would not accept — in practice
the `pool` the calling page passed. Telling that player to shorten their words sends them round the
loop shortening a complaint that was never too long, on the one route that is their last resort. A
named `not_accepted` outcome now says what happened and whose fault it is.

**4.4 A `mechanism` row whose proof file did not contain the mechanism.** The terms undertake that a
challenge is answered "by someone other than whoever made the original one wherever that is
possible", and the row pointed at `complaints.ts` on the strength of "a route whose record shows who
answered" — the record did not. The row passed because the register only checks that a proof file
**exists**, which is worth remembering about every row in it. The complaint row now carries
`decided_by`, so whether a different person answered is checkable against the decision log rather
than taken on trust.

**4.5 Two stale rows in `PRODUCT-FACTS`, found by the line-by-line read.** §6 described the device
marker as "stable across pools" — true of v1, and the reason the bundle stopped publishing it, but
the client has sent a per-pool derivation since B-40, so the privacy notice's "your entries cannot be
linked across tournaments" is accurate and the row's present tense was not. §6 also omitted the
wallet address from the list of what the bundle publishes, which the privacy notice states plainly
and `bundle.ts` carries on three row types. §5's terms-version row said 2, now 3.

---

## 5. What is NOT built, and is recorded rather than left to be found

Both are in `PRODUCT-FACTS` §9, the section that exists for exactly this.

- **The operator's write path for a complaint's status.** The store is append-only and the row shape
  carries the note and whose key wrote it, but nothing in this repository appends an `acknowledged`
  or `resolved` row. Until an operator tool or route does, a complaint's status reads *received*
  however promptly a person answers. The undertaking is about a human answering and a person can
  answer today — but the status a player checks will not say so. Next piece, and small: one
  authenticated append per kind.
- **"Answered by someone other than whoever made the original one."** Nothing enforces the
  difference, deliberately: the predecessor rule *did* enforce it and that is why no appeal could be
  decided at all. The wording is the founder's, supplied in the brief. The architect's note is that
  "wherever that is possible" is doing real work — with a one-member registry it is not possible, so
  the sentence undertakes nothing today beyond the record it leaves.

---

## 6. For the founder — decisions waiting on you

1. **`config/operator.json`.** Seven values, one file, no code change. Until they are filled in, both
   documents say "not yet set" and a mainnet deploy is refused. This is the blocking item.
2. **The voice of both documents.** Every string is a draft. They are written plainly and without
   hedging, which is a choice you may want to change.
3. **The rules page's "published with the review log".** Pre-existing copy, not changed here. The
   five signals' **values** are not published — `GET /detection` serves the report to an operator
   token and to nobody else — while `GET /decisions?pool=` is public and carries every decision with
   its criterion. The terms now say the narrower, true thing; the rules page still says the broader
   one. Worth a look.
4. **No challenge deadline is published.** The retired appeal wording gave seven days. The complaints
   route enforces none, so none is published; publishing one would be a promise the code does not
   keep, in the opposite direction from usual — against the player.
5. **Counsel.** The liability cap, the governing-law clause, the refusal clause's enumerated grounds
   and every retention period. Register rows R1 and R6.

---

## 7. Verification actually run

Reported in full in the branch's step report. Summary: the six repo gates clean and each proven to
fire; app typecheck, lint and 529 unit tests green; the journey lane 16 green at both widths;
detection 91, packet 207, indexer 128 green; the postgres suite typechecks and needs a database this
environment has none of (its CI lane covers it). The complaints form driven in a browser through
`submitted`, the signature-required state, `unreachable` and `not_configured` — over the app's real
Content-Security-Policy, against a real review service — and the signed submission driven live
through the module the browser calls, with a real ed25519 keypair.
