//! The money-model invariant suite (roadmap 1.7, reworked for D-A1 revised —
//! the substitute for an audit under R5, so it errs toward paranoia).
//!
//! A model of the program's money flows is driven through 10k random
//! instruction sequences PER POOL SHAPE. The model calls the SAME arithmetic
//! the handlers call (`prize_math`, `vault::rent_safe`), and mirrors each
//! handler's preconditions; after every step it asserts the two-wallet ledger
//! identities:
//!
//! ```text
//! vaults   == Σ pots funded + Σ cushions funded − Σ paid − Σ released
//!             − Σ next-place payouts − Σ pot returns (refund fork)
//! platform == Σ deposits + Σ entry payments + Σ pot returns
//!             − Σ pots funded − Σ cushions funded − Σ refunds − Σ withdrawals
//! ```
//!
//! `vaults` is every prize vault the run has opened: the live pool's plus
//! what the settled ones still hold. Since 2026-09-12 (audit B-03)
//! `open_pool` funds a vault with its pot PLUS a rent cushion
//! (`VAULT_RENT_CUSHION`, the rent-exempt minimum for a zero-data account),
//! taken from the treasury; the pot leaves by the four exits and the cushion
//! never does, so a settled vault holds exactly its cushion for ever. The
//! model has one vault slot, so when it moves on to the next pool it carries
//! the old vault's balance into `retired_vaults` and the identity keeps
//! counting it.
//!
//! Note what is NOT in either identity since the 2026-09-07 ruling: a
//! forfeit. `forfeit_escrow` moves nothing — the share stays in its pool's
//! vault, marked, until `pay_next_place` pays it to the next eligible
//! place. No term carries lamports from a vault to the platform any more;
//! if one ever reappears, the platform identity fails.
//!
//! Plus the policy properties: the treasury always covers the refundable sum
//! (`withdraw_platform`'s floor and `open_pool`'s availability gate both
//! subtract it); once the treasury has ever stood at `min_platform +
//! refundable` no program action takes it below (prompt v2 PR0 — deposits
//! are the only way UP to the floor, so the property is armed by the first
//! deposit that reaches it and holds from then on); `platform_reserved`
//! tracks exactly the live pool's pot (the pot alone — never the cushion);
//! the idle-tier reserve prices an open at what it costs, pot plus cushion;
//! a below-floor withdrawal is refused with nothing moved. Every lamport
//! movement passes the runtime's rent-state rule (`vault::rent_safe`: a
//! zero-data account ends a transaction empty or rent-exempt, never between)
//! — on the vault as an ASSERTION, because the cushion exists precisely so
//! that no reachable path can trip it; on the treasury as a mirrored
//! REFUSAL, because there it can (see `platform_debit` and `fund`). Terminal
//! conditions: a fully settled pool leaves its vault holding exactly the
//! outstanding escrow plus the cushion (the cushion alone once escrow
//! settles — released or paid onward), and a fully refunded pool leaves the
//! vault at exactly the cushion with every entrant repaid their exact price
//! — R7's "full refund" is exact, not approximate.
//!
//! Pools are SEQUENTIAL per pool type (D-A1 revised; the slot is the pool
//! TYPE's since D-E19): the model is one pool type, re-opens a new pool only
//! after the previous reached `Paid` or `Closed`, mirroring
//! `PoolType.active_pool`, and the ledger identities run ACROSS pools.
//!
//! D-E4 (2026-09-06, option A per the 2026-09-07 ruling) adds the second
//! seal path: past the deadline a pool at or above its minimum field seals
//! (`seal_at_deadline`) and below it refunds (`trigger_refund`). The model
//! abstracts the clock the same way it always did for the refund fork — the
//! deadline is assumed past whenever either op fires — and mirrors the field
//! guard on both, so the fork is decided by seat count exactly as on-chain.
//! The auto-release (`release_escrow` by anyone after seven days) is the
//! same lamport movement as the reviewed release; the model has no clock and
//! models one `release`. The next-place payout's rank proof is the LiteSVM suite's job;
//! here `pay_next_place` mirrors only the money and the eligibility flags.
//!
//! # The Ladder (D-E19)
//!
//! Since D-E19 a pool's size, minimum field and prize table are its own,
//! copied from its pool type: 8, 16, 32 or 64 seats, the minimum field
//! `LADDER_MIN_SEATS`, and `LADDER_TABLES` in whole multiples of the entry —
//! the top quarter paid, the prize pool `Σ table × price`. The model is
//! parameterised by that SHAPE (`Shape`), and every property runs once per
//! capacity, the money-ledger property 10,000 sequences each. A fifth shape,
//! `Shape::legacy()`, is a pool opened before the Ladder as `migrate_pool`
//! records it — 64 seats, ONE paid place, table `[40]` — because two paths
//! still serve it and only it: winner-takes-all settlement and
//! `pay_next_place`. In a Ladder pool `pay_next_place` is refused
//! (`NextPlaceUnsupported`, founder decision of 2026-11-05) and a forfeited
//! share is HELD in the vault; the model mirrors the refusal and its
//! terminal checks count held shares as claims, exactly as they count a
//! share no eligible seat can take.
//!
//! `commit_results` now also refuses a zero amount and any amount above the
//! pool's first prize (`prize_table[0] × entry`). The model does not mirror
//! those as refusals: it ASSERTS that the published rule (`split_group`
//! over the table) never produces such a list, at every shape, tier and tie
//! pattern — so a refusal on chain could only ever meet a list the rule did
//! not make.
//!
//! What this does and does not prove: it proves the arithmetic and the state
//! machine conserve lamports under any interleaving the program permits. It
//! does not execute the real BPF program — the LiteSVM integration suite
//! covers the on-chain half against the compiled artifact.

use blotto_cup::constants::{
    CAPACITY, LADDER_MIN_SEATS, LADDER_TABLES, MAX_PAID_PLACES, POOL_CAPACITIES,
    TIER_ENTRY_LAMPORTS,
};
use blotto_cup::prize_math::split_group;
use blotto_cup::vault::rent_safe;
use proptest::prelude::*;

/// The fixed arrays' width — the largest pool (`Pool.payouts`, the
/// `paid_mask` bits). A pool's own size is `Shape::capacity`.
const CAP: usize = CAPACITY as usize;

/// A pool's shape: what its pool type copies onto it at open (D-E19).
#[derive(Clone, Copy, Debug, PartialEq)]
struct Shape {
    capacity: usize,
    min_seats: usize,
    table: [u8; MAX_PAID_PLACES],
}

impl Shape {
    /// The launch shape for `POOL_CAPACITIES[k]`.
    fn ladder(k: usize) -> Shape {
        Shape {
            capacity: POOL_CAPACITIES[k] as usize,
            min_seats: LADDER_MIN_SEATS[k] as usize,
            table: LADDER_TABLES[k],
        }
    }

    /// A pool opened before the Ladder, as `migrate_pool` records it: 64
    /// seats, one place, its prize pool in whole entries — `[40]` at every
    /// launch price (40 × price is the D-E1 tier pot) — and the R7-b floor
    /// of 40 it was opened with.
    fn legacy() -> Shape {
        let mut table = [0u8; MAX_PAID_PLACES];
        table[0] = 40;
        Shape {
            capacity: CAP,
            min_seats: 40,
            table,
        }
    }

    /// Shapes `0..4` are the Ladder's capacities in order; `4` is legacy.
    // PHASE-N-REVIEW: legacy kept as a fifth shape so the next-place split stays fuzzed; it is the only shape where that path still moves money.
    fn nth(i: usize) -> Shape {
        if i < POOL_CAPACITIES.len() {
            Shape::ladder(i)
        } else {
            Shape::legacy()
        }
    }

    fn paid_places(&self) -> usize {
        self.table.iter().take_while(|&&m| m > 0).count()
    }

    /// `Σ table × price` — the pool type's prize pool (`PoolType::table_value`).
    fn pot(&self, price: u64) -> u64 {
        self.table.iter().map(|&m| m as u64 * price).sum()
    }

    /// First place: the bound `commit_results` holds every amount to.
    fn first_prize(&self, price: u64) -> u64 {
        self.table[0] as u64 * price
    }

    /// Where the KYC switch splits the paid set when it is on: above second
    /// place's worth, so a solo first place (and a tie group whose share
    /// exceeds second place) escrows while every lower place pays direct.
    /// A one-place pool has no second place; there it is half the prize
    /// pool, the D-E2 split — a solo winner escrows, a tied member does not.
    fn kyc_split(&self, price: u64) -> u64 {
        // PHASE-N-REVIEW: the old split (pot / 2) escrows nothing under a multi-place table; second place's worth is the analogous line.
        if self.paid_places() > 1 {
            self.table[1] as u64 * price
        } else {
            self.pot(price) / 2
        }
    }
}

/// Every shape the properties run over: the four capacities, then legacy.
const N_SHAPES: usize = 5;

/// The rent cushion every prize vault is funded with on top of its pot
/// (2026-09-12, audit B-03): the rent-exempt minimum for a ZERO-DATA
/// account, which the program reads live as `Rent::get()?.minimum_balance(0)`
/// (`vault::rent_floor`). On the runtime's default rent schedule that is
/// 3_480 lamports per byte-year × 2 years' exemption threshold × (128 bytes
/// of per-account overhead + 0 bytes of data) = 890_880 lamports — the
/// figure `tests/litesvm/src/lib.rs::VAULT_RENT_CUSHION` proved against the
/// compiled program and `vault.rs`'s own unit tests reason with. The model
/// pins it: it has no sysvar, and its arithmetic must match the runtime's
/// to the lamport rather than track it.
const VAULT_RENT_CUSHION: u64 = 890_880;

/// Mirror of `PoolState` — the model tracks the same machine.
#[derive(Clone, Copy, PartialEq, Debug)]
enum St {
    Open,
    Sealed,
    Scored,
    Paid,
    Refunding,
    Closed,
}

#[derive(Clone, Copy, Default)]
struct EntryModel {
    exists: bool,
    flagged: bool,
    settled: bool,
    refunded: bool,
    /// Review upheld the flag: the escrow below can only be paid to the next place.
    forfeited: bool,
    escrow: u64,
    /// Forfeited shares paid onward TO this entry (`Entry.next_place_lamports`).
    next_place: u64,
    /// The split book-keeping on a forfeiter (`Entry.split_*`).
    split_total: u64,
    split_paid: u64,
    split_group: u16,
}

impl EntryModel {
    /// `escrow.rs::review_pending` — a flag review not yet resolved.
    fn review_pending(&self) -> bool {
        self.flagged && !self.forfeited && (!self.settled || self.escrow > 0)
    }
    /// An eligible next-place payout target (`pay_next_place`'s checks on `to`).
    fn eligible(&self) -> bool {
        self.exists && !self.refunded && !self.forfeited && !self.review_pending()
    }
}

/// The model. Lamport balances are u128 in the LEDGER (so an overflow bug in
/// the model itself cannot mask one in the program's u64 math — every u64
/// the program would hold is asserted to fit).
struct Model {
    /// The pool type's shape: capacity, minimum field, table (D-E19).
    shape: Shape,
    price: u64,
    /// `Σ table × price`, the prize pool every pool of the type is funded with.
    pot: u64,
    min_platform: u64,
    // Treasury.
    platform: u128,
    reserved: u128,
    refundable: u128,
    /// Armed the first time the treasury stands at `min_platform +
    /// refundable`; from then on no program action may take it below.
    floor_armed: bool,
    // The live pool (sequential — at most one). `None` before the first open
    // and irrelevant after terminal states; the terminal pool stays so its
    // escrow can settle.
    state: St,
    opened: bool,
    entrants: usize,
    vault: u128,
    /// What the vaults of the pools this single slot has moved past still
    /// hold — on-chain each pool has its OWN vault, and a settled one keeps
    /// its cushion for ever; the ledger identity counts them here.
    retired_vaults: u128,
    /// Bit per SEAT (D3-B), mirroring the program.
    paid_mask: u64,
    /// The committed payout list: (seat, amount), seat-sorted. Built by
    /// `commit` from tie groups through the SAME `split_group` the program's
    /// arithmetic module exposes.
    committed: Vec<(usize, u64)>,
    kyc_above: u64,
    entries: [EntryModel; CAP],
    // Ledger tallies for the invariants (across ALL pools of the run).
    total_deposits: u128,
    total_entries_in: u128,
    total_pots_funded: u128,
    /// One cushion per pool opened — treasury out, vault in, never back.
    total_cushions_funded: u128,
    total_pot_returns: u128,
    total_paid: u128,
    total_refunded: u128,
    total_released: u128,
    total_next_place: u128,
    total_withdrawn: u128,
    pools_settled: u32,
}

impl Model {
    fn new(shape: Shape, price: u64, min_platform: u64, kyc_above: u64) -> Self {
        Model {
            shape,
            price,
            pot: shape.pot(price),
            min_platform,
            platform: 0,
            reserved: 0,
            refundable: 0,
            floor_armed: false,
            state: St::Closed,
            opened: false,
            entrants: 0,
            vault: 0,
            retired_vaults: 0,
            paid_mask: 0,
            committed: Vec::new(),
            kyc_above,
            entries: [EntryModel::default(); CAP],
            total_deposits: 0,
            total_entries_in: 0,
            total_pots_funded: 0,
            total_cushions_funded: 0,
            total_pot_returns: 0,
            total_paid: 0,
            total_refunded: 0,
            total_released: 0,
            total_next_place: 0,
            total_withdrawn: 0,
            pools_settled: 0,
        }
    }

    /// The single pool type's idle reserve: `reserve_pots (1) × (pot + cushion)`
    /// when the tier has no live pool, excluding the tier being opened when
    /// asked (mirrors `idle_pool_type_reserve`'s exclude parameter). A reserved
    /// pot is an OPENABLE pot, and an open costs the pot plus the cushion
    /// (treasury.rs, 2026-09-12).
    ///
    /// 2026-09-12: the model carries the cushion everywhere the program does
    /// — the funding, this reserve, both ledger identities, the terminal
    /// balances, and the rent-state rule on every lamport movement.
    fn idle_reserve(&self, exclude_self: bool) -> u128 {
        let live = self.opened && !matches!(self.state, St::Paid | St::Closed);
        if live || exclude_self {
            0
        } else {
            self.pot as u128 + VAULT_RENT_CUSHION as u128
        }
    }

    /// `vault::vault_debit` — THE vault exit, with its rent-state guard
    /// (`assert_rent_safe`): the post-balance must be zero or at least the
    /// cushion, or the program refuses with `WouldStrandRentBalance`. The
    /// cushion exists so that guard can never fire on a reachable path — a
    /// vault that cannot land its last payment is the B-03 freeze — so the
    /// model does not mirror a refusal here, it FAILS on one.
    fn vault_debit(&mut self, amount: u128, what: &str) {
        let post = self
            .vault
            .checked_sub(amount)
            .unwrap_or_else(|| panic!("vault underflow at {what}"));
        assert!(
            rent_ok(post),
            "WouldStrandRentBalance at {what}: the vault would end at {post}, rent-paying — the cushion failed"
        );
        self.vault = post;
    }

    /// `vault::platform_debit` — the treasury's exit, under the same guard.
    /// Here a refusal IS reachable: with `min_platform` at zero the floor lets
    /// the treasury run down to dust, and a debit that would leave
    /// `0 < balance < cushion` is refused with nothing moved — the program's
    /// designed answer, so the model mirrors it (`false`; the caller's
    /// transaction reverts). An underflow is a floor failure and fails loudly.
    fn platform_debit(&mut self, amount: u128, what: &str) -> bool {
        let post = self
            .platform
            .checked_sub(amount)
            .unwrap_or_else(|| panic!("treasury underflow at {what}"));
        if !rent_ok(post) {
            return false; // WouldStrandRentBalance
        }
        self.platform = post;
        true
    }

    /// `fund_platform_wallet` — permissionless deposit. The program refuses
    /// only zero; the RUNTIME refuses a credit that would leave the treasury
    /// rent-paying (an empty account cannot take on less than the rent-exempt
    /// minimum — `Uninitialized → RentPaying` is a forbidden transition), and
    /// the model mirrors that so the rent-state invariant holds after every
    /// op the way it holds on-chain. Nothing moves on a refusal.
    fn fund(&mut self, amount: u64) {
        if amount == 0 {
            return; // handler rejects ZeroAmount
        }
        let post = self.platform + amount as u128;
        if !rent_ok(post) {
            return; // InsufficientFundsForRent — the runtime's refusal
        }
        self.platform = post;
        self.total_deposits += amount as u128;
    }

    /// `withdraw_platform` — refused below the floor, nothing moved; refused
    /// likewise when the debit would leave the treasury rent-paying.
    fn withdraw(&mut self, amount: u64) {
        if amount == 0 {
            return;
        }
        let floor = self.min_platform as u128 + self.idle_reserve(false) + self.refundable;
        if self.platform < amount as u128 + floor {
            return; // handler rejects WithdrawBelowFloor; model must not move
        }
        if !self.platform_debit(amount as u128, "withdraw_platform") {
            return; // WouldStrandRentBalance — nothing moved
        }
        self.total_withdrawn += amount as u128;
    }

    /// `open_pool` — sequential rule + treasury policy gate + funding of the
    /// pot AND the vault's rent cushion. (The keeper gate and the cooldown
    /// are clock and key checks with no money in them — LiteSVM's job.)
    fn open_pool(&mut self) {
        let live = self.opened && !matches!(self.state, St::Paid | St::Closed);
        if live {
            return; // TierAlreadyHasOpenPool
        }
        // Escrow left on a Paid pool's vault would be stranded by reusing the
        // model's single-pool slot; only move on once escrow is settled.
        // (On-chain each pool has its OWN vault, so this is a model
        // limitation, not a program precondition.)
        if self.entries.iter().any(|e| e.escrow > 0) {
            return;
        }
        let cushion = VAULT_RENT_CUSHION as u128;
        let funding = self.pot as u128 + cushion;
        let available = self.platform.saturating_sub(self.refundable);
        let needed = funding + self.min_platform as u128 + self.idle_reserve(true);
        if available < needed {
            return; // TreasuryShortfall
        }
        // Treasury → the new vault: pot plus cushion, one debit. The gate
        // above does not keep the treasury clear of the rent band (at
        // `min_platform` 0 it may leave dust), so the debit itself can refuse.
        if !self.platform_debit(funding, "open_pool") {
            return; // WouldStrandRentBalance — nothing moved
        }
        // The slot moves on: the previous pool's vault keeps what it holds —
        // exactly its cushion, escrow being settled (guard above) and the
        // terminal balances pinned by `assert_terminal` — for ever. Carry it
        // so the ledger identity still counts every vault the run opened.
        if self.opened {
            assert_eq!(
                self.vault, cushion,
                "a settled pool's vault holds exactly its cushion when the tier moves on"
            );
            self.retired_vaults += self.vault;
        }
        self.total_pots_funded += self.pot as u128;
        self.total_cushions_funded += cushion;
        // `platform_reserved` tracks the pot alone: the pot is what must be
        // payable; the cushion is the vault's, never a prize.
        self.reserved += self.pot as u128;
        self.opened = true;
        self.state = St::Open;
        self.entrants = 0;
        self.vault = funding;
        self.paid_mask = 0;
        self.committed.clear();
        self.entries = [EntryModel::default(); CAP];
    }

    /// `register` — the full price into the treasury; the entry that reaches
    /// the pool's OWN capacity seals it (D-E19: 8, 16, 32 or 64).
    fn register(&mut self) {
        if !self.opened || self.state != St::Open || self.entrants >= self.shape.capacity {
            return; // handler would revert (PoolFull is unreachable: it sealed)
        }
        // Belt-and-braces mirror: the vault must already hold the pot and
        // its cushion.
        assert!(
            self.vault >= self.pot as u128 + VAULT_RENT_CUSHION as u128,
            "pot or cushion missing at register"
        );
        self.platform += self.price as u128;
        self.total_entries_in += self.price as u128;
        self.refundable += self.price as u128;
        self.entries[self.entrants].exists = true;
        self.entrants += 1;
        if self.entrants == self.shape.capacity {
            self.seal();
        }
    }

    /// The shared seal (`register::seal_pool`): refunds are now impossible,
    /// so the pool's REAL field's prices become revenue — `entrants`, never
    /// the capacity (equal when full; below it only the former is correct).
    fn seal(&mut self) {
        self.state = St::Sealed;
        self.refundable -= self.price as u128 * self.entrants as u128;
    }

    /// `seal_at_deadline` (D-E4) — past the deadline, at or above the minimum
    /// field and below capacity, the pool closes to entries. Permissionless
    /// on-chain; the model has no clock, so "past the deadline" is assumed
    /// whenever the op fires (exactly as `trigger_refund` is modelled).
    fn seal_at_deadline(&mut self) {
        if !self.opened || self.state != St::Open {
            return; // PoolNotOpen
        }
        if self.entrants < self.shape.min_seats {
            return; // FieldBelowMinimum — this pool refunds instead
        }
        if self.entrants >= self.shape.capacity {
            return; // PoolFull — unreachable while Open, mirrored anyway
        }
        self.seal();
    }

    fn flag(&mut self, i: usize, on: bool) {
        let e = &mut self.entries[i];
        if !e.exists || e.settled {
            return;
        }
        e.flagged = on;
    }

    /// `commit_results` (D3-B) — a seeded RANKING of the pool's seats (the
    /// REAL field, `entrants`: anywhere from the minimum field to the
    /// capacity) is partitioned into tie groups, each group's prize split by
    /// the SAME `split_group` the program's arithmetic module exposes, over
    /// THIS pool's table (each × size + remainder, remainder to the group's
    /// lowest seat), and the seats with a non-zero amount become the
    /// committed payout list — every seat of every group that reaches the
    /// paid places (a group may straddle the line). Conservation is
    /// therefore a THEOREM the invariant re-checks, not an assumption.
    fn commit(&mut self, seed: u64) {
        if !self.opened || self.state != St::Sealed {
            return;
        }
        let n = self.entrants;
        assert!(
            n >= self.shape.min_seats,
            "a sealed pool holds at least the minimum field"
        );
        // Seeded permutation of the seats = the ranking (rank 1 first): an
        // odd stride is coprime to any even n; for odd n fall back to a
        // stride of 1 (still a permutation — the start offset varies).
        let mut stride = 1 + (seed as usize) % (n - 1);
        if stride.is_multiple_of(2) {
            stride += 1;
        }
        if gcd(stride, n) != 1 {
            stride = 1;
        }
        let start = (seed as usize / 64) % n;
        let ranking: Vec<usize> = (0..n).map(|i| (start + i * stride) % n).collect();
        // Seeded tie-group sizes over the ranking: group size 1..=4, plus a
        // seeded chance of one giant group at the top (the everyone-tied
        // shape the oracle also pins).
        let mut sizes: Vec<usize> = Vec::new();
        let mut pos: usize = 0;
        let mut g = seed ^ 0x9e37_79b9_7f4a_7c15;
        while pos < n {
            g = g
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let size = if pos == 0 && g.is_multiple_of(11) {
                n // everyone tied
            } else {
                1 + (g as usize % 4).min(n - pos - 1)
            };
            let size = size.min(n - pos);
            sizes.push(size);
            pos += size;
        }
        self.commit_ranking(&ranking, &sizes);
    }

    /// `commit_results` with an explicit ranking and tie-group sizes (the
    /// seeded `commit` and the shaped tests both land here).
    fn commit_ranking(&mut self, ranking: &[usize], sizes: &[usize]) {
        assert_eq!(self.state, St::Sealed);
        let n = self.entrants;
        assert_eq!(ranking.len(), n);
        assert_eq!(sizes.iter().sum::<usize>(), n);
        let potv = self.pot;
        let paid_places = self.shape.paid_places();
        let first_prize = self.shape.first_prize(self.price);
        let mut payouts: Vec<(usize, u64)> = Vec::new();
        let mut pos: usize = 0; // 0-based position; rank = pos + 1
        for &size in sizes {
            let (each, remainder) =
                split_group(&self.shape.table, self.price, (pos + 1) as u16, size as u16);
            let group = &ranking[pos..pos + size];
            let lowest_seat = *group.iter().min().unwrap();
            // A group is owed something exactly when its first position is a
            // paid place — straddling the line included (D3-B under D-E19).
            let reaches_paid_line = pos < paid_places;
            for &seat in group {
                let amount = each + if seat == lowest_seat { remainder } else { 0 };
                assert!(
                    amount > 0 || (each == 0 && remainder == 0),
                    "a zero share inside a paid group"
                );
                assert_eq!(
                    each > 0,
                    reaches_paid_line,
                    "rank {} (group of {size}): paid iff the group reaches the paid places",
                    pos + 1
                );
                if amount > 0 {
                    // `commit_results`' D-E19 bounds — PayoutZero and
                    // PayoutAboveFirstPrize — asserted as THEOREMS of the
                    // published rule rather than mirrored as refusals: a
                    // list the rule makes never trips either.
                    assert!(
                        amount <= first_prize,
                        "a share of {amount} exceeds first place ({first_prize}) — the program would refuse the rule's own list"
                    );
                    payouts.push((seat, amount));
                }
            }
            pos += size;
        }
        payouts.sort_by_key(|&(seat, _)| seat);
        // The program validates Σ == pot at commit; the model asserts the
        // same so a split_group bug fails HERE, loudly.
        let total: u128 = payouts.iter().map(|&(_, a)| a as u128).sum();
        assert_eq!(total, potv as u128, "committed payouts must sum to the pot");
        // The paid set is every member of the groups reaching the paid
        // places — never empty, never past the field, never wider than the
        // payouts array.
        assert!(
            !payouts.is_empty() && payouts.len() <= n && payouts.len() <= CAP,
            "the paid set is the groups at the paid places"
        );
        self.committed = payouts;
        self.state = St::Scored;
    }

    /// `pay_prizes` on a batch of seats (D3-B). Mirrors the NET effect of
    /// the on-chain call: a seat the program would reject (not committed,
    /// already paid, already settled) is skipped and the rest land — the
    /// same state a caller reaches by dropping that seat and resending, so
    /// the invariants see every reachable state. `pay_atomic` mirrors the
    /// all-or-nothing transaction itself.
    fn pay(&mut self, seats: &[u16]) {
        if !self.opened || self.state != St::Scored {
            return;
        }
        for &seat in seats {
            let seat = seat as usize % CAP;
            let Some(&(_, amount)) = self.committed.iter().find(|&&(s, _)| s == seat) else {
                continue; // handler rejects SeatNotInPayouts
            };
            let bit = 1u64 << seat;
            if self.paid_mask & bit != 0 {
                continue; // handler rejects RankAlreadySettled
            }
            if self.entries[seat].settled {
                continue; // handler rejects EntryAlreadySettled
            }
            self.pay_one(seat, amount);
        }
        self.finish_if_all_paid();
    }

    /// `pay_prizes` as ONE transaction: every seat is checked first; any
    /// rejection reverts the whole batch (nothing moves, `false`), else all
    /// land. Prompt v2 §C.5: a wide tie is paid across several batches and
    /// a failing batch must leave the pool resumable.
    fn pay_atomic(&mut self, seats: &[u16]) -> bool {
        if !self.opened || self.state != St::Scored || seats.is_empty() {
            return false;
        }
        let mut seen: u64 = 0;
        for &seat in seats {
            let seat = seat as usize;
            if seat >= CAP || !self.committed.iter().any(|&(s, _)| s == seat) {
                return false;
            }
            let bit = 1u64 << seat;
            if self.paid_mask & bit != 0 || seen & bit != 0 || self.entries[seat].settled {
                return false;
            }
            seen |= bit;
        }
        for &seat in seats {
            let seat = seat as usize;
            let amount = self.committed.iter().find(|&&(s, _)| s == seat).unwrap().1;
            self.pay_one(seat, amount);
        }
        self.finish_if_all_paid();
        true
    }

    fn pay_one(&mut self, seat: usize, amount: u64) {
        let kyc_above = self.kyc_above;
        let escrowed = self.entries[seat].flagged || (kyc_above > 0 && amount > kyc_above);
        if escrowed {
            self.entries[seat].escrow += amount;
        } else {
            self.vault_debit(amount as u128, "pay_prizes");
            self.total_paid += amount as u128;
        }
        self.entries[seat].settled = true;
        self.paid_mask |= 1u64 << seat;
    }

    fn finish_if_all_paid(&mut self) {
        if self
            .committed
            .iter()
            .all(|&(s, _)| self.paid_mask & (1u64 << s) != 0)
        {
            self.state = St::Paid;
            // The pot is fully settled — no longer locked capacity.
            self.reserved -= self.pot as u128;
            self.pools_settled += 1;
        }
    }

    /// `release_escrow` — vault → player. The reviewed path and the
    /// seven-day auto-release move the same lamports; both are this.
    /// Refused once forfeited (`EscrowForfeitedAlready`).
    fn release(&mut self, i: usize) {
        let e = self.entries[i];
        if !e.exists || e.escrow == 0 || e.forfeited {
            return;
        }
        let amount = e.escrow as u128;
        self.vault_debit(amount, "release_escrow");
        self.total_released += amount;
        self.entries[i].escrow = 0;
    }

    /// `forfeit_escrow` (admin) — records the upheld flag. NO LAMPORTS MOVE
    /// (founder ruling 4, 2026-09-07): the share stays in the vault, on the
    /// entry, until paid onward. The ledger tallies are untouched on purpose —
    /// a forfeit that changed a balance would break an identity.
    fn forfeit(&mut self, i: usize) {
        let e = &mut self.entries[i];
        if !e.exists || e.escrow == 0 || !e.flagged || e.forfeited {
            return;
        }
        e.forfeited = true;
    }

    /// `pay_next_place` — one member's portion of a forfeited share, vault →
    /// the next eligible place (addendum ruling 3: an EQUAL split among the
    /// eligible players at the rank the share passes to; remainder to the
    /// lowest seat). Requires a Paid pool, a forfeited `from` with escrow,
    /// and an eligible `to` not yet paid from this share. The group: the
    /// eligible committed seats other than `from` when any exists (first
    /// place — `to` must be one of them); otherwise `to` is treated as a
    /// next-rank member and the signer's asserted group size is modelled as
    /// 1 (the rank proof and the completeness disclosure are the on-chain
    /// suite's business; the money is modelled here).
    ///
    /// D-E19: only in a ONE-PLACE pool. Under a multi-place table the
    /// committed list spans several ranks and this rule would pay the wrong
    /// players, so the program refuses (`NextPlaceUnsupported`) and the
    /// forfeited share stays in the vault — never paid wrongly, never to the
    /// operator — until the field-moves-up payout ships.
    fn pay_next_place(&mut self, from: usize, to: usize) {
        if !self.opened || self.state != St::Paid || from == to {
            return;
        }
        if self.shape.paid_places() > 1 {
            return; // NextPlaceUnsupported — the share is held
        }
        let f = self.entries[from];
        if !f.exists || !f.forfeited || f.escrow == 0 {
            return; // EscrowNotForfeited / NoEscrow
        }
        if !self.entries[to].eligible() {
            return; // NextPlaceIneligible / NextPlaceReviewPending
        }
        if f.split_paid & (1u64 << to) != 0 {
            return; // RankAlreadySettled — this member already took its portion
        }
        // A pending review anywhere in the first-place group blocks the split.
        let committed: Vec<usize> = self.committed.iter().map(|&(s, _)| s).collect();
        if committed
            .iter()
            .any(|&s| s != from && self.entries[s].review_pending())
        {
            return; // NextPlaceReviewPending
        }
        let group: Vec<usize> = committed
            .iter()
            .copied()
            .filter(|&s| s != from && self.entries[s].eligible())
            .collect();
        let (n, lowest) = if group.is_empty() {
            // Next rank: `to` must be outside the committed list.
            if committed.contains(&to) {
                return;
            }
            (1usize, to)
        } else {
            if !group.contains(&to) {
                return; // NextPlaceRankInvalid — a first-place member exists
            }
            (group.len(), *group.iter().min().unwrap())
        };
        // Fixed by the first payment (the model mirrors the on-chain fields).
        let total = if f.split_group == 0 {
            f.escrow
        } else {
            f.split_total
        };
        if f.split_group != 0 && f.split_group as usize != n {
            return; // NextPlaceSplitMismatch — cannot happen: eligibility is final
        }
        let per = total / n as u64;
        let rem = total % n as u64;
        let portion = per + if to == lowest { rem } else { 0 };
        assert!(portion > 0 && portion <= f.escrow, "split arithmetic");
        self.vault_debit(portion as u128, "pay_next_place");
        self.total_next_place += portion as u128;
        let fm = &mut self.entries[from];
        if fm.split_group == 0 {
            fm.split_group = n as u16;
            fm.split_total = total;
        }
        fm.split_paid |= 1u64 << to;
        fm.escrow -= portion;
        // The last member's payment empties the share exactly (on-chain the
        // program requires it; the model asserts the arithmetic delivers it).
        if fm.split_paid.count_ones() as usize == n {
            assert_eq!(fm.escrow, 0, "the split must sum to the share");
        }
        let t = &mut self.entries[to];
        t.next_place += portion;
        t.settled = true;
    }

    /// `trigger_refund` — the untouched pot returns to the treasury; the
    /// cushion stays behind, so the vault ends rent-exempt rather than reaped.
    /// D-E4: only BELOW the minimum field; at or above it the pool seals
    /// instead, so nobody can refund a playable pool out from under its
    /// entrants.
    fn trigger_refund(&mut self) {
        if !self.opened || self.state != St::Open {
            return;
        }
        if self.entrants >= self.shape.min_seats {
            return; // FieldReached — this pool seals instead
        }
        if self.entrants == 0 {
            self.state = St::Closed;
            self.pools_settled += 1;
        } else {
            self.state = St::Refunding;
        }
        assert_eq!(
            self.vault,
            self.pot as u128 + VAULT_RENT_CUSHION as u128,
            "refund-fork vault must hold exactly the untouched pot and its cushion"
        );
        if self.pot > 0 {
            self.vault_debit(self.pot as u128, "trigger_refund");
        }
        self.platform += self.pot as u128;
        self.total_pot_returns += self.pot as u128;
        self.reserved -= self.pot as u128;
    }

    /// `refund` — the full price back from the treasury. The debit carries
    /// the rent-state rule: with `min_platform` at zero the treasury can stand
    /// at exactly `refundable + dust`, and then the LAST refund would leave it
    /// rent-paying — the program refuses it, nothing moved, until a deposit
    /// lifts the balance past the band. The floor still covers the entry;
    /// only the landing waits.
    fn refund(&mut self, i: usize) {
        if !self.opened || self.state != St::Refunding {
            return;
        }
        let e = self.entries[i];
        if !e.exists || e.refunded {
            return;
        }
        assert!(
            self.platform >= self.price as u128,
            "treasury underflow at refund — the refundable floor failed"
        );
        if !self.platform_debit(self.price as u128, "refund") {
            return; // WouldStrandRentBalance — nothing moved
        }
        self.total_refunded += self.price as u128;
        self.refundable -= self.price as u128;
        self.entries[i].refunded = true;
        if self.entries.iter().all(|e| !e.exists || e.refunded) {
            self.state = St::Closed;
            self.pools_settled += 1;
        }
    }

    /// The two-wallet ledger identities, checked after EVERY operation.
    fn assert_invariant(&mut self) {
        // Every vault the run opened: the live one plus what the settled
        // ones still hold (their cushions, carried in `retired_vaults`).
        assert_eq!(
            self.vault + self.retired_vaults,
            self.total_pots_funded + self.total_cushions_funded
                - self.total_paid
                - self.total_released
                - self.total_next_place
                - self.total_pot_returns,
            "vault ledger identity broken"
        );
        assert_eq!(
            self.platform,
            self.total_deposits + self.total_entries_in + self.total_pot_returns
                - self.total_pots_funded
                - self.total_cushions_funded
                - self.total_refunded
                - self.total_withdrawn,
            "platform ledger identity broken"
        );
        // The treasury always covers every refundable entry (R7): both the
        // withdraw floor and the open-pool gate subtract `refundable`.
        assert!(
            self.platform >= self.refundable,
            "treasury cannot cover refundable entries"
        );
        // Prompt v2 PR0: once at the floor, never below it by any program
        // action. Armed by the deposit that first reaches it (the only way
        // up); `withdraw` and `open_pool` both keep `min_platform` above
        // what they take, `register` raises both sides, `refund` lowers
        // both sides by the same price.
        let floor = self.min_platform as u128 + self.refundable;
        if self.platform >= floor {
            self.floor_armed = true;
        } else {
            assert!(
                !self.floor_armed,
                "treasury fell below min_platform + refundable"
            );
        }
        // `reserved` tracks exactly the live pool's pot.
        let live = self.opened && !matches!(self.state, St::Paid | St::Closed);
        let expected_reserved = if live && self.state != St::Refunding {
            self.pot as u128
        } else {
            0
        };
        assert_eq!(
            self.reserved, expected_reserved,
            "platform_reserved drifted"
        );
        // `refundable` tracks exactly the open pool's unrefunded entries.
        let expected_refundable = match self.state {
            St::Open => self.entrants as u128 * self.price as u128,
            St::Refunding => {
                self.entries
                    .iter()
                    .filter(|e| e.exists && !e.refunded)
                    .count() as u128
                    * self.price as u128
            }
            _ => 0,
        };
        assert_eq!(
            self.refundable, expected_refundable,
            "platform_refundable drifted"
        );
        // Escrow is backed: the vault always covers every recorded claim —
        // forfeited claims included (they are still claims, on the next
        // eligible place rather than the flagged player).
        let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
        assert!(
            self.vault >= escrow_total,
            "escrow claims exceed vault balance"
        );
        // A forfeited share never lands on the forfeiter, and a forfeit is
        // never recorded without a flag.
        for e in &self.entries {
            if e.forfeited {
                assert!(e.flagged, "forfeit without a flag");
                assert_eq!(e.next_place, 0, "a forfeiter received a next-place payout");
            }
        }
        // Every balance the program would hold in a u64 fits one.
        assert!(self.vault <= u64::MAX as u128 && self.platform <= u64::MAX as u128);
        // The runtime's rent-state rule as a standing property: both PDAs end
        // every transaction empty or rent-exempt. On-chain the runtime refuses
        // the transaction that would break it; here the debit helpers fail or
        // refuse first, `fund` mirrors the credit-side refusal, and this pins
        // that nothing else sneaks a balance into the band.
        assert!(rent_ok(self.vault), "the vault is rent-paying");
        assert!(rent_ok(self.platform), "the treasury is rent-paying");
    }

    fn assert_terminal(&self) {
        if !self.opened {
            return;
        }
        let cushion = VAULT_RENT_CUSHION as u128;
        match self.state {
            St::Paid => {
                let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
                // A settled pool's vault holds exactly the outstanding escrow
                // on top of its cushion — the cushion alone once escrow
                // settles. Nothing stranded but the cushion, nothing minted.
                assert_eq!(
                    self.vault,
                    escrow_total + cushion,
                    "Paid pool strands lamports beyond its cushion"
                );
            }
            St::Closed => {
                assert_eq!(
                    self.vault, cushion,
                    "Closed pool's vault holds other than exactly its cushion"
                );
            }
            _ => {}
        }
    }

    /// Settle every outstanding escrow the way the operator would: release
    /// the unforfeited holds, then split each forfeited share among the
    /// eligible players at the rank it passes to. Returns the lamports that
    /// could NOT be paid onward, which stay in the vault as claims: in a
    /// one-place pool, a share no eligible seat exists for (every entrant
    /// flagged); in a Ladder pool, EVERY forfeited share — held until the
    /// field-moves-up payout ships (`NextPlaceUnsupported`).
    fn settle_all_escrow(&mut self) -> u128 {
        for i in 0..CAP {
            if !self.entries[i].forfeited {
                self.release(i);
            }
        }
        let mut stuck: u128 = 0;
        for from in 0..CAP {
            if !self.entries[from].forfeited || self.entries[from].escrow == 0 {
                continue;
            }
            if self.shape.paid_places() > 1 {
                // Held, and provably so: the refused call moves nothing.
                let before = (self.vault, self.entries[from].escrow);
                if let Some(to) = (0..CAP).find(|&t| t != from && self.entries[t].eligible()) {
                    self.pay_next_place(from, to);
                }
                assert_eq!(
                    (self.vault, self.entries[from].escrow),
                    before,
                    "a Ladder pool's forfeited share must stay in the vault"
                );
                stuck += self.entries[from].escrow as u128;
                continue;
            }
            // Every eligible member of the group takes its portion: the
            // eligible committed seats, else the lowest eligible seat as a
            // next-rank group of one.
            let committed: Vec<usize> = self.committed.iter().map(|&(s, _)| s).collect();
            let mut group: Vec<usize> = committed
                .iter()
                .copied()
                .filter(|&s| s != from && self.entries[s].eligible())
                .collect();
            if group.is_empty() {
                if let Some(t) = (0..CAP)
                    .find(|&t| t != from && !committed.contains(&t) && self.entries[t].eligible())
                {
                    group.push(t);
                }
            }
            if group.is_empty() {
                stuck += self.entries[from].escrow as u128;
                continue;
            }
            for to in group {
                self.pay_next_place(from, to);
            }
            assert_eq!(
                self.entries[from].escrow, 0,
                "a split leaves nothing behind"
            );
        }
        stuck
    }
}

/// `vault::rent_safe` over the ledger's width — the runtime's rule for a
/// zero-data account's post-balance: empty or rent-exempt, never between.
fn rent_ok(balance: u128) -> bool {
    let balance = u64::try_from(balance).expect("a balance the program holds fits a u64");
    rent_safe(balance, VAULT_RENT_CUSHION)
}

/// Greatest common divisor — for choosing a stride coprime to the field.
fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

/// One random operation. Indices/amounts are folded into range at execution.
#[derive(Clone, Debug)]
enum Op {
    Fund(u64),
    Withdraw(u64),
    OpenPool,
    Register,
    Flag(usize, bool),
    Commit(u64),
    Pay(Vec<u16>),
    Release(usize),
    Forfeit(usize),
    /// Ruling 4 (ii): a forfeited share to the next eligible place — paid in
    /// a one-place pool, refused (held) in a Ladder pool.
    NextPlace(usize, usize),
    TriggerRefund,
    /// D-E4: the second seal path. Weighted like `TriggerRefund` — rare
    /// enough that pools mostly fill, common enough that every fill from the
    /// minimum field to the capacity is exercised across 10k sequences.
    SealAtDeadline,
    Refund(usize),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0u64..1_000_000_000_000).prop_map(Op::Fund),
        2 => (0u64..1_000_000_000_000).prop_map(Op::Withdraw),
        3 => Just(Op::OpenPool),
        8 => Just(Op::Register),
        2 => (0usize..CAP, any::<bool>()).prop_map(|(i, b)| Op::Flag(i, b)),
        2 => any::<u64>().prop_map(Op::Commit),
        4 => proptest::collection::vec(0u16..CAPACITY, 1..=12).prop_map(Op::Pay),
        2 => (0usize..CAP).prop_map(Op::Release),
        2 => (0usize..CAP).prop_map(Op::Forfeit),
        2 => (0usize..CAP, 0usize..CAP).prop_map(|(f, t)| Op::NextPlace(f, t)),
        1 => Just(Op::TriggerRefund),
        1 => Just(Op::SealAtDeadline),
        3 => (0usize..CAP).prop_map(Op::Refund),
    ]
}

/// The money-ledger property for one shape: a random instruction sequence,
/// every invariant after every step.
fn run_ledger(shape: Shape, tier: usize, kyc_on: bool, min_platform: u64, ops: Vec<Op>) {
    let price = TIER_ENTRY_LAMPORTS[tier];
    // When the KYC switch is on, put the threshold where it splits the paid
    // set (`Shape::kyc_split`): first place escrows, the lower places pay
    // direct, and tie groups land on either side.
    let kyc_above = if kyc_on { shape.kyc_split(price) } else { 0 };
    let mut m = Model::new(shape, price, min_platform, kyc_above);
    for op in ops {
        match op {
            Op::Fund(a) => m.fund(a),
            Op::Withdraw(a) => m.withdraw(a),
            Op::OpenPool => m.open_pool(),
            Op::Register => m.register(),
            Op::Flag(i, b) => m.flag(i % CAP, b),
            Op::Commit(seed) => m.commit(seed),
            Op::Pay(seats) => m.pay(&seats),
            Op::Release(i) => m.release(i % CAP),
            Op::Forfeit(i) => m.forfeit(i % CAP),
            Op::NextPlace(f, t) => m.pay_next_place(f % CAP, t % CAP),
            Op::TriggerRefund => m.trigger_refund(),
            Op::SealAtDeadline => m.seal_at_deadline(),
            Op::Refund(i) => m.refund(i % CAP),
        }
        m.assert_invariant();
        m.assert_terminal();
    }
}

/// Every pool shape a property runs over: the four Ladder capacities and the
/// one-place legacy shape.
fn any_shape() -> impl Strategy<Value = Shape> {
    (0usize..N_SHAPES).prop_map(Shape::nth)
}

// Roadmap 1.7: "Fuzz runs 10k sequences clean in CI" — since D-E19, 10k per
// pool size, each its own test so a failure names the capacity, plus the
// one-place shape pre-Ladder pools are migrated to.
proptest! {
    #![proptest_config(ProptestConfig { cases: 10_000, .. ProptestConfig::default() })]

    #[test]
    fn money_ledger_holds_at_capacity_8(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        run_ledger(Shape::ladder(0), tier, kyc_on, min_platform, ops);
    }

    #[test]
    fn money_ledger_holds_at_capacity_16(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        run_ledger(Shape::ladder(1), tier, kyc_on, min_platform, ops);
    }

    #[test]
    fn money_ledger_holds_at_capacity_32(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        run_ledger(Shape::ladder(2), tier, kyc_on, min_platform, ops);
    }

    #[test]
    fn money_ledger_holds_at_capacity_64(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        run_ledger(Shape::ladder(3), tier, kyc_on, min_platform, ops);
    }

    /// The one-place shape every pre-Ladder pool is migrated to — the only
    /// shape in which `pay_next_place` still moves money.
    #[test]
    fn money_ledger_holds_for_a_migrated_one_place_pool(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        run_ledger(Shape::legacy(), tier, kyc_on, min_platform, ops);
    }
}

proptest! {
    // The shaped properties below are each exhaustive over their own small
    // space; proptest's default case count covers every (shape, tier) pair
    // many times over.

    /// The launch shapes are the published rule (D-E19): the top quarter
    /// paid, the prize pool five-eighths of a full field's entries, and the
    /// minimum field EXACTLY break-even — at every tier. The legacy shape is
    /// the winner-takes-all pool it records: one place, 40 entries' worth.
    #[test]
    fn every_shape_is_the_published_rule(shape in any_shape(), tier in 0usize..TIER_ENTRY_LAMPORTS.len()) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price) as u128;
        prop_assert_eq!(pot, shape.min_seats as u128 * price as u128, "the minimum field is break-even");
        if shape == Shape::legacy() {
            prop_assert_eq!(shape.paid_places(), 1);
            prop_assert_eq!(shape.first_prize(price) as u128, pot, "one place takes the whole prize pool");
        } else {
            prop_assert_eq!(shape.paid_places(), shape.capacity / 4, "the top quarter is paid");
            prop_assert_eq!(pot * 8, shape.capacity as u128 * 5 * price as u128, "5/8 of a full field");
            prop_assert!(shape.table.windows(2).all(|w| w[1] <= w[0]), "never increasing");
        }
        prop_assert!(shape.min_seats > shape.paid_places() && shape.min_seats <= shape.capacity);
    }

    /// The happy path, exhaustively: bootstrap the treasury, open (pot and
    /// cushion fund BEFORE any entry), fill to the pool's capacity, commit,
    /// pay all committed seats, settle all escrow (release the even holds,
    /// forfeit the odd ones and pay each forfeited share onward where the
    /// shape allows it) — the vault must end at EXACTLY its cushion plus the
    /// claims nobody could be paid yet, for every shape, tier and flag
    /// pattern, and the treasury must hold the bootstrap + the field's entry
    /// payments − the pool's funding (pot and cushion). No forfeit term:
    /// forfeited money never reaches the treasury (ruling 4).
    #[test]
    fn full_lifecycle_drains_the_vault_to_the_cushion(
        shape in any_shape(),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        seed in any::<u64>(),
        flagged_bits in any::<u16>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let cushion = VAULT_RENT_CUSHION as u128;
        let mut m = Model::new(shape, price, 0, 0);
        // Policy at open (single type, excluded as the one being opened):
        // needs pot + cushion + min(0) + 0 available.
        m.fund(pot + VAULT_RENT_CUSHION);
        m.open_pool();
        prop_assert_eq!(m.state, St::Open);
        prop_assert_eq!(m.vault, pot as u128 + cushion); // funded before any entry
        for _ in 0..CAP { m.register(); } // the extras past capacity are refused
        prop_assert_eq!(m.entrants, shape.capacity, "seals at its own capacity");
        prop_assert_eq!(m.state, St::Sealed);
        prop_assert_eq!(m.refundable, 0u128); // revenue at seal
        m.commit(seed);
        // Flag paid seats according to the bit pattern.
        let paid_seats: Vec<usize> = m.committed.iter().map(|&(s, _)| s).collect();
        prop_assert!(paid_seats.len() >= shape.paid_places(), "every paid place is owed to someone");
        for (i, &seat) in paid_seats.iter().enumerate() {
            if flagged_bits & (1 << (i % 16)) != 0 { m.flag(seat, true); }
        }
        m.pay(&paid_seats.iter().map(|&s| s as u16).collect::<Vec<_>>());
        m.assert_invariant();
        prop_assert_eq!(m.state, St::Paid);
        prop_assert_eq!(m.reserved, 0u128);
        // Forfeit the odd flagged seats (forfeit requires the flag; the
        // rest release), then settle everything.
        for (i, &seat) in paid_seats.iter().enumerate() {
            if i % 2 == 1 { m.forfeit(seat); }
            m.assert_invariant();
        }
        let forfeited: u128 = m.entries.iter().filter(|e| e.forfeited).map(|e| e.escrow as u128).sum();
        let vault_before = m.vault;
        let stuck = m.settle_all_escrow();
        m.assert_invariant();
        prop_assert_eq!(m.vault, stuck + cushion,
            "vault must end at exactly its cushion plus the claims not yet payable");
        if shape.paid_places() > 1 {
            // D-E19: a Ladder pool HOLDS every forfeited share.
            prop_assert_eq!(stuck, forfeited, "a Ladder pool's forfeited shares are held whole");
        } else if stuck > 0 {
            // One place: a forfeited share is stuck only when NO eligible
            // seat exists — every seat flagged, which needs an everyone-tied
            // commit with every bit set.
            prop_assert!(m.entries.iter().all(|e| !e.exists || e.flagged));
        }
        prop_assert!(m.vault <= vault_before);
        // Treasury conservation across the pool: bootstrap + entries − the
        // pool's funding (pot and cushion, both out at open; only the pot is
        // ever paid onward). Forfeits contribute NOTHING (ruling 4).
        let expected = (pot + VAULT_RENT_CUSHION) as u128 + shape.capacity as u128 * price as u128
            - m.total_pots_funded
            - m.total_cushions_funded;
        prop_assert_eq!(m.platform, expected, "treasury drifted over the lifecycle");
        prop_assert_eq!(m.platform, shape.capacity as u128 * price as u128,
            "the treasury keeps exactly the field's entries");
        prop_assert_eq!(m.total_paid + m.total_released + m.total_next_place + stuck, pot as u128,
            "the pot reached players (or stayed as their claims), never the operator");
    }

    /// The refund fork, exhaustively: any fill BELOW the pool's minimum
    /// field, trigger (pot returns whole), refund all — the vault ends at
    /// exactly its cushion, every entrant is repaid exactly their price, and
    /// the treasury ends where it started less the one cushion that stays in
    /// the vault. A seal attempt on such a pool is a no-op: the fork is
    /// decided by the field, and the two instructions reject each other's
    /// case.
    #[test]
    fn refund_fork_returns_every_lamport(
        (shape, fill) in any_shape().prop_flat_map(|s| (Just(s), 0usize..s.min_seats)),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + VAULT_RENT_CUSHION);
        m.open_pool();
        for _ in 0..fill { m.register(); }
        m.seal_at_deadline(); // FieldBelowMinimum — must not seal
        prop_assert_eq!(m.state, St::Open, "a short field must not seal");
        m.trigger_refund();
        for i in 0..fill {
            m.refund(i);
            m.assert_invariant();
        }
        prop_assert_eq!(m.state, St::Closed);
        prop_assert_eq!(m.vault, VAULT_RENT_CUSHION as u128,
            "refunded pool's vault must hold exactly its cushion");
        prop_assert_eq!(m.refundable, 0u128, "refundable not fully released");
        prop_assert_eq!(m.total_refunded, fill as u128 * price as u128,
            "R7: every entrant repaid exactly the price");
        // Pot out, pot back; the cushion stays in the vault: the treasury
        // holds the bootstrap less exactly one cushion.
        prop_assert_eq!(m.platform, pot as u128, "treasury drifted over the refund fork");
    }

    /// The minimum-field path, exhaustively: any fill from the pool's
    /// minimum field up to (not including) its capacity, the deadline
    /// passes, the pool SEALS (a refund attempt is refused), the paid places
    /// are paid the whole prize pool, the vault ends at exactly its cushion,
    /// and the treasury keeps the field's entries — never less than the
    /// prize pool, and EXACTLY it at the minimum field: the break-even
    /// property every launch table is built on, exercised rather than
    /// asserted.
    #[test]
    fn min_field_seals_and_pays_the_paid_places(
        (shape, fill) in any_shape().prop_flat_map(|s| (Just(s), s.min_seats..s.capacity)),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        seed in any::<u64>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + VAULT_RENT_CUSHION);
        m.open_pool();
        for _ in 0..fill { m.register(); }
        prop_assert_eq!(m.state, St::Open, "below capacity the pool is still Open");
        prop_assert_eq!(m.refundable, fill as u128 * price as u128);
        m.trigger_refund(); // FieldReached — must not refund
        prop_assert_eq!(m.state, St::Open, "a playable field must not refund");
        m.seal_at_deadline();
        prop_assert_eq!(m.state, St::Sealed);
        prop_assert_eq!(m.refundable, 0u128, "the field's entries became revenue at seal");
        m.assert_invariant();
        m.commit(seed);
        let paid_seats: Vec<u16> = m.committed.iter().map(|&(s, _)| s as u16).collect();
        prop_assert!(paid_seats.len() >= shape.paid_places());
        prop_assert!(paid_seats.iter().all(|&s| (s as usize) < fill), "only real seats are paid");
        m.pay(&paid_seats);
        m.assert_invariant();
        prop_assert_eq!(m.state, St::Paid);
        prop_assert_eq!(m.vault, VAULT_RENT_CUSHION as u128,
            "the whole pot left the vault; the cushion stays");
        prop_assert_eq!(m.total_paid, pot as u128, "the paid places received exactly the pot");
        // The bootstrap (pot and cushion) left the treasury at open, so what
        // remains is the field's entries — which cover the prize pool the
        // treasury funded at every field in range, exactly at the floor.
        prop_assert_eq!(m.platform, fill as u128 * price as u128, "treasury holds the field's entries");
        prop_assert!(m.platform >= pot as u128, "the field covers the pot the treasury funded");
        if fill == shape.min_seats {
            prop_assert_eq!(m.platform, pot as u128, "at the floor, exactly break-even");
        }
    }

    /// Prompt v2 §C.5 — the widest tie a minimum field can produce, paid in
    /// batches as ONE transaction each: a tie for first across the whole
    /// floor at every shape and tier (5-, 10-, 20- and 40-way), in batches,
    /// with one batch that FAILS (it repeats an already-paid seat) and
    /// reverts whole — nothing moves, the pool stays Scored — then resumes.
    /// The floor covers every paid place, so the group shares the WHOLE
    /// prize pool; it is conserved to the lamport, the indivisible remainder
    /// sits on the lowest seat, and the vault ends at exactly its cushion.
    #[test]
    fn a_floor_wide_tie_settles_across_batches_and_survives_a_failed_batch(
        shape in any_shape(),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        bad_batch_seed in any::<usize>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let min = shape.min_seats;
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + VAULT_RENT_CUSHION);
        m.open_pool();
        for _ in 0..min { m.register(); }
        m.seal_at_deadline();
        prop_assert_eq!(m.state, St::Sealed);
        // Everyone tied for first, in seat order.
        let ranking: Vec<usize> = (0..min).collect();
        m.commit_ranking(&ranking, &[min]);
        prop_assert_eq!(m.committed.len(), min, "every seat is paid in a floor-wide tie");
        let each = pot / min as u64;
        let rem = pot % min as u64;
        prop_assert_eq!(m.committed[0].1, each + rem, "remainder to the lowest seat");
        prop_assert!(m.committed[1..].iter().all(|&(_, a)| a == each));

        // Batches of at most twelve, at least two batches at every shape —
        // derived from the floor, never a second copy of it.
        let batch = 12.min(min.div_ceil(2));
        let batches: Vec<Vec<u16>> = (0..min as u16)
            .collect::<Vec<_>>()
            .chunks(batch)
            .map(|c| c.to_vec())
            .collect();
        prop_assert!(batches.len() >= 2);
        let bad_batch = 1 + bad_batch_seed % (batches.len() - 1);
        let mut paid_so_far: u128 = 0;
        for (i, batch) in batches.iter().enumerate() {
            if i == bad_batch {
                // Resend a seat from the previous batch alongside this one:
                // the program rejects the whole transaction.
                let mut bad = batch.clone();
                bad.push(batches[i - 1][0]);
                let vault_before = m.vault;
                let mask_before = m.paid_mask;
                prop_assert!(!m.pay_atomic(&bad), "a batch with a paid seat must fail");
                prop_assert_eq!(m.vault, vault_before, "a failed batch moved lamports");
                prop_assert_eq!(m.paid_mask, mask_before, "a failed batch marked a seat");
                prop_assert_eq!(m.state, St::Scored, "a failed batch changed state");
                m.assert_invariant();
            }
            prop_assert!(m.pay_atomic(batch), "resume with the clean batch");
            paid_so_far += batch.iter().map(|&s| m.committed.iter().find(|&&(c, _)| c == s as usize).unwrap().1 as u128).sum::<u128>();
            prop_assert_eq!(m.total_paid, paid_so_far);
            m.assert_invariant();
        }
        prop_assert_eq!(m.state, St::Paid);
        prop_assert_eq!(m.vault, VAULT_RENT_CUSHION as u128,
            "the vault holds exactly its cushion after the last batch");
        prop_assert_eq!(m.total_paid, pot as u128, "the shares sum to the pot exactly");
    }

    /// `withdraw_platform`'s floor: a withdrawal that would dip below
    /// min + idle reserve + refundable is refused with NOTHING moved, and one
    /// exactly at the floor succeeds. The idle reserve counts a pool type's
    /// whole funding — its prize pool plus the vault's rent cushion —
    /// because a reserved pot is an openable pot (treasury.rs, 2026-09-12).
    #[test]
    fn withdraw_floor_is_exact(
        shape in any_shape(),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        min_platform in 0u64..10_000_000_000,
        surplus in 0u64..10_000_000_000,
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let mut m = Model::new(shape, price, min_platform, 0);
        // No live pool → idle reserve = one pot + one cushion (reserve_pots = 1).
        let floor = min_platform as u128 + pot as u128 + VAULT_RENT_CUSHION as u128;
        m.fund(pot + VAULT_RENT_CUSHION + min_platform + surplus);
        prop_assert_eq!(m.platform, floor + surplus as u128);
        // One lamport over the withdrawable surplus must be refused.
        m.withdraw(surplus + 1);
        prop_assert_eq!(m.platform, floor + surplus as u128, "below-floor withdraw moved money");
        // Exactly the surplus clears.
        m.withdraw(surplus);
        prop_assert_eq!(m.platform, floor, "at-floor withdraw refused");
        m.assert_invariant();
    }

    /// Ruling 4 as a property: over any sequence, the lamports that leave a
    /// vault go to players (paid, released, paid onward) or back to the
    /// treasury ONLY as an untouched pot on the refund fork — never as a
    /// forfeit. In a one-place pool a forfeited share is paid onward; in a
    /// Ladder pool it is held (D-E19); in neither does it reach the treasury.
    #[test]
    fn forfeited_money_never_reaches_the_treasury(
        shape in any_shape(),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        seed in any::<u64>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let cushion = VAULT_RENT_CUSHION as u128;
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + VAULT_RENT_CUSHION);
        m.open_pool();
        for _ in 0..shape.capacity { m.register(); }
        m.commit(seed);
        // Flag and forfeit EVERY committed seat.
        let paid_seats: Vec<usize> = m.committed.iter().map(|&(s, _)| s).collect();
        for &s in &paid_seats { m.flag(s, true); }
        m.pay(&paid_seats.iter().map(|&s| s as u16).collect::<Vec<_>>());
        for &s in &paid_seats { m.forfeit(s); }
        let treasury_before = m.platform;
        let vault_before = m.vault;
        prop_assert_eq!(vault_before, pot as u128 + cushion, "every share is held, on top of the cushion");
        // A forfeit moved nothing.
        m.assert_invariant();
        prop_assert_eq!(m.platform, treasury_before);
        // Releasing a forfeited share is refused.
        for &s in &paid_seats { m.release(s); }
        prop_assert_eq!(m.vault, vault_before, "a forfeited share cannot be released");
        // Next-place payout pays the next eligible seat(s) in a one-place
        // pool and is refused in a Ladder pool; the treasury is untouched
        // throughout, and the vault ends at its cushion plus what is held.
        let stuck = m.settle_all_escrow();
        m.assert_invariant();
        prop_assert_eq!(m.platform, treasury_before, "a forfeit reached the treasury");
        prop_assert_eq!(m.vault, stuck + cushion);
        prop_assert_eq!(m.total_next_place + stuck, pot as u128);
        if shape.paid_places() > 1 {
            prop_assert_eq!(stuck, pot as u128, "a Ladder pool holds every forfeited share");
            prop_assert_eq!(m.total_next_place, 0u128);
        }
        prop_assert!(m.entries.iter().all(|e| !e.forfeited || e.next_place == 0));
    }

    /// The treasury's own rent band (`vault::platform_debit`, 2026-09-12):
    /// with `min_platform` at zero the floor can let the treasury run down to
    /// dust, and a debit that would leave `0 < balance < cushion` is refused
    /// with NOTHING moved — the open, the withdrawal and the last refund
    /// alike — until a deposit lifts the balance past the band; a debit to
    /// exactly zero, or to the cushion or more, lands. The vault never meets
    /// this band (its cushion is the guarantee, asserted in `vault_debit`);
    /// the treasury can, and the program's answer is to refuse, so the
    /// model's is too. Note the last-refund case: R7's sum is program-held
    /// by the floor, but the LANDING of the final refund can wait on a
    /// permissionless top-up when the operator runs the treasury at zero
    /// minimum — a liveness wrinkle, not a loss.
    #[test]
    fn treasury_debits_refuse_the_rent_paying_band(
        shape in any_shape(),
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        dust in 1u64..VAULT_RENT_CUSHION,
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = shape.pot(price);
        let cushion = VAULT_RENT_CUSHION;

        // (1) An open whose funding debit would leave dust: the policy gate
        // passes (min 0, this type excluded from the idle reserve), the
        // debit refuses, nothing moves.
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + cushion + dust);
        m.open_pool();
        prop_assert!(!m.opened, "an open that would leave the treasury rent-paying is refused");
        prop_assert_eq!(m.platform, (pot + cushion + dust) as u128, "nothing moved");
        prop_assert_eq!(m.reserved, 0u128);
        m.assert_invariant();
        // A top-up past the band and the same open lands, leaving exactly
        // one cushion behind in the treasury.
        m.fund(cushion - dust);
        m.open_pool();
        prop_assert_eq!(m.state, St::Open);
        prop_assert_eq!(m.vault, (pot + cushion) as u128);
        prop_assert_eq!(m.platform, cushion as u128);
        m.assert_invariant();

        // (2) A withdrawal: a Sealed pool has no refundable entries and no
        // idle reserve, so the floor is zero — to dust is refused, to exactly
        // the cushion lands, and to exactly zero lands (the account reaps).
        for _ in 0..shape.capacity { m.register(); }
        prop_assert_eq!(m.state, St::Sealed);
        let balance = m.platform;
        m.withdraw(balance as u64 - dust);
        prop_assert_eq!(m.platform, balance, "a withdrawal leaving dust is refused, nothing moved");
        m.withdraw(balance as u64 - cushion);
        prop_assert_eq!(m.platform, cushion as u128, "a withdrawal to exactly the cushion lands");
        m.withdraw(cushion);
        prop_assert_eq!(m.platform, 0u128, "a withdrawal to exactly zero lands");
        m.assert_invariant();

        // (3) The last refund: a Refunding pool whose treasury holds the last
        // entry's price plus dust — the refund is refused and the entrant
        // waits on a deposit; the refundable sum itself is still covered.
        let mut m = Model::new(shape, price, 0, 0);
        m.fund(pot + cushion);
        m.open_pool();
        m.register();
        m.trigger_refund();
        prop_assert_eq!(m.state, St::Refunding);
        prop_assert_eq!(m.platform, (price + pot) as u128);
        m.withdraw(pot - dust); // floor = refundable = price; leaves price + dust
        prop_assert_eq!(m.platform, (price + dust) as u128);
        m.refund(0);
        prop_assert!(!m.entries[0].refunded, "the last refund would leave dust: refused");
        prop_assert_eq!(m.platform, (price + dust) as u128, "nothing moved");
        prop_assert_eq!(m.refundable, price as u128, "the entry is still covered");
        prop_assert_eq!(m.state, St::Refunding);
        m.assert_invariant();
        // Anyone's deposit past the band unblocks it (`fund_platform_wallet`
        // is permissionless).
        m.fund(cushion - dust);
        m.refund(0);
        prop_assert!(m.entries[0].refunded, "the refund lands once the band is cleared");
        prop_assert_eq!(m.state, St::Closed);
        prop_assert_eq!(m.platform, cushion as u128);
        prop_assert_eq!(m.vault, cushion as u128, "the refunded pool's vault keeps its cushion");
        m.assert_invariant();
        m.assert_terminal();
    }
}
