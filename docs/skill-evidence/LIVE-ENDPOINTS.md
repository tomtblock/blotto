# Skill evidence — the live endpoints (E8)

REPORT.md in this directory is the *simulated* exhibit (the deterministic
strategy-ladder study). This page documents its **live counterpart**: three
public read-API endpoints computing the same class of statistics over real
tournaments, so the skill evidence keeps updating from production data
without anyone curating it.

**Status: wired and served.** The routes live in
`backend/indexer/src/read-api.ts` (spec-pinned in
`backend/indexer/test/read-api.spec.ts`), computed by
`backend/indexer/src/player-history.ts`, and the read API is part of the
indexer service's production entry (`serve`/`sync`, port
`BLOTTO_READ_API_PORT`, default 8081 — docs/hosting.md). Base URL: the
same host the app uses as `NEXT_PUBLIC_INDEXER_URL`.

## The derivation — why these numbers are checkable

Every row derives from the `player_history` table: one row per
(pool × player) carrying the player's running entry count at that entry
and the paid outcome. That table is a **pure function of the on-chain
event ledger** (rebuilt by `re-derive`), so an auditor can reproduce every
figure from public transaction history. No PII beyond wallet addresses
exists anywhere in the pipeline; rank labels are deliberately absent
(D3-B — ranks live in the published bundles) and "outcome" is the paid
seat, the datum that is on-chain and player-verifiable.

All rates are integer-ratio percent strings computed in bigint — no float
touches an amount or a rate.

## The three endpoints

### `GET /history/summary`
First-time vs repeat entries, with the paid-seat rate of each:

```json
{
  "first_time": { "entries": "…", "paid_seats": "…", "paid_seat_rate_pct": "…" },
  "repeat":     { "entries": "…", "paid_seats": "…", "paid_seat_rate_pct": "…" }
}
```

Reading: in a chance mechanism the two rates coincide; persistent
separation is evidence that something carried by the player — skill —
drives outcomes.

### `GET /history/persistence`
Paid persistence over CONSECUTIVE entries of the same wallet: among all
(entry n, entry n+1) pairs, the paid rate at n+1 conditioned on the
outcome at n:

```json
{
  "pairs_after_paid":   { "pairs": "…", "paid_next_rate_pct": "…" },
  "pairs_after_unpaid": { "pairs": "…", "paid_next_rate_pct": "…" }
}
```

Reading: the sharper exhibit. A skill competition expects the two
conditioned rates to separate; a chance mechanism expects them to
coincide (each entry would be an independent draw).

### `GET /history/entries`
The distribution of entries-to-date per wallet:

```json
{ "wallets": "…", "entries_to_date": [ { "entries": "1", "wallets": "…" }, … ] }
```

Reading: the base-rate context for the other two — how much repeat play
exists at all, and therefore how much weight the persistence figures
carry at any point in time.

## Caveats counsel should state with the numbers

- **Sample size**: early in production the pair counts are small; the
  endpoints report raw counts precisely so a reader can judge the weight.
  The simulated study (REPORT.md) carries the large-sample version of the
  same claim under controlled conditions.
- **Selection**: repeat entrants self-select. The persistence exhibit
  (conditioning on the previous outcome *within* the repeat population)
  is the one designed to cut through that; the summary rates alone are
  weaker evidence.
- These endpoints serve aggregates only; per-player careers
  (`/profiles/:player/history`) exist for the player's own profile page
  and carry no more than the ledger already shows.
