# backend/watch

The failure-only watcher (decision `R23`). Once a minute it looks at everything a player depends
on, and says nothing unless something is wrong. When something is, it writes to the founders'
Telegram group with what broke, the likely cause, and the first thing to do. It also asks Claude
for a diagnosis, which arrives as a reply in the same thread.

It runs as its own Fly app (`blotto-watch`, deployed by `.github/workflows/deploy-watch.yml`), in a
different region from the services it watches. It holds no database credential, no signing key and
no Fly token.

How to read and act on an alert: [`docs/guide/OPERATING-MANUAL.md`](../../docs/guide/OPERATING-MANUAL.md) §9.
Secrets and deployment: [`docs/guide/HOSTING.md`](../../docs/guide/HOSTING.md). Thresholds:
[`config/watch.json`](../../config/watch.json), with its legend in
[`config/watch.README.md`](../../config/watch.README.md).

## Modules

| File | Holds |
|---|---|
| `src/main.ts` | The loop, the `/health` endpoint and the watchdog. `Watcher` ties checks, incidents and messages together. |
| `src/collect.ts` | Every fetch: HTTP probes, the chain snapshot, the provider probe, metrics scrapes. Fetches only, decides nothing. |
| `src/checks.ts` | Every check, as a pure function from what was fetched to `pass`, `fail` or `unknown`. |
| `src/alerts.ts` | Reads the services' own `blotto_alerts_total{reason}` counters and turns an increase into a verdict. |
| `src/incidents.ts` | When a verdict becomes a message: thresholds, batching, threading, reminders, the silent all-clear. |
| `src/causes.ts` | The rule-based cause and first step for each incident. This is what the alert says before Claude does. |
| `src/format.ts` | The Telegram HTML: escaped, and under the length limit. |
| `src/telegram.ts` | Sending, and working around every refusal Telegram documents. |
| `src/github.ts` | CI lane verdicts, main's head, whether a deploy is running, and starting a diagnosis. |
| `src/diagnosis.ts` | When to ask Claude, the answer's schema, and how the answer reads in the thread. |
| `src/redact.ts` | Removes credentials, IPs and wallet addresses from evidence, and again from Claude's answer. |
| `src/solana.ts` | PDA derivation and `getMultipleAccounts`. Layouts come from `backend/_shared` (`config-account.ts`, `pool-account.ts`). |
| `src/cli/*.ts` | The steps `diagnose.yml` and `deploy-watch.yml` run: `snapshot`, `redact`, `post-diagnosis`, `telegram-test`. |

## Running it locally

```bash
cd backend/_shared && npm ci && cd ../watch && npm ci
WATCH_DRY_RUN=1 npm start     # prints messages instead of sending them
npm test
```

Without `WATCH_DRY_RUN=1`, it refuses to start unless `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
are set. That way a local run never writes to the group by accident, and a deployed one never runs
silent by accident.
