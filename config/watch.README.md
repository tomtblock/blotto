# `watch.json` — when the watcher speaks up

**Set by the operator.** Every number in `watch.json` decides how long something may be broken
before the founders' Telegram group hears about it, or how often it hears again. They were proposed
on 2026-10-15 with decision `R23` and are the owner's to change; a change lands in its own commit
saying so. This file is the legend: one row per key, with the reasoning behind the proposed value.

**The schema is not restated here.** `backend/watch/src/config.ts` is the only parser. It refuses a
missing key, an unknown key, or an amount that is not whole lamports. Its spec checks that every key
below is documented, that each service's threshold outlasts its Fly grace period, and that every
watched lane exists.

The loop runs every `loop.intervalSeconds`; "N polls" below means N rounds of that loop.

---

## The loop

| Key | Value | Why |
|---|---|---|
| `loop.intervalSeconds` | 60 | Four daemon ticks (15 s each). GitHub's scheduler ran backend-watch 2–10 h apart, which is why this is a separate app at all. |
| `loop.watchdogSeconds` | 300 | All probes run in parallel with timeouts of `loop.httpTimeoutSeconds`; five minutes without a round means the loop itself is stuck, so the process exits and Fly restarts it. |
| `loop.httpTimeoutSeconds` | 10 | Twice Fly's own health-check timeout (5 s). |

## Incidents

| Key | Value | Why |
|---|---|---|
| `incidents.clearAfterPasses` | 2 | One passing probe is not recovery. |
| `incidents.reminderHours` | 4 | Half a working day. Only the thread's first message buzzes again. |
| `incidents.laneReminderHours` | 24 | A red CI lane stays red until its next run; reminding sooner adds nothing. |
| `incidents.flapWindowMinutes` | 30 | A check that fails again within this of clearing goes back into its old thread, silently. |
| `incidents.maxMessagesPerHour` | 10 | An attention budget. Telegram itself allows about 20 a minute in a group; held messages are counted in the next one sent. |

## Services

| Key | Value | Why |
|---|---|---|
| `services.apps` | the four Fly apps | What `/health` is probed on, at `https://<app>.fly.dev`. |
| `services.failuresToAlert` | indexer 3, packet 4, daemon 6, review 3 | Each must outlast the app's Fly grace period (indexer and review 30 s, packet 180 s, daemon 300 s), so a restart is never called an outage. While a `deploy-backend` run is going, service checks are held regardless. The indexer's figure also applies to its pages (`indexer:read-api`), which can fail while its `/health` answers. |
| `services.ingestUrl` | indexer `:8080/health` | The webhook receiver the RPC provider delivers events to, probed over IPv4 because that is how the provider reaches it. |
| `services.ingestFailuresToAlert` | 3 | Grace 30 s, as above. |

## Settlement service

| Key | Value | Why |
|---|---|---|
| `daemon.tickStaleSeconds` | 300 | Twenty missed ticks. The daemon's own 503 only comes at 900 s. `PHASE-N-REVIEW`: no measured worst-case settlement tick yet. |
| `daemon.tickErrorPolls` | 5 | Five distinct ticks in a row with errors is persistent, not a blip. This is the check that would have caught the 2026-10-10 outage, when `/health` read ok while every tick failed. |
| `daemon.settlementFloorLamports` | 200000000 (0.2 SOL) | Four times the 0.05 SOL startup floor (`backend/reveal/src/startup.ts`). At roughly 0.016 SOL per pool launched and settled, that is about a dozen pools of warning. |

## Chain

| Key | Value | Why |
|---|---|---|
| `chain.readFailuresToAlert` | 5 | The watcher reads through the public devnet endpoint by default, which is flakier; the watcher being half-blind is low severity. |
| `chain.failuresToAlert` | 2 | Pool and vault are read in one slot; two rounds rule out a lagging node. |
| `chain.passCollectionGraceSeconds` | 120 | The daemon creates the collection on the tick after `open_pool` and retries every 15 s: eight chances. |
| `chain.fillDeadlineSlackSeconds` | 300 | The daemon tries to close a pool on every tick after its deadline; twenty missed ticks means it is stuck. |
| `chain.keeperSlackSeconds` | 300 | The same for opening the next pool once a tier may open one. |
| `chain.sealedMaxMinutes` | 30 | Sealed → Scored is a few ticks of reveal and scoring. `PHASE-N-REVIEW`: set against the devnet trial's measured times. |
| `chain.scoredMaxMinutes` | 15 | Scored → Paid is one payout transaction per seat. |
| `chain.refundingMaxMinutes` | 30 | Refunds are one transaction per entrant. |
| `chain.pausedIsIncident` | true | A forgotten pause is the failure. Switch it off while a pause is deliberate. |

## Indexer

| Key | Value | Why |
|---|---|---|
| `indexer.lagPolls` | 5 | The webhook lands within seconds and the reconciliation walk repairs gaps; five minutes behind means the path is broken. |
| `indexer.ledgerFallbackPolls` | 3 | The indexer's own chain read failing persistently. |

## RPC provider

| Key | Value | Why |
|---|---|---|
| `provider.probeEverySeconds` | 300 | One account read (`getAccountInfo` of the Clock sysvar) every five minutes is 288 a day, about 8,600 credits a month. An account read and not `getSlot`, since 2026-10-17: on 2026-10-16 Helius failed account reads for 36 minutes while `getSlot` kept answering. |
| `provider.creditsSpentFailuresToAlert` | 1 | "max usage reached" never clears on its own: say so at once. |
| `provider.otherFailuresToAlert` | 3 | A plain rate limit or outage must last fifteen minutes. |

## The services' own alerts

| Key | Value | Why |
|---|---|---|
| `alerts.metricsPort` | 9090 | Equals `BLOTTO_METRICS_PORT` in every `deploy/fly/*.fly.toml` (the spec checks it). Read over Fly's private network only. |
| `alerts.quietMinutesToClear` | 60 | Some alerts are raised again on every check (an OFAC mirror past its age); an hour without one means the condition is gone. |
| `alerts.scrapeFailuresToAlert` | 5 | Private-network trouble; low severity. |
| `alerts.ignoreReasons` | `reveal daemon tick stale` | Already covered, earlier and better, by `daemon.tickStaleSeconds`. |

## Web app

| Key | Value | Why |
|---|---|---|
| `site.aliasUrl` | the Vercel alias `/api/version` | Ungated; serves the same build as the domain. |
| `site.domainUrl` | `www.blotto.gg/.well-known/assetlinks.json` | The one ungated path on the gated domain, and the file the Android app's wallet link depends on. |
| `site.failuresToAlert` | 3 | The CDN caches the file; three minutes rules out a blip. |
| `site.versionLagMinutes` | 20 | Installing the backend packages plus `next build`. `PHASE-N-REVIEW`: set against Vercel's measured build time. |

## CI lanes (GitHub Actions)

| Key | Value | Why |
|---|---|---|
| `lanes.pollEverySeconds` | 300 | About 100 API requests an hour, far under GitHub's 5,000. Whether a deploy is running is checked every round. |
| `lanes.deploySettleSeconds` | 360 | After a deploy finishes: the daemon's 300 s grace plus one round. |
| `lanes.tokenExpiryWarnDays` | 14 | Two weekends to rotate the watcher's GitHub token. |
| `lanes.watched` | ci-fast, on-chain, deployed-drift, deploy-backend, backend-watch, security-sweep | Not `app-lighthouse`, which is red by design until the Play page meets D-E12's floor. |

## Claude's diagnosis

| Key | Value | Why |
|---|---|---|
| `diagnosis.maxPerDay` | 6 | It runs on the owner's Claude subscription, whose allowance is shared with their own use. |
| `diagnosis.minMinutesBetweenSameCheck` | 360 | A flapping check is not diagnosed again within six hours. |
