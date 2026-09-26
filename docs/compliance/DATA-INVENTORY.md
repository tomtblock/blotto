# 2026-09-16 — data minimisation: the cheap set

**Produced:** 2026-09-16, on `claude/nice-turing-k0ipl5-minimise-1`, from `main` at `3cd0ec7`.
**Instructions this implements, in the founder's words and with their dates:**

| Date | Instruction |
|---|---|
| 2026-09-15 | *"So where is all the data stored re: the battles. More importantly, what data do we handle as a platform? We want to minimise."* — the inventory in §1 answers it |
| 2026-09-15 | Four rulings on the inventory: detection inputs must not be public after reveal; appeals keep the decision public and the grounds private; drop the rivals list; sanctions screening stays as it is |
| 2026-09-15, late | *"I just want to understand if this is something worth spending time and credits on"* — answered with the cheap set below; the key split and the private appeal grounds were deferred |
| 2026-09-16 | *"Ok lets do the cheap fixes now. Approve everything."* |

**Status of this document:** a change report, written from the branch it describes. Nothing here
touches the program, `config/*.json`, PID v0.5, or the sanctions screening (ruling 4).

---

## 1. What the inventory found

Three read-only sweeps on 2026-09-15 — the browser app, the entry side, the indexer and daemon —
against the code on `main`. In brief:

**Held by nothing of ours:** email, name, date of birth, documents, phone. The sign-in provider
(Privy) holds the email; our code reads only its user id and the wallet addresses. No analytics or
error-tracking script of any kind. The salt is discarded the moment the commitment is computed. No IP
address is ever written to a column or a log line — two octets survive, in logs and in the
sanctions-refusal record. The entry service holds no key and cannot open a sealed box.

**Held, and where it goes:**

| Data | Where | Who can read it | Kept |
|---|---|---|---|
| Wallet address | chain, every derived table, the public read API, the two screening vendors | everyone | forever |
| Full IP address | sent to the geo vendor once per address per 15 minutes; held in process memory for the cache | the vendor; nobody afterwards | 15 minutes |
| 18+ / terms attestation | wallet, signature, server time | internal | forever |
| The sealed box | `sealed_entries`: 175 bytes per seat | the daemon after close; **until this change, anyone, through the read API, once the secret was public** | forever |
| Detection reports | wallets a signal fired on, with free-text detail | operator token; **until this change also printed whole into the daemon log** | forever |
| Review decisions and appeals | the decision, the reviewer, and up to 2,000 characters of the player's own grounds | public, no login | forever |
| Derived public rows | entries (with the flag and sanctions-hold columns), payouts, profile, career history, and **until this change a rivals graph** | public | forever |
| The published bundle | every seat's battles, salt, wallet, rank and amount | everyone, permanently, on Irys | irreversible by design |

**Missing altogether:** a privacy notice, a DPIA, and any retention rule. Not one table has a
deletion path; migration `0019` says so in writing. The v0.6 PID draft marked the notice as built;
it was not, and that row is corrected here (§5).

**Two gaps the sweep found that were not what the audit believed.** Bundle version 2 (audit B-31,
2026-09-12) removed the seven per-screen timings and the device marker from the published set so
they would never be public. But the sealed box still carries both, and the read API's
`sealed-entries` route handed every box to anyone once the secret was on chain — so both were
public after all, for every pool ever played. And the browser kept the raw allocation integers of
every battle in its local database, for every pool, forever, read by nothing.

## 2. What changes for a player

| Surface | Before | After |
|---|---|---|
| Results page, "what finished above you" | The browser fetched every seat's sealed box from the read API and opened it with the revealed secret | The browser reads the published bundle — the same file the Verify page recomputes — and checks each seat's battles against its on-chain fingerprint before showing anything. The boxes have no public reader |
| Profile | A rivals panel: the eight wallets most often in the same pools | Gone. Nothing in scoring, payment or verification needed the graph |
| Appeal form | A text box, and the rules' promise that decisions are published | The form says, before the player types, that the text is published in the signed log and cannot be withdrawn |
| The player's own device | The five numbers of every battle ever played, plus a picture, kept forever | The numbers are gone (existing rows are stripped on first open); the pictures of a pool that refunded or closed unrevealed are deleted on the next visit. Pictures of open and revealed pools stay |
| The player's own browser storage | Key names listing every wallet used and every pool paid in, and one tying the sign-in id to a wallet | Opaque names derived from the device's own secret; pre-change entries carried over once |
| The public entries list | Every column of the table, whatever gets added to it | The fourteen on-chain columns, named |
| Our logs and alerts | Whole wallets in three alerts and one warning; whole detection reports in the daemon log | The same truncated identifiers as the request logs; one counts line per detection run |

Nothing changes on chain, in the sealed payload, in the bundle, or in what the daemon decrypts.
Detection still receives the timings and the device marker at settlement, exactly as before.

## 3. The code

### 3.1 Backend

- **`backend/_shared/src/short.ts`** (new) — `short()` (six and four) and `ipPrefix()` (two octets
  or one hextet), the one rule every service now imports. The review server, the entry gate and
  the signer selector carried their own copies; `packet/src/service.ts` re-exports `ipPrefix` for
  its existing importers.
- **`backend/detection/src/signals.ts`** — `RevealedEntry.ipHash` and the IP correlation it fed are
  gone. The field always arrived empty (`reveal/src/main.ts` passed `''`) and the header named it an
  open seam; it invited somebody to start collecting hashed addresses to "finish" it. The signal keeps
  its persisted name `device_ip_correlation`: it is a string in every stored report, the reviewer's
  page renders it, and the battle-test manual's scenario T7 reads it.
- **`backend/reveal/src/main.ts`** — the detection report is no longer printed whole to stdout; one
  line carries the counts. The report itself is persisted for the reviewer's page, as before.
- **`backend/reveal/src/crank.ts`** — the entry-refund-owed alert names how many and the truncated
  wallets. The bundle's `scored_as_all_losses` remains the full list the manual pays from.
- **`backend/detection/src/server.ts`** — the two alerts that carried a whole wallet now spread the
  request log's own truncated identifiers.
- **`backend/packet/src/service.ts`** — the sanctions-refusal warning names the wallet and pool in
  truncated form; a failed insert no longer dumps the whole record into stdout and instead raises
  `ALERT.packet.sanctionsRefusalUnrecorded` (new, `_shared/src/metrics.ts`) through an optional
  `monitor` on `PacketServiceDeps`, wired in `main.ts`.
- **`backend/indexer/src/read-api.ts`** — `/pools/:pool/entries` names its fourteen columns
  (`ENTRY_COLUMNS`) instead of `SELECT *`; `/profiles/:player/rivals` and
  `/pools/:pool/sealed-entries` are removed and fall to the existing 404.
- **`backend/sealing/src/payload.ts`** — `battlesCommitment(battles, salt)`, the one definition of
  `sha256(battles ‖ salt)`; `payloadBattlesHash` delegates to it. The browser uses it to check the
  published bundle (§3.2).

### 3.2 App

- **`app/src/results/what-beat-you.ts`** — `battlesFromBundle()` replaces `decryptSeatBattles()`:
  reads the published entries, decodes each battle set with the scoring engine's own decoder,
  recomputes the commitment, and keeps only the seats that match. The panel
  (`what-beat-you-panel.tsx`) fetches the archive's bundle URI, as the all-battles table already did.
- **`app/src/data/`** — `RivalRow`, `SealedEntryRow`, `getRivals` and `getSealedEntries` are gone
  from the seam, the HTTP client, the fixture and the scenarios.
- **`app/src/app/profile/profile-client.tsx`** — the rivals panel and its read are gone.
- **`app/src/app/pools/[pool]/results/appeal-panel.tsx`** — the published-text line, tied to the
  textarea with `aria-describedby`.
- **`app/src/battle/stills.ts`** — `StoredStill.allocation` is gone; database version 2 strips it
  from existing rows on first open; `forgetStills(pool)` deletes one pool's rows.
  **`app/src/battle/stills-sweep.ts`** (new) — the rule (`shouldForgetStills`: `Refunding`, or
  `Closed` with no revealed secret) and the sweep, run on the profile gallery, the results montage
  and the play page; it never deletes on a failed or absent read. `play-client.tsx` also clears the
  retry copy of the run once a seat is held or may be.
- **`app/src/storage/opaque-key.ts`** (new) — `opaqueKey`, `opaqueToken`, `migrateLegacyKey`, over
  the device secret `entry/device.ts` already keeps (now exported as `deviceSecretBytes`). Converted:
  the attestation cache, the welcome note, the notifications badge (its values become tokens), the
  confetti latch, and the wallet bridge's active-wallet choice (the value is a token of the address,
  resolved against the connected signers).

### 3.3 What was deliberately NOT changed

The sealed payload's layout, the bundle, the daemon's decryption, the program, PID v0.5, the
sanctions screening at entry (ruling 4), and `POST /notify` with its `notify_optin` table — D-E11
rules that route dormant and its consents kept, so the plan's line about removing it was wrong and
was withdrawn before anything was built.

## 4. Tests — rule 0.7

**Rewritten in place, each citing the ruling:** `backend/detection/test/detection.spec.ts` (the
fixture loses `ipHash`), `backend/reveal/test/crank.spec.ts` (two fixtures; the refund-owed alert
asserts a count and truncated wallets, never a whole one), `backend/detection/test/review-server.spec.ts`
(both alert cases assert the truncated identifiers), `backend/packet/test/sanctions-wiring.spec.ts`
("shouts the record" becomes "pages, without reprinting the record"),
`backend/indexer/test/read-api.spec.ts` (the rivals case and the sealed-entries case now prove the
404s and that no query is issued), `tests/postgres/test/stores.spec.ts` (the real-rows case proves
the store still holds the boxes and the API serves none), `tests/rehearsal/src/orchestrator.ts`,
`app/src/results/what-beat-you.test.ts` (seal-and-decrypt becomes publish-and-check, with a tampered
seat skipped), `app/src/data/scenarios.test.ts`, `app/src/app/pools/[pool]/results/appeal-panel.test.tsx`.

**New:** `backend/_shared/test/short.spec.ts`; `read-api.spec.ts` "named columns, never SELECT *";
`app/src/battle/stills-sweep.test.ts` (the rule, and the sweep against a fake store and indexer —
including that a failed read deletes nothing); `app/src/storage/opaque-key.test.ts`.

**Deleted:** none.

## 5. Docs

- `PID_Blotto-Cup_v0.6-DRAFT.md` C10: "Built" → not started, with what exists instead (this
  inventory). PID v0.5 is not edited.
- `01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md`: the "published post-reveal" row had said timings
  and device hashes are published — false since B-31 — and the "who can read it early" row now says
  the read API serves no ciphertext at all.
- `AS-BUILT.md` §4, `ARCHITECTURE-DIAGRAMS.md`, `backend/sealing/README.md`, `backend/indexer/README.md`:
  the sealed boxes have no public reader; the route table matches.
- `OPERATING-MANUAL.md`: the refund-owed alert's wording.
- `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` Appendix A: a dated note superseding §9's IP signal and §5's
  "served only after reveal", with the proposed register row (§7).

## 6. Verification

| Check | Result |
|---|---|
| backend `_shared` · `detection` · `reveal` · `indexer` · `packet` · `sealing` — typecheck and tests | all clean: 85 · 56 · 202 · 128 · 175 · 36 passing |
| `tests/rehearsal` typecheck and tests | 25 passing |
| `tests/postgres` | rewritten; runs in CI's postgres lane (no database in the session) |
| app `tsc --noEmit` · `eslint --max-warnings=0` | 0 · 0 |
| app `vitest` | 59 files, **472 tests** (463 + 9 new) |
| `next build`, fixture mode | compiled clean |
| Playwright journey, 375 and 1280, fixture mode | **14/14** |
| `scripts/check-language.sh` (§8.7, this report included) · `check-standing-rules.sh` · `check-fixtures.sh` · `check-env-examples.sh` | all clean |

### 6.1 On devnet

**After the merge and the backend deploy:** `/pools/<pda>/entries` unchanged in shape;
`/profiles/<wallet>/rivals` and `/pools/<pda>/sealed-entries` both 404; the results page of a settled
pool renders "what finished above you" from the bundle; a refunded pool's blots vanish from My Blotts
on the next visit; the daemon log carries `detection pool=N findings=… reviewRecommended=…
hardBlocks=…` and no report body.

**Deploy order.** Merging ships the app to `www.blotto.gg` at once (Vercel deploys on merge); the
app is backward compatible with the old backend. The server changes go live when the founder runs
`deploy-backend` on `main`; the services restart for about a minute, and a failed first entry attempt
still locks that wallet out of the pool, so deploy when nobody is mid-entry.

## 7. Proposals for the founder (implemented as proposals, marked `PHASE-N-REVIEW` where copy)

1. **Appeal form line:** "What you write here is published in the signed decision log and cannot be
   withdrawn. Do not include personal details."
2. **What-beat-you note:** "Re-scored in your browser from the published battle set, each seat
   checked against its on-chain fingerprint. Seats only — no names."
3. **Register row D-E16:** "The IP half of R11/4.3's device/IP correlation is removed: no IP-derived
   value is captured, stored or sealed at entry; device correlation within a pool stays. The sealed
   boxes have no public reader; the published bundle is the only public battle set."
4. **Alert name:** `packet sanctions refusal not recorded`.

## 8. Still the founder's, and designed but deferred

- **A privacy notice and retention periods**, with counsel. §1 is the inventory the roadmap's §6.3
  asks for; the proposed rules (purge the sealed boxes and detection reports once a pool's appeal
  window has closed and every decision is final; attestations kept while the wallet can enter; the
  sanctions-refusal period set by counsel; the vendors' log retention recorded and set) are in the
  plan file and are not implemented until ratified.
- **Appeal grounds private to reviewers.** Designed: the wallet signs a digest of the grounds, the
  public row carries the digest, the text goes to a reviewer-only store. Built when a first real
  appeal is near; devnet holds no appeal or decision row today.
- **The two-box key split.** Designed: timings and device marker sealed to a per-pool detection key
  through the same Turnkey custody flow, never published. Revisit before mainnet only if counsel wants
  defence in depth against a database breach during the retention window. With the route gone, the
  boxes are readable only inside our database.
- **The one operational step:** run `deploy-backend` on `main` when nobody is mid-entry.
