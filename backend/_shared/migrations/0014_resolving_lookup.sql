-- Phase 2 Stage C (2026-09-07): the derived "resolving" flag.
--
-- The read API says a pool is RESOLVING while it carries a held share
-- (a payout escrowed at PrizesPaid whose entry has not settled) and the
-- published review window has not yet passed. The window's start is the
-- instant the indexer saw the pool's PrizesPaid event — the on-chain clock
-- (`Entry.escrowed_at`) is what the daemon acts on and what a player can
-- verify; the badge is a view of it, labelled as an indexer observation.
--
-- That lookup reads `events` by (name, raw->>'pool'), which no existing
-- index serves: events_name_slot_idx is (name, slot). One expression index,
-- additive only (house rule: forward-only migrations, no edits to applied
-- files). No table changes; nothing to re-derive.

CREATE INDEX IF NOT EXISTS events_name_pool_idx ON events (name, (raw->>'pool'));
