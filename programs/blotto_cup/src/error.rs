//! Program error codes.
//!
//! Anchor numbers these from 6000 in declaration order. The off-chain error
//! map (`app/src/tx/errors.ts`) mirrors this enum — regenerate it whenever a
//! variant is INSERTED rather than appended, or players see the wrong reason
//! for a failure.

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // 6000 —
    #[msg("Pool is not accepting entries")]
    PoolNotOpen,
    #[msg("VRF seed has already been committed for this pool")]
    VrfSeedAlreadyCommitted,
    #[msg("Randomness account is not owned by the Switchboard On-Demand program, or is malformed")]
    InvalidRandomnessAccount,
    #[msg("Switchboard randomness has not been revealed at the current slot")]
    RandomnessNotResolved,
    #[msg("Pool VRF seed must be committed before entries can be accepted")]
    VrfSeedNotCommitted,
    // 6005 —
    #[msg("Entries are paused")]
    Paused,
    #[msg("Tier is not open")]
    TierNotOpen,
    #[msg("Unknown tier")]
    UnknownTier,
    #[msg("A pool for this tier is already open")]
    TierAlreadyHasOpenPool,
    #[msg("Pool size would exceed the configured vault ceiling")]
    VaultCeilingExceeded,
    // 6010 —
    #[msg("Pool is full")]
    PoolFull,
    #[msg("Pool fill deadline has passed")]
    DeadlinePassed,
    #[msg("Pool fill deadline has not passed")]
    DeadlineNotPassed,
    #[msg("Entry packet missing: no Ed25519 signature-verification instruction found in this transaction")]
    PacketMissing,
    #[msg("Entry packet malformed")]
    PacketMalformed,
    // 6015 —
    #[msg("Entry packet signed by the wrong signer")]
    PacketWrongSigner,
    #[msg("Entry packet is for a different wallet")]
    PacketWrongWallet,
    #[msg("Entry packet is for a different pool")]
    PacketWrongPool,
    #[msg("Entry packet checks not cleared")]
    PacketNotCleared,
    #[msg("Entry packet is stale")]
    PacketStale,
    // 6020 —
    #[msg("Entry packet KYC tier is insufficient for this action")]
    PacketKycInsufficient,
    #[msg("Slot hashes sysvar has no entry old enough for the class digest")]
    SlotHashUnavailable,
    #[msg("Pool is not sealed")]
    PoolNotSealed,
    #[msg("Wrong pool secret")]
    WrongPoolSecret,
    #[msg("Pool secret already revealed")]
    SecretAlreadyRevealed,
    // 6025 —
    #[msg("Pool secret has not been revealed")]
    SecretNotRevealed,
    #[msg("Results already committed")]
    ResultsAlreadyCommitted,
    #[msg("Results not committed")]
    ResultsNotCommitted,
    /// NEVER RETURNED — retained deliberately (audit 2026-09-11, A-16,
    /// recorded KEEP). It belonged to the winners-array design; under D-E2
    /// `commit_results` takes a seat-sorted payout list and proves
    /// distinctness with a strictly-ascending seat check that returns
    /// `PayoutListMalformed` instead. Kept because these codes are a WIRE
    /// CONTRACT: Anchor numbers from 6000 in declaration order, so deleting
    /// a variant renumbers every later one and silently changes the meaning
    /// of every code already recorded in a client map, a test or an
    /// operator's log. A dead variant costs nothing; a renumbered live one
    /// misreports a failure to a player.
    #[msg("Winners are not pairwise distinct")]
    WinnersNotDistinct,
    #[msg("Invalid rank")]
    InvalidRank,
    // 6030 —
    #[msg("Rank already settled")]
    RankAlreadySettled,
    #[msg("Winner account does not match the committed winner for this rank")]
    WinnerMismatch,
    #[msg("Entry account does not belong to this pool and player")]
    EntryMismatch,
    #[msg("Entry already settled")]
    EntryAlreadySettled,
    #[msg("Pool is not refunding")]
    PoolNotRefunding,
    // 6035 —
    #[msg("Entry already refunded")]
    AlreadyRefunded,
    #[msg("No escrow held for this entry")]
    NoEscrow,
    /// NEVER RETURNED — retained for the same reason as
    /// `WinnersNotDistinct` above (audit 2026-09-11, A-16, recorded KEEP).
    /// It validated a forfeit's destination pool back when a forfeit moved
    /// money; since the founder rulings of 2026-09-07 `forfeit_escrow` moves
    /// nothing at all — the share stays in its own pool's vault until
    /// `pay_next_place` divides it — so there is no destination to refuse.
    /// See the "Forfeit destination (history)" note in `escrow.rs`.
    #[msg("Destination pool is not an open pool of the same tier")]
    BadForfeitDestination,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Payout batch account list is malformed")]
    PayoutAccountsMalformed,
    // 6040 —
    #[msg("Entry flag state unchanged")]
    FlagUnchanged,
    #[msg("pool_id must equal Config.next_pool_id")]
    WrongPoolId,
    #[msg("Only a flagged entry's escrow can be forfeited")]
    ForfeitRequiresFlag,
    #[msg("Payout list must be non-empty, seat-sorted, duplicate-free and in range")]
    PayoutListMalformed,
    #[msg("Payout amounts must sum to exactly the pot")]
    PayoutSumMismatch,
    #[msg("Seat is not in the committed payout list")]
    SeatNotInPayouts,
    #[msg("Entry packet carries no accepted terms version")]
    PacketTermsVersionMissing,
    // 6047 —
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Withdrawal would take the platform treasury below its policy floor")]
    WithdrawBelowFloor,
    #[msg("Platform treasury cannot fund this pot under the treasury policy")]
    TreasuryShortfall,
    #[msg("Pot must be a positive multiple of 1024 lamports")]
    PotNotDivisible,
    // 6051 — D-E4, the minimum field (appended, never inserted)
    #[msg("Pool is below the minimum field; it refunds rather than seals")]
    FieldBelowMinimum,
    #[msg("Pool reached the minimum field; it seals rather than refunds")]
    FieldReached,
    #[msg("Pot must be below the minimum field's entries (MIN_SEATS × price)")]
    PotExceedsMinimumField,
    // 6054 — prompt v2 / founder rulings 2026-09-07 (appended, never inserted)
    #[msg("Only the keeper may open a pool")]
    NotKeeper,
    #[msg("Tier is cooling down; its next pool cannot open yet")]
    TierCoolingDown,
    #[msg("Service keys (admin, keeper, entry signer, settlement signer) cannot enter")]
    ServiceKeyCannotEnter,
    #[msg("Escrow was forfeited; it can only be paid to the next place, not released")]
    EscrowForfeitedAlready,
    #[msg("Escrow has not been forfeited; nothing to pay the next place")]
    EscrowNotForfeited,
    #[msg("Next-place payout rank must be first place or the next competition rank")]
    NextPlaceRankInvalid,
    #[msg("Next-place payout target is not the next eligible place")]
    NextPlaceIneligible,
    #[msg("Merkle proof does not reach the committed results root")]
    InvalidMerkleProof,
    #[msg("Config already carries the migrated layout")]
    ConfigAlreadyMigrated,
    #[msg("Config account is not the pre-migration layout")]
    ConfigNotMigratable,
    #[msg("Escrow auto-release is not due yet")]
    AutoReleaseNotDue,
    #[msg("Pool timings must be positive")]
    InvalidTiming,
    /// 6066 — `pay_next_place`: a first-place seat that must be shown
    /// ineligible is still under review (flagged, escrow held, not yet
    /// forfeited or released). Resolve the review first; next-place payout never
    /// skips a pending one.
    #[msg("A first-place review is still pending; resolve it before paying the next place")]
    NextPlaceReviewPending,
    /// 6067 — `pay_next_place`: the split arguments disagree with the group
    /// (group size or remainder flag differs from the on-chain first-place
    /// group, or from the size fixed by this share's earlier payments), or
    /// the last payment would leave the remainder stranded.
    #[msg("Split arguments disagree with the group or with earlier payments of this share")]
    NextPlaceSplitMismatch,

    // 6068 — audit A7 / O18 (appended 2026-09-07, never inserted).
    #[msg("The keeper may not be the zero key")]
    KeeperMustNotBeZero,

    // 6069-6070 — Phase 2 Stage F, the sanctions hold (appended).
    #[msg("A sanctions hold is in force on this entry")]
    SanctionsHoldActive,
    #[msg("No sanctions hold is in force on this entry")]
    NoSanctionsHold,

    // 6071 — the rent-exemption guard on every lamport exit (2026-09-12).
    #[msg("That transfer would leave the account below the rent-exempt minimum")]
    WouldStrandRentBalance,

    // 6072-6073 — `migrate_pool`'s two refusals (R7-b, founder instruction
    // 2026-09-12). APPENDED: the numbers below are a wire contract clients
    // check by value.
    #[msg("Pool is already at the current layout")]
    PoolAlreadyMigrated,
    #[msg("Account is not an un-migrated pool of this program")]
    PoolNotMigratable,
}

#[cfg(test)]
mod error_numbers {
    use super::ErrorCode;

    /// Anchor numbers a variant by its POSITION in the enum, so every number
    /// written in a comment above is really a claim about all the variants
    /// before it. The three appended for the keeper guard and the sanctions
    /// hold were each documented four short, and no test noticed: the LiteSVM
    /// assertions read `err.contains("6065") || err.contains("SanctionsHold\
    /// Active")`, and the name matched. This pins the numbers themselves.
    ///
    /// A failure here means a variant was INSERTED rather than appended,
    /// which renumbers everything after it — an on-chain wire-contract change
    /// that silently invalidates every client checking a number. Append
    /// instead, and add the new variant here.
    #[test]
    fn appended_variants_keep_the_numbers_the_clients_check() {
        for (code, expected) in [
            (ErrorCode::AutoReleaseNotDue, 6064u32),
            (ErrorCode::InvalidTiming, 6065),
            (ErrorCode::NextPlaceReviewPending, 6066),
            (ErrorCode::NextPlaceSplitMismatch, 6067),
            (ErrorCode::KeeperMustNotBeZero, 6068),
            (ErrorCode::SanctionsHoldActive, 6069),
            (ErrorCode::NoSanctionsHold, 6070),
            (ErrorCode::WouldStrandRentBalance, 6071),
            (ErrorCode::PoolAlreadyMigrated, 6072),
            (ErrorCode::PoolNotMigratable, 6073),
        ] {
            assert_eq!(u32::from(code), expected, "{code:?}");
        }
    }
}
