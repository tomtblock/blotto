# CHANGE — 2026-09-24: the deploy proves the database url before it replaces a machine

An outage, and the check that would have turned it into a three-second refusal.

---

## 1. What happened

The database password was reset at the provider while a deploy was in flight. The
`BLOTTO_DATABASE_URL` secret still held the old one.

| Time (UTC) | |
|---|---|
| 14:23 | run #37 deployed the indexer. It connected, passed its checks, and was healthy |
| ~14:24–14:26 | the password stopped working |
| 14:26 | the settlement daemon booted and every tick failed: `password authentication failed for user 'neondb_owner'` |
| 14:28 | run #37 failed at its smoke check |
| 14:31 | run #38 replaced the indexer's machine. `cmdSync` migrates BEFORE it serves, so a database it cannot reach means nothing answers `/health` |
| 14:36 | the deploy gave up after five minutes of health checks. `min_machines_running = 1` with no healthy machine is no service at all |
| 15:29 | a corrected secret and a fourth run brought all four services back |

**Sixty-five minutes of outage and two failed runs for one Postgres error code**, `28P01`.
Nothing was lost — the ledger, the projections and the complaints table all came back intact,
and the open pool had no entrants, so no entry was refused that anyone had tried to make.

Two things made it worse than it needed to be.

**The deploy checked that every credential was PRESENT, never that any of them WORKED.**
`req BLOTTO_DATABASE_URL` in the credential preflight is satisfied by a non-empty string. A
credential is not configuration until something has used it.

**Three of the four services answered `200` on `/health` throughout, while failing every
query.** Those checks do not touch the database. A green tick and a working system were not
the same thing, and nothing in the run said so.

---

## 2. What shipped

| # | Piece | Where |
|---|---|---|
| 1 | The pure decisions — what the url's own text settles, and a fixed url-free sentence for every failure worth naming | `backend/_shared/src/db-preflight.ts` |
| 2 | The executable: one session, `SELECT 1`, both timeouts set and the whole thing raced | `backend/_shared/src/check-database-url.ts` |
| 3 | A step at the head of the deploy job, before the first machine is touched | `.github/workflows/deploy-backend.yml` |
| 4 | 14 cases, offline | `backend/_shared/test/db-preflight.spec.ts` |

### Where it runs, and why not where the last report said

`db.ts`'s `PHASE-N-REVIEW` said the TLS check should "move into `deploy-backend`'s gate job".
That note was written without reading the workflow. **`gate` is a separate job precisely so
its `actions: read` scope never sits beside a credential**, and this check needs the database
url. It therefore runs at the head of `deploy`, which already holds that url. The property
that mattered — *before a machine is replaced* — is kept either way.

`tlsWarning` stays in `db.ts` as a warning and is not removed: a boot line is the only thing
that speaks for a machine the platform restarts on its own, and a refusal upstream cannot see
that happen.

### What it refuses

| Condition | devnet | mainnet |
|---|---|---|
| no session opens (wrong password, wrong database, host, port, TLS) | refuse | refuse |
| remote host with **no TLS** | refuse | refuse |
| `sslmode` = `require` / `verify-ca` / `prefer` | warn, proceed | refuse |
| a url naming the local machine | no opinion | refuse |
| `sslmode=verify-full`, session opens | silent | silent |

The alias row is the judgement. `require` is verified TLS on the pinned `pg` 8 and unverified
from `pg` 9 — a dated risk, not a present one, and whether to take an outage to fix it today
is the founder's call. On mainnet it is a refusal, because "correct until a dependency bump"
is not a posture to carry real money on. **The live deployment is on that row**, so this
change warns where it stands and blocks nothing.

### Two rules it keeps

**It dials with `pg`, not `psql`.** `psql` is already on the runner and free, but libpq and
`pg-connection-string` read `sslmode` differently — a certificate libpq accepts and node
refuses is exactly the failure this must catch, and exactly the one that probe would miss.
Node 22 for the same reason: that is what the service images run.

**It never prints the driver's error text.** A connection url is a secret in whole — password
AND host — and a driver message for an unresolvable host quotes that host back; the runner
masks the secret it was given, not its substrings. So every sentence is written locally, and
an unrecognised error prints its CODE alone. Two failures `pg` reports with no code at all are
matched on the exact message it composes — matching is not printing, and exact equality cannot
match a message carrying a url, which a test pins.

---

## 3. Verification

Ten repo gates clean. `backend/_shared` typecheck clean, **103 tests passing** (89 before — 14 new).

`check-env-examples.sh` caught the first draft reading `GITHUB_STEP_SUMMARY` from the
environment. Not excluded: the path became a `--summary=` argument, because a value the runner
hands us is not something an operator sets and listing it on the deploy checklist would put a
non-configurable on a list of things to configure.

Driven end to end against a **real Postgres 16**, started for the purpose with scram-sha-256
auth, TLS, its own small certificate authority and a hostname, then torn down:

```
correct password, local database                  clean, exit 0
THE INCIDENT — the password the database no longer has
                                                  REFUSED (28P01, named) exit 1
database that does not exist                      REFUSED (3D000)       exit 1
host that does not resolve                        REFUSED (ENOTFOUND)   exit 1
nothing listening on that port                    REFUSED (ECONNREFUSED)exit 1
remote host, no TLS                               REFUSED without dialling
remote host, sslmode=require, chain trusted       WARNS, proceeds,      exit 0
remote host, sslmode=verify-full, chain trusted   clean and silent,     exit 0
remote host, sslmode=verify-full, chain NOT trusted
                                                  REFUSED (TLS verification) exit 1
the same alias url on mainnet                     REFUSED               exit 1
unset                                             REFUSED               exit 1
```

The third-from-last is the one worth noting: it is the failure the `sslmode=verify-full` edit
could introduce, and it is now caught before a deploy rather than by a crash-looping machine.

The production-only install the workflow performs (`npm ci --omit=dev --prefix
backend/_shared`) was run in a clean copy — 19 packages, 358 ms — and the check driven from it,
to prove it resolves `pg` without the dev dependencies.

---

## 4. Founder actions

1. **`BLOTTO_DATABASE_URL` → `sslmode=verify-full`.** Still outstanding: the TLS line fired
   again on run #39, so the url carries the new password but not the edit. **Behaviourally a
   no-op today** — `require` already means `verify-full` on the pinned `pg`, which is why the
   services connect — so it pins a posture rather than changing one. Worth bundling with the
   deploy that lands this change rather than spending a deploy of its own.
2. Nothing else. This change blocks no deploy the repository can currently make.

Still open from `CHANGE-2026-09-22`: `config/operator.json` (blocks a mainnet deploy), and
counsel on the liability cap, the governing-law clause, the refusal grounds and the retention
periods.
