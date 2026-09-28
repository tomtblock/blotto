# Data inventory

What personal data Blotto Cup holds, where it lives, why, and for how long — and what was
deliberately removed. It is the source the privacy notice (`app/src/copy/privacy.ts`, rendered at
`/privacy`) is drafted from, and `app/src/copy/published-claims.test.ts` cites it as the proof for
the notice's inventory claims. When what the platform holds changes, this file changes in the same
change.

Everything below was taken from the code, not from intent: the inventory was first taken on
2026-09-15 by sweeping the app, the entry service, the indexer and the settlement process, and is
kept current with them. Each row names the file or table that holds the data.

---

## 1. What the platform holds

### 1.1 Held by nothing of ours

The product does not ask for, and has no field, column or log line for, any of the following:

- **Name**
- **Date of birth** — age is a signed confirmation that the player is 18 or older; no birth date is
  recorded (`backend/packet/src/attestations.ts`)
- **Identity documents** — there is no identity check at entry or at payment
- **Phone number**
- **Postal address**
- **A full network (IP) address in any durable record** — two octets (or one IPv6 hextet) survive,
  in logs and in the record a sanctions refusal leaves (`backend/_shared/src/short.ts`, `ipPrefix`)

Also absent:

- **No analytics and no error-tracking script** of any kind is loaded by the app
  (`app/src/app/layout.tsx` carries no third-party script).
- **No email address in the product's own stores**, except under the one-message opt-in in the
  table below. The sign-in provider (Privy) holds any email used to sign in; our code reads only
  its user id and the wallet addresses (`backend/packet/src/notify.ts` records a choice, never an
  address).
- **The entry's salt is not kept by the service.** The browser discards it once the commitment
  `sha256(battles ‖ salt)` is computed; its only other copy is inside the sealed payload.
- **The entry service holds no decryption key** and cannot open a sealed entry
  (`backend/sealing/src/custody.ts`).

Everything the platform does hold is keyed to a **wallet address**, not to a person. Nothing in
the list below identifies a player unless their address does.

### 1.2 Held, where, and who can read it

| Data | Where | Who can read it | Why |
|---|---|---|---|
| **Wallet address** | the chain; every derived table in the indexer; the public read API; the published results bundle; the sanctions screening sources | everyone | It is how the program knows whose entry, whose prize and whose refund |
| **Full IP address** | sent once to the location provider per address; held in process memory by the lookup cache (`backend/packet/src/geo-cache.ts`) | the location provider; nobody afterwards | To apply the territory schedule (`config/territories.json`) at entry |
| **Location verdict** | carried with the entry authorisation; two octets of the address in logs | internal | Evidence the territory rule was applied |
| **Age and terms confirmation** | `attestations` table: wallet, terms version, server time, the wallet's signature | internal | The program will not authorise an entry without a confirmation at the current terms version (`config/terms.json`) |
| **Sealed entry** | `sealed_entries` table: one encrypted box per seat — 175 bytes in an easy pool, 210 in a hard pool (payload `backend/sealing/src/payload.ts` plus 48 bytes of box overhead, `sealedbox.ts`). Inside: the seven battles, the salt, seven per-field timings, and a per-pool device marker | the settlement process, after the pool closes; **no public reader** — the read API has no route that returns a sealed box, before or after the reveal (`backend/indexer/src/read-api.ts`) | Sealing (nobody can read an allocation before close) and integrity review |
| **Detection reports** | `detection_reports` table: the findings of the five signals, naming the wallets a signal fired on | the operator, through an operator-token route; not printed to logs | Integrity review before a prize is paid |
| **Review decisions** | `review_decisions` table: wallet, action, the criterion cited, the reviewer key, the signature | public, append-only | So a decision can be checked against the published criterion |
| **Complaints** | `complaints` table: reference, category, the player's own words, and — only when the player signed — wallet and signature | a signed complaint only to the wallet that signed it; an unsigned one to whoever holds its reference; the queue to reviewers through an operator-token route | So a person can answer, and the answer is on record |
| **Opt-in email** | `notify_pool_optin` table: pool, wallet, email, signature | internal | To send the one "your tournament has finished" message the player asked for |
| **Sanctions refusal record** | `sanctions_refusals` table: wallet, pool, the lists consulted, match data, country, IP prefix | internal | The record a refusal on a published sanctions list requires |
| **Published results bundle** | permanent storage (`backend/reveal/src/publisher-irys.ts`): every seat's battles, salt, wallet, rank and amount | everyone, permanently | It is the file anyone uses to recompute the result (`app/src/verify/logic.ts`) |
| **The player's own browser** | a device secret (`app/src/entry/device.ts`); cached choices under opaque key names (`app/src/storage/opaque-key.ts`); since 2026-09-27 which external wallet to reconnect (`app/src/wallet/direct-session.tsx`), under an opaque key (the battle notes of the same day were removed on the founder's V3 review, so the profile stores nothing); on Android, the mobile wallet library's own authorisation token under its own key (`SolanaMobileWalletAdapterDefaultAuthorizationCache`, written by `@solana-mobile/wallet-standard-mobile`, D-E18) so a second sign-in does not re-prompt the wallet app. The Android package's WebView has storage of its own, so a person using both the package and a browser holds two device secrets and two markers | the device only | The per-pool device marker; remembered settings; the mobile wallet's authorisation |

**What the published bundle does not carry**: the per-field timings and the device marker. Bundle
version 2 removed both (`backend/reveal/src/bundle.ts`); they reach detection through a channel
that is published nowhere (`backend/reveal/src/ranking.ts`, `forDetection`).

**The device marker is per pool.** What leaves the browser is
`sha256("blotto:device:v2" ‖ pool ‖ secret)` (`app/src/entry/device.ts`). Markers from one device
in two pools are unrelated values, so entries cannot be linked across tournaments by anyone,
including the operator. The detection signal only ever compares markers within one pool.

**Third parties that receive data:**

| Recipient | Receives | Source |
|---|---|---|
| Sign-in provider (Privy) | the player's sign-in identity, including any email | provider-held; our code reads its user id and wallet addresses |
| Location provider | the entrant's IP address, once per address per cache lifetime | `backend/packet/src/geo-iplocate.ts` |
| Sanctions sources | wallet addresses, at entry and before payment | `backend/sanctions/src/` — the mirrored OFAC SDN list is local; Chainalysis and OpenSanctions are called when configured |
| Permanent storage (Irys) | the results bundle | `backend/reveal/src/publisher-irys.ts` |
| Email sender | the opt-in address, once | `backend/packet/src/notify-pool.ts` |

---

## 2. What was minimised

Each of these removed data the product did not need.

| Measure | Where |
|---|---|
| The sealed boxes have **no public reader**. The results page's "what finished above you" view reads the published bundle and checks each seat against its on-chain commitment instead of decrypting boxes | `backend/indexer/src/read-api.ts` (route removed); `app/src/results/what-beat-you.ts` |
| The public entries list returns **named columns**, never `SELECT *`, so a column added later is not published by accident | `backend/indexer/src/read-api.ts` `ENTRY_COLUMNS` |
| The "rivals" graph (the wallets most often in the same pools) was removed; nothing in scoring, payment or verification needed it | `backend/indexer/src/read-api.ts` |
| **No IP-derived value** is captured, stored or sealed for detection; the device half of the correlation signal stays | `backend/detection/src/signals.ts` |
| Detection reports are persisted for the reviewer, never printed whole to logs; one counts line per run | `backend/reveal/src/main.ts` |
| Logs and alerts carry **truncated** wallet identifiers and a two-octet IP prefix, from one shared rule | `backend/_shared/src/short.ts` |
| Timings and the device marker are **not published** in the bundle | `backend/reveal/src/bundle.ts` (version 2) |
| The device marker is **derived per pool**, never the stable device secret itself | `app/src/entry/device.ts` |
| The browser keeps **no allocation**: pictures of past battles that earlier versions stored are deleted from the device | `app/src/storage/forget-blott-stills.ts` |
| Browser storage key names are **opaque**, so they no longer list the wallets used or the pools entered | `app/src/storage/opaque-key.ts` |
| The opt-in email is **deleted in the same statement that records the send** | `backend/packet/src/stores-pg.ts` (`SET sent_at = …, email = NULL`) |

---

## 3. Retention

The periods below are the published policy in the privacy notice (`app/src/copy/privacy.ts`,
section "How long we keep it"). **Two are enforced by code; the rest are policy applied by hand**,
because nothing in the system yet deletes anything on a schedule. The notice says so in those
words.

| Data | Period | Enforced by |
|---|---|---|
| Full IP address | 15 minutes, in memory only | code — `backend/packet/src/geo-cache.ts` (`ttlMs` default) |
| Opt-in email | until the message is sent | code — `backend/packet/src/stores-pg.ts` |
| Sealed entry and the pool's detection report | until the pool's challenge window has closed and every decision on it is final | policy |
| Age and terms confirmation | while the address can still enter | policy |
| Sanctions refusal record | the period the obligation requires | policy; the number is not yet set |
| Complaint | answered within 30 days (`COMPLAINT_RESOLVE_DAYS`), then kept a reasonable period so the answer can be shown | policy |
| Review decision | permanent — it is the record a decision is checked against | by design (append-only) |
| Wallet address on chain, and the published bundle | permanent; nobody can remove them, the operator included | by design |

**Erasure.** What can be erased on request is what is held off the chain. A chain record and a
published bundle cannot be erased by anyone, because no mechanism exists that could do it. The
privacy notice states this limit in the same section as the right.

---

## 4. Open

- No automated deletion path exists yet; the policy periods in §3 are applied by hand.
- The data controller's identity is not yet set (`config/operator.json` ships with every value
  `null`), and the retention period for sanctions refusal records is not yet a published number.
