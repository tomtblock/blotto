# app/src/claim

**Status: empty scaffold created in Phase 0. New work — nothing was carried here.**

## What Phase 3 must build here

The claim flow: build a Merkle proof of `(player, rank, amount_lamports)` against the committed
`results_root` and submit `claim`. An unflagged winner claims immediately; a flagged one is in
24-hour escrow and the UI must say so, along with the appeal route, rather than failing opaquely.

Also here: the refund path for a pool that missed its deadline below the minimum fill, and the
claim-window expiry after which unclaimed prizes are swept forward to the next pool's vault.

The vault has no withdraw instruction. `claim`, `refund` and `sweep_unclaimed` are the only ways
lamports leave it, and this page drives the first two.
