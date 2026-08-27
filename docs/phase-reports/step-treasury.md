# Step report — A1: the two-wallet pre-funded treasury (D-A1 revised)

**Status: complete.** Master prompt v2 (2026-08-27) work item A1, one PR:
program + reveal + indexer + app. Every suite green locally (workspace unit +
model fuzz, LiteSVM ×24, scoring 72, reveal 30, indexer 29, rehearsal 7, app
179, sealing/packet/detection/class-digest/_shared unchanged), clippy
`-D warnings` clean, language + standing-rules + gitleaks gates clean, event
fixture regenerated from the compiled program.

## What changed, in one paragraph

Money now lives in exactly two places. A program-held **platform treasury
PDA** (`[b"platform"]`, zero-data, system-owned — the same custody pattern as
the vaults) receives 100% of every pass sale at `register` and funds each
pool's **fixed pot** into its prize vault at `open_pool`, before any pass is
sold. Entries never touch a prize vault. `open_pool` is permissionless and
gated by the program itself: tier enabled (R6), tier's previous pool Paid or
Closed (SEQUENTIAL — supersedes R14's seal-time handover), D2 ceiling on pass
sales (price × 64), and the treasury policy (after funding the pot, the
treasury must still hold `min_platform_lamports` plus `reserve_pots` further
pots of every other enabled idle tier, computed over the balance NET of
refundable entries). The refund fork returns the untouched pot to the
treasury at `trigger_refund` and repays each entry in full from the treasury.
`withdraw_platform` (Squads-only) is the treasury's one exit, blocked below
the floor. The 80/20 split, the per-pool fees PDA, the seal-time sweep, and
every `entry×64` pot derivation are gone.

## Judgement calls (founder attention ordered first)

1. **The withdraw floor ADDS refundable entries.** v2's prose floor is
   `min + reserve_pots × idle pots`. Entries are paid into the treasury at
   `register` and refunded FROM it, so the refundable sum is players' money
   in transit; a floor that ignored it would let a withdrawal defund R7's
   100% refund. `Config.platform_refundable` tracks it exactly (+price per
   entry, −64×price at seal, −price per refund) and both the floor and
   `open_pool`'s availability subtract it. Money-correctness over prose
   (tradeoff order #1). Sites: `treasury.rs`, `open_pool.rs`, `register.rs`.
2. **"One further pot of every tier currently enabled and not open" is read
   as EXCLUDING the tier being opened**, evaluated after hypothetically
   funding its pot. The tier becomes live the instant the open succeeds, so
   counting its own next pot would double-reserve it. Consequence proven in
   LiteSVM (`seven_tier_ladder…`): opening a rung at its exact threshold
   leaves the treasury holding precisely the next rung's threshold, and the
   floor pins every lamport of it.
3. **The treasury's state lives on Config; the PDA holds only lamports.**
   `tier_price_lamports`, `tier_pot_lamports`, `treasury_reserve_pots`,
   `treasury_min_platform_lamports`, `platform_reserved`,
   `platform_refundable`, `platform_bump` are Config fields — one
   deserialization per instruction, uniform custody, no new account type.
4. **The prize-vault exit set is unchanged in file terms, reshaped in
   instruction terms.** `refund` no longer debits the vault; the refund
   fork's vault exit is `trigger_refund`'s pot return (same file,
   `refund.rs`). `vault_debit` call sites stay exactly
   {`pay_prizes.rs`, `escrow.rs`, `refund.rs`}; `platform_debit`'s are
   exactly {`open_pool.rs`, `refund.rs`, `treasury.rs`}; standing-rules
   checks (d)–(g) pin both sets, ban vault movement in `register.rs`, and
   ban pot arithmetic over entries/balances.
5. **`forfeit_escrow` now pays the treasury PDA** (was the operator's
   configured wallet). Forfeits become program-held and reachable only
   through the floor-guarded exit — strictly stronger custody; the Phase 1
   ratification's substance (never a successor vault) stands.
6. **`set_tier_economics` requires `pot % 1024 == 0`** (`PotNotDivisible`) so
   the band table always divides with zero residue — without it a founder
   typo would strand lamports in every vault of that tier.
7. **Migration is `0007_treasury.sql`, not v2's "0005"** — 0005/0006 were
   taken by terms-version and review-decisions before the revision landed.
   It only adds `pools.pot_lamports`: the treasury REPORT is deliberately
   not a derived table (below).
8. **GET /treasury replays the raw event ledger** (like /verify-record):
   `PlatformFunded/Withdrawn` carry exact post-move balances (anchors), and
   every other movement is derivable per event — so every reported number is
   player-replayable. PHASE-A1-REVIEW: `set_open_tiers` emits no event, so
   the report cannot see tier ENABLEMENT and treats all seven configured
   tiers as enabled — which can only overstate the floor. The keeper is
   exact (it reads live Config). If the founder wants the report exact too,
   an enablement event is a small program change to price separately.
9. **The keeper opens every openable tier per tick, lowest first**, by
   looping `nextOpenable` (pure, parity-tested against `FakeChain.openPool`,
   which LiteSVM pins to the program) until it returns none.
10. **The seven-tier-ladder LiteSVM test pins the unlock arithmetic**
    (one lamport under blocks, the exact threshold opens, the reserve
    pre-funds each next rung); the revenue GRIND that walks the ladder for
    real is the rehearsal's multi-pool run, not a 500-pool LiteSVM sim.
11. **Layout changes**: `Pool` gains `pot_lamports` (+8 after
    `entry_lamports`) and drops `fees_bump`; `Config` drops
    `platform_wallet` and gains the seven fields above. Every off-chain
    byte-offset reader (LiteSVM harness, `Web3Chain`) was recomputed and is
    pinned by the serialize-LEN tests + the LiteSVM suite. `init_config`
    now takes `(entry_signer, settlement_signer, vault_ceilings,
    treasury_min_platform_lamports)` and derives the platform bump; the
    launch `treasury_min_platform_lamports` is a **founder-owned number —
    proposed 0 for devnet, awaiting ratification for mainnet**.
12. **v2's header still names the old program ID (4psp…)** — stale
    boilerplate; the ratified re-key to `5aaw…` stands (flagged when the
    re-key landed).

## New instructions

| Instruction | Signer | Purpose |
|---|---|---|
| `fund_platform_wallet(amount)` | anyone | deposit into the treasury (bootstrap + any top-up) |
| `withdraw_platform(amount)` | admin (Squads) | the ONE treasury exit, floor-guarded |
| `set_tier_economics(tier, price, pot)` | admin | founder-owned numbers; never touches an open pool |
| `set_treasury_policy(reserve_pots, min)` | admin | the floor's policy half |

New events: `PoolOpened.pot_lamports`, `PlatformFunded`, `PlatformWithdrawn`,
`TierEconomicsSet`, `TreasuryPolicySet` — decoders updated in the same
commit; fixture regenerated via `DUMP_EVENT_FIXTURE=1`.

## Vocabulary

The B7 lexicon gains v2's four finance-framing terms (the list itself lives
in `CONTRIBUTING.md` → "The language gate", group 4 — this report does not
restate it, only `step-vocabulary.md` may name gated words). All
treasury-facing copy says "prize treasury" / "treasury policy" / "treasury
report"; the custody page's row describes the PDA (no private key exists)
and its floor; the rules tab gains the v2 pool-opening paragraph verbatim.
