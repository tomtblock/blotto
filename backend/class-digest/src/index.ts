/**
 * @blotto/class-digest — the TypeScript replay of the cosmetic class draw.
 *
 * WIRING, STATED HONESTLY (audit 2026-09-11, A-21/A-31/F-18): no application
 * module imports this package today. It is built, typechecked and tested in
 * CI, its constants are checked against the program's by
 * `scripts/check-mirrors.py`, and the fair-play page cites
 * `src/digest.ts` as the published proof that the draw is replayable — but
 * the verify page does not yet run it, so a player who wants to replay their
 * own draw must do it themselves from the published events.
 *
 * It is kept rather than deleted because the replay it implements is a
 * published property of the product: ADR-021 (bag without replacement) and
 * ADR-026 (multi-source randomness digest) describe a draw that anyone
 * recomputes from the on-chain `class_counters` bag plus published events —
 * `PoolVrfSeeded.vrf_seed`, and each `EntryRegistered`'s `index`,
 * `slot_hash`, pool and player. Deleting the only TypeScript implementation of that would
 * remove the fair-play page's proof and the mirror CI checks against, to save
 * a package that costs nothing to keep. Wiring it into the verify page is the
 * outstanding work.
 */
export * from './digest';
