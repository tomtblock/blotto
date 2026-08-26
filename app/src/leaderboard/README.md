# app/src/leaderboard

**Status: empty scaffold created in Phase 0. New work — nothing was carried here.**

## What Phase 3 must build here

The post-close standing for a pool: every player, their score, their stats-won tiebreak, their rank,
and the amount owed to the top 16. Ranking is by score descending, then total stats won descending,
then earlier entry (PID §5).

Since the full battle matrix is published at close, the leaderboard should link each row through to
the comparison that produced it, and to `app/src/verify/` for anyone who wants to recompute the
whole thing themselves.

Flagged entries are shown as flagged and in escrow, not silently omitted.
