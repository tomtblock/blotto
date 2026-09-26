# CHANGE — 2026-09-22: the operator can answer a complaint, and the database url's TLS is said out loud

Two pieces, done in one session after `#160` landed. The first closes the last row
`PRODUCT-FACTS` §9 was carrying against the complaints route. The second is a fix that was
**not** ported, because its premise turned out to be false, and what replaced it.

---

## 1. The complaints route works in production — verified, not assumed

`#160` merged at 00:32 and `deploy-backend` run #34 shipped the backend half at ~00:55, which
also closed the terms-v3 gap the merge had opened (the app and the packet service must carry the
same `config/terms.json` or every entry is refused — see the change report for `#160`).

The deployed review service was then driven end to end through the same canonical-message module
the browser imports. **Every case correct on the first run:**

```
GET no ref                       400  {"error":"ref"}
GET unknown ref                  404  {"error":"not_found"}

POST signed decision complaint   204
GET as its signer                200  {"status":"received","signed":true,
                                       "acknowledgeWorkingDays":5,"resolveDays":30}
GET as another wallet            404  {"error":"not_found"}
GET with no wallet               404  {"error":"not_found"}
POST same reference again        409  {"error":"already_lodged"}

POST unsigned site complaint     204
GET unsigned                     200  {"status":"received","signed":false}

POST unsigned DECISION complaint 409  {"error":"signature_required"}
```

Two rows were written to the live append-only table, labelled `VERIFICATION PROBE 2026-09-22
00:59 (Claude Code, post-deploy check)` so anyone reading the table later knows what they are.
References `BC-2BBSA9VJ` (signed) and `BC-X2TKM4C6` (unsigned). Their persistence is also the
proof that **migration 0024 ran** — the rows came back from Postgres with a `receivedAt`.

---

## 2. The operator write path

`PRODUCT-FACTS` §9 carried this as *partly built*: the record was append-only from 2026-09-19
and nothing in the repository could write to it, so a player who checked their reference read
*received* however promptly a person had actually answered. The terms publish five working days
to acknowledge and thirty to answer. **A window nobody can record meeting is a window we look to
have missed.**

### Two routes, and the split is the point

| | Route | Authenticated by | Why |
|---|---|---|---|
| Write | `POST /complaints/answer` | a **registry signature** | The operator token would prove only that somebody holds the token. `decided_by` has to name a *person* for the terms' "answered by someone other than whoever made the original one wherever that is possible" to be checkable against the decision log at all. The signature is what makes the stored name evidence instead of a typed assertion — so it goes browser → service directly, as a decision does. A proxy could only weaken it: the service would then be trusting the app about who answered. |
| Read | `GET /complaints/open` | the **operator token**, fail-closed | It returns players' own words about their own problems — the most sensitive text this product holds. An unset token is a 503, never an open route. It reaches the desk through the app's own server route (`api/complaints/route.ts`), which holds the token and proves the caller is on the founder-owned reviewer list before spending it, mirroring `api/detection/route.ts` limb for limb. |

The queue's request bytes are **their own message**, not the detection request's: a signature is
only as narrow as what it covers, and one message for both reads would mean a routine detection
request also opened the complaints queue.

`canonicalComplaintAnswerMessage` carries the **note** as well as the reference and the kind,
because the note is what the player is shown and an operator who could change it after signing
could answer one thing and publish another. Its header is distinct from the lodge's, and both
directions are asserted: neither signature verifies as the other.

### What refuses, and why

- `complaintAnswerRefusal` mirrors `auth.ts::reviewSubmissionRefusal` limb for limb. An operator
  write to the complaints record is the same *kind* of act as one to the decision log, and two
  slightly different auth rules over two append-only operator tables is the drift that leaves a
  hole in one of them. One undifferentiated `unauthorized` to the caller; the reason goes to the
  log, which the caller cannot reach.
- An answer **cannot conjure a thread** — a reference with no lodge is a 404, not a row
  `complaintStatus` reports as null and nobody can ever read.
- A duplicate signature is a replay and says so.
- The lodge's own category and pool are carried onto the operator's row rather than taken from the
  caller, who could otherwise mislabel somebody else's complaint. No player address is repeated
  onto it.

### One deliberate asymmetry

**No per-key budget**, unlike `/decisions`. A decision moves a share; an answer records a sentence
against a reference that must already exist, and a duplicate is refused. A budget means a
`countBy` on this store, and the route is better small enough to read. **A second desk key, or any
sign of a flood, changes that.** Recorded here rather than left in a diff.

### The desk panel

On the admin review page, in plain markup matching the rest of that page, with all logic in
`complaints-desk.ts` and unit-tested there. It shows the complainant's words **in full** —
answering half a complaint is worse than not answering it — whether they signed, and the two
published windows read from the service's constants rather than typed.

A bad reference or an empty note is refused **without asking the wallet**: a prompt for a request
we already know is unsendable trains an operator to click through prompts, which is the habit that
gets a bad one signed.

---

## 3. The TLS fix that was not ported

`step/fix-deploy-db-tls` has carried a fix since 2026-08-28, never merged, 322 commits behind
main. Its premise is **false on the pinned `pg` 8.23.0** — measured by execution, not taken from
the commit message:

1. It observed that `pool.options.ssl` is `undefined` for a url carrying `sslmode=require`, and
   concluded pg ignores `sslmode` inside a `connectionString`. The *pool* does see nothing — but
   each **client** parses the string itself, and `client.ssl` comes back `{}`. TLS is already on.
2. An explicit `ssl` option passed *alongside* a `connectionString` is **ignored**: passing
   `{ rejectUnauthorized: false }` still leaves `client.ssl` as `{}`. The string wins. So
   `ssl: true` would have changed nothing, in either direction.

Both are now pinned as tests, so nobody re-derives them from that commit message and so a `pg`
bump that changes either one says so.

**What the fix had right was its reasoning**, and that reasoning now points at a dated risk rather
than a present one. `pg-connection-string` warns at runtime:

> The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'. In
> the next major version … these modes will adopt standard libpq semantics, which have weaker
> security guarantees. If you want the current behavior, explicitly use 'sslmode=verify-full'.

A url saying `require` is therefore **verified TLS on `pg` 8 and unverified on `pg` 9** — a
MITM-accepting posture arriving silently with a dependency bump, on the connection carrying every
sealed entry and every complaint a player has written.

No code can correct it, because the url wins. So `db.ts` classifies — `verified` / `alias` /
`plaintext` — says nothing about a developer's own machine, and gives **two different warnings for
the two different problems**: one is a posture that will weaken later, the other is no posture now,
and a single message would leave an operator unable to tell which they have. Both name the one
remedy, which is the url.

**It warns where this repository's habit would refuse, and that is a judgement call.** The url
lives in a deploy secret this session cannot read, a battle test is live on that deployment
tonight, and a code change that stops the backend booting over a condition I cannot inspect first
is worse than a loud line in the boot log. Once the secret is confirmed, this should become a
refusal and move into `deploy-backend`'s gate job, where it is asserted before a machine is
replaced rather than after.

---

## 4. Founder actions

Three, none of them code, in the order they pay off.

1. **`DATABASE_URL` → `sslmode=verify-full`.** One edit to the deploy secret. Until then the boot
   log says which of the two problems this deployment has — read it after the next
   `deploy-backend` run. If it says *"in the clear"*, the database traffic is currently
   unencrypted and this is urgent; if it says *"pg 9"*, it is correct today and fragile.
2. **`NEXT_PUBLIC_REVIEW_API_URL` → `https://blotto-review.fly.dev`** in Vercel → the **blotto**
   project → Settings → Environment Variables (Production), **then redeploy the app**. Anything
   starting `NEXT_PUBLIC_` is compiled into the site at build time, so setting it without
   redeploying changes nothing. Until this is done the player-facing form honestly says the
   service is not configured — the route exists and reaches nobody.
3. **`REVIEW_OPERATOR_TOKEN`** in the same Vercel settings (it is already in
   `app/.env.example`), set to the review service's operator token. Server-side only — it has no
   `NEXT_PUBLIC_` form and must never get one. Without it the desk queue answers 503 and the
   complaints desk cannot be read at all.

Also worth checking: `BLOTTO_APP_ORIGINS` (a GitHub repository **variable**, not a secret) must
contain both `https://blotto.gg` and `https://www.blotto.gg`, or the browser's complaints fetch is
refused by CORS however correctly the Vercel variable is set. This has bitten before —
`CHANGE-2026-09-14_geo-and-welcome.md` records the www form missing from it and every visitor
getting *"not available in your region"*. Changing it needs a **backend** redeploy, not an app one.

---

## 5. Verification

```
six repo gates          all clean, exit=0
  (the language gate caught a §8.7 verb in a comment of mine, and in the
   first draft of this very report — both rewritten, neither excluded,
   which is the gate doing its job on its own author)

app       typecheck clean · lint clean · 66 files / 553 tests passed
app       journey lane: 16 passed, both widths
_shared 89  ·  detection 111  ·  packet 223  ·  indexer 128
postgres  typechecks; two listOpen cases added for its own CI lane
production  the deployed complaints route driven end to end (§1)
```
