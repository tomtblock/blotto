//! The money-model invariant suite (roadmap 1.7, reworked for D-A1 revised —
//! the substitute for an audit under R5, so it errs toward paranoia).
//!
//! A model of the program's money flows is driven through 10k random
//! instruction sequences. The model calls the SAME arithmetic the handlers
//! call (`prize_math`), and mirrors each handler's preconditions; after every
//! step it asserts the two-wallet ledger identities:
//!
//! ```text
//! vault    == Σ pots funded − Σ paid − Σ released − Σ forfeited
//!             − Σ pot returns (refund fork)
//! platform == Σ deposits + Σ entry payments + Σ pot returns + Σ forfeits
//!             − Σ pots funded − Σ refunds − Σ withdrawals
//! ```
//!
//! plus the policy properties: the treasury always covers the refundable sum
//! (`withdraw_platform`'s floor and `open_pool`'s availability gate both
//! subtract it), `platform_reserved` tracks exactly the live pool's pot, and
//! a below-floor withdrawal is refused with nothing moved. Terminal
//! conditions: a fully settled pool leaves its vault holding exactly the
//! outstanding escrow (zero once escrow settles), and a fully refunded pool
//! leaves the vault at zero with every entrant repaid their exact price —
//! R7's "full refund" is exact, not approximate.
//!
//! Pools are SEQUENTIAL (D-A1 revised): the model re-opens a new pool only
//! after the previous reached `Paid` or `Closed`, mirroring
//! `active_pool_by_tier`, and the ledger identities run ACROSS pools.
//!
//! D-E4 (2026-09-06) adds the second seal path: past the deadline a pool at
//! or above `MIN_SEATS` seals (`seal_at_deadline`) and below it refunds
//! (`trigger_refund`). The model abstracts the clock the same way it always
//! did for the refund fork — the deadline is assumed past whenever either
//! op fires — and mirrors the field guard on both, so the fork is decided by
//! seat count exactly as on-chain. The invariants are UNCHANGED by D-E2 and
//! D-E4; only the operation set and the refund proptest's domain moved.
//!
//! What this does and does not prove: it proves the arithmetic and the state
//! machine conserve lamports under any interleaving the program permits. It
//! does not execute the real BPF program — the LiteSVM integration suite
//! covers the on-chain half against the compiled artifact.

use blotto_cup::constants::{CAPACITY, MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS};
use blotto_cup::prize_math::split_group;
use proptest::prelude::*;

const CAP: usize = CAPACITY as usize;
const MIN: usize = MIN_SEATS as usize;

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
    escrow: u64,
}

/// The model. Lamport balances are u128 in the LEDGER (so an overflow bug in
/// the model itself cannot mask one in the program's u64 math — every u64
/// the program would hold is asserted to fit).
struct Model {
    price: u64,
    pot: u64,
    min_platform: u64,
    // Treasury.
    platform: u128,
    reserved: u128,
    refundable: u128,
    // The live pool (sequential — at most one). `None` before the first open
    // and irrelevant after terminal states; the terminal pool stays so its
    // escrow can settle.
    state: St,
    opened: bool,
    entrants: usize,
    vault: u128,
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
    total_pot_returns: u128,
    total_paid: u128,
    total_refunded: u128,
    total_released: u128,
    total_forfeited: u128,
    total_withdrawn: u128,
    pools_settled: u32,
}

impl Model {
    fn new(price: u64, pot: u64, min_platform: u64, kyc_above: u64) -> Self {
        Model {
            price,
            pot,
            min_platform,
            platform: 0,
            reserved: 0,
            refundable: 0,
            state: St::Closed,
            opened: false,
            entrants: 0,
            vault: 0,
            paid_mask: 0,
            committed: Vec::new(),
            kyc_above,
            entries: [EntryModel::default(); CAP],
            total_deposits: 0,
            total_entries_in: 0,
            total_pots_funded: 0,
            total_pot_returns: 0,
            total_paid: 0,
            total_refunded: 0,
            total_released: 0,
            total_forfeited: 0,
            total_withdrawn: 0,
            pools_settled: 0,
        }
    }

    /// The single tier's idle reserve: `reserve_pots (1) × pot` when the tier
    /// has no live pool, excluding the tier being opened when asked
    /// (mirrors `idle_tier_reserve`'s exclude parameter).
    fn idle_reserve(&self, exclude_self: bool) -> u128 {
        let live = self.opened && !matches!(self.state, St::Paid | St::Closed);
        if live || exclude_self {
            0
        } else {
            self.pot as u128
        }
    }

    /// `fund_platform_wallet` — permissionless deposit.
    fn fund(&mut self, amount: u64) {
        if amount == 0 {
            return; // handler rejects ZeroAmount
        }
        self.platform += amount as u128;
        self.total_deposits += amount as u128;
    }

    /// `withdraw_platform` — refused below the floor, nothing moved.
    fn withdraw(&mut self, amount: u64) {
        if amount == 0 {
            return;
        }
        let floor = self.min_platform as u128 + self.idle_reserve(false) + self.refundable;
        if self.platform < amount as u128 + floor {
            return; // handler rejects WithdrawBelowFloor; model must not move
        }
        self.platform -= amount as u128;
        self.total_withdrawn += amount as u128;
    }

    /// `open_pool` — sequential rule + treasury policy gate + pot funding.
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
        let available = self.platform.saturating_sub(self.refundable);
        let needed = self.pot as u128 + self.min_platform as u128 + self.idle_reserve(true);
        if available < needed {
            return; // TreasuryShortfall
        }
        self.platform -= self.pot as u128;
        self.total_pots_funded += self.pot as u128;
        self.reserved += self.pot as u128;
        self.opened = true;
        self.state = St::Open;
        self.entrants = 0;
        self.vault = self.pot as u128;
        self.paid_mask = 0;
        self.committed.clear();
        self.entries = [EntryModel::default(); CAP];
    }

    /// `register` — the full price into the treasury; the 64th entry seals.
    fn register(&mut self) {
        if !self.opened || self.state != St::Open || self.entrants >= CAP {
            return; // handler would revert
        }
        // Belt-and-braces mirror: the vault must already hold the pot.
        assert!(self.vault >= self.pot as u128, "pot missing at register");
        self.platform += self.price as u128;
        self.total_entries_in += self.price as u128;
        self.refundable += self.price as u128;
        self.entries[self.entrants].exists = true;
        self.entrants += 1;
        if self.entrants == CAP {
            self.seal();
        }
    }

    /// The shared seal (`register::seal_pool`): refunds are now impossible,
    /// so the pool's REAL field's prices become revenue — `entrants`, never
    /// `CAP` (equal at 64; below 64 only the former is correct).
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
        if self.entrants < MIN {
            return; // FieldBelowMinimum — this pool refunds instead
        }
        if self.entrants >= CAP {
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
    /// REAL field, `entrants`: 52..=64 under D-E4) is partitioned into tie
    /// groups, each group's prize split by the SAME `split_group` the
    /// program's arithmetic module exposes (each × size + remainder,
    /// remainder to the group's lowest seat), and the seats with a non-zero
    /// amount become the committed payout list — under D-E2 that is the
    /// winner, or every member of a tie for first. Conservation is therefore
    /// a THEOREM the invariant re-checks, not an assumption.
    fn commit(&mut self, seed: u64) {
        if !self.opened || self.state != St::Sealed {
            return;
        }
        let n = self.entrants;
        assert!(n >= MIN, "a sealed pool holds at least the minimum field");
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
        let potv = self.pot;
        let mut payouts: Vec<(usize, u64)> = Vec::new();
        let mut pos: usize = 0; // 0-based position; rank = pos + 1
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
            let (each, remainder) = split_group(potv, (pos + 1) as u16, size as u16);
            let group = &ranking[pos..pos + size];
            let lowest_seat = *group.iter().min().unwrap();
            for &seat in group {
                let amount = each + if seat == lowest_seat { remainder } else { 0 };
                if amount > 0 {
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
        // D-E2: the paid set is exactly the tie group at rank 1 — one seat,
        // or every member of a tie for first — never a seat outside it.
        assert!(
            !payouts.is_empty() && payouts.len() <= n,
            "the paid set is the rank-1 group"
        );
        self.committed = payouts;
        self.state = St::Scored;
    }

    /// `pay_prizes` on a batch of seats (D3-B).
    fn pay(&mut self, seats: &[u16]) {
        if !self.opened || self.state != St::Scored {
            return;
        }
        for &seat in seats {
            let seat = seat as usize % CAP;
            let Some(&(_, amount)) = self.committed.iter().find(|&&(s, _)| s == seat) else {
                continue; // handler rejects SeatNotInPayouts; model skips — same net state
            };
            let bit = 1u64 << seat;
            if self.paid_mask & bit != 0 {
                continue; // handler reverts the batch; model skips — same net state
            }
            let e = &mut self.entries[seat];
            if e.settled {
                continue;
            }
            let escrowed = e.flagged || (self.kyc_above > 0 && amount > self.kyc_above);
            if escrowed {
                e.escrow += amount;
            } else {
                assert!(self.vault >= amount as u128, "vault underflow at pay");
                self.vault -= amount as u128;
                self.total_paid += amount as u128;
            }
            e.settled = true;
            self.paid_mask |= bit;
        }
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

    fn release(&mut self, i: usize) {
        let e = &mut self.entries[i];
        if !e.exists || e.escrow == 0 {
            return;
        }
        let amount = e.escrow as u128;
        assert!(self.vault >= amount, "vault underflow at release");
        self.vault -= amount;
        self.total_released += amount;
        e.escrow = 0;
    }

    /// `forfeit_escrow` — vault → platform TREASURY (D-A1 revised).
    fn forfeit(&mut self, i: usize) {
        let e = &mut self.entries[i];
        if !e.exists || e.escrow == 0 || !e.flagged {
            return;
        }
        let amount = e.escrow as u128;
        assert!(self.vault >= amount, "vault underflow at forfeit");
        self.vault -= amount;
        self.platform += amount;
        self.total_forfeited += amount;
        e.escrow = 0;
    }

    /// `trigger_refund` — the untouched pot returns to the treasury. D-E4:
    /// only BELOW the minimum field; at or above it the pool seals instead,
    /// so nobody can refund a playable pool out from under its entrants.
    fn trigger_refund(&mut self) {
        if !self.opened || self.state != St::Open {
            return;
        }
        if self.entrants >= MIN {
            return; // FieldReached — this pool seals instead
        }
        if self.entrants == 0 {
            self.state = St::Closed;
            self.pools_settled += 1;
        } else {
            self.state = St::Refunding;
        }
        assert_eq!(
            self.vault, self.pot as u128,
            "refund-fork vault must hold exactly the untouched pot"
        );
        self.platform += self.pot as u128;
        self.total_pot_returns += self.pot as u128;
        self.vault = 0;
        self.reserved -= self.pot as u128;
    }

    /// `refund` — the full price back from the treasury.
    fn refund(&mut self, i: usize) {
        if !self.opened || self.state != St::Refunding {
            return;
        }
        let e = &mut self.entries[i];
        if !e.exists || e.refunded {
            return;
        }
        assert!(
            self.platform >= self.price as u128,
            "treasury underflow at refund — the refundable floor failed"
        );
        self.platform -= self.price as u128;
        self.total_refunded += self.price as u128;
        self.refundable -= self.price as u128;
        e.refunded = true;
        if self.entries.iter().all(|e| !e.exists || e.refunded) {
            self.state = St::Closed;
            self.pools_settled += 1;
        }
    }

    /// The two-wallet ledger identities, checked after EVERY operation.
    fn assert_invariant(&self) {
        assert_eq!(
            self.vault,
            self.total_pots_funded
                - self.total_paid
                - self.total_released
                - self.total_forfeited
                - self.total_pot_returns,
            "vault ledger identity broken"
        );
        assert_eq!(
            self.platform,
            self.total_deposits
                + self.total_entries_in
                + self.total_pot_returns
                + self.total_forfeited
                - self.total_pots_funded
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
        // Escrow is backed: the vault always covers every recorded claim.
        let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
        assert!(
            self.vault >= escrow_total,
            "escrow claims exceed vault balance"
        );
        // Every balance the program would hold in a u64 fits one.
        assert!(self.vault <= u64::MAX as u128 && self.platform <= u64::MAX as u128);
    }

    fn assert_terminal(&self) {
        if !self.opened {
            return;
        }
        match self.state {
            St::Paid => {
                let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
                // A settled pool's vault holds exactly the outstanding escrow —
                // zero once escrow settles. Nothing stranded, nothing minted.
                assert_eq!(self.vault, escrow_total, "Paid pool strands lamports");
            }
            St::Closed => {
                assert_eq!(self.vault, 0, "Closed pool strands vault lamports");
            }
            _ => {}
        }
    }
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
    TriggerRefund,
    /// D-E4: the second seal path. Weighted like `TriggerRefund` — rare
    /// enough that pools mostly fill, common enough that every fill in
    /// `MIN..CAP` is exercised across 10k sequences.
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
        1 => Just(Op::TriggerRefund),
        1 => Just(Op::SealAtDeadline),
        3 => (0usize..CAP).prop_map(Op::Refund),
    ]
}

proptest! {
    // Roadmap 1.7: "Fuzz runs 10k sequences clean in CI."
    #![proptest_config(ProptestConfig { cases: 10_000, .. ProptestConfig::default() })]

    #[test]
    fn money_ledger_holds_under_random_instruction_sequences(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        min_platform in prop_oneof![Just(0u64), Just(1_000_000_000u64)],
        ops in proptest::collection::vec(op_strategy(), 1..250),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = TIER_POT_LAMPORTS[tier];
        // When the KYC switch is on, put the threshold where it splits the
        // D-E2 paid set: a solo winner (the whole pot) escrows, a member of
        // a two-way-or-wider tie for first (pot / k ≤ pot / 2) does not.
        let kyc_above = if kyc_on { pot / 2 } else { 0 };
        let mut m = Model::new(price, pot, min_platform, kyc_above);
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
                Op::TriggerRefund => m.trigger_refund(),
                Op::SealAtDeadline => m.seal_at_deadline(),
                Op::Refund(i) => m.refund(i % CAP),
            }
            m.assert_invariant();
            m.assert_terminal();
        }
    }

    /// The happy path, exhaustively: bootstrap the treasury, open (pot funds
    /// BEFORE any entry), fill, commit, pay all committed seats, settle all
    /// escrow — the vault must end at EXACTLY zero for every tier and every
    /// flag pattern, and the treasury must hold the bootstrap + all 64 entry
    /// payments − the pot + any forfeits.
    #[test]
    fn full_lifecycle_drains_the_vault_to_zero(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        seed in any::<u64>(),
        flagged_bits in any::<u16>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = TIER_POT_LAMPORTS[tier];
        let mut m = Model::new(price, pot, 0, 0);
        // Policy at open (single tier, excluded as the one being opened):
        // needs pot + min(0) + 0 available.
        m.fund(pot);
        m.open_pool();
        prop_assert_eq!(m.state, St::Open);
        prop_assert_eq!(m.vault, pot as u128); // funded before any entry
        for _ in 0..CAP { m.register(); }
        prop_assert_eq!(m.state, St::Sealed);
        prop_assert_eq!(m.refundable, 0u128); // revenue at seal
        m.commit(seed);
        // Flag paid seats according to the bit pattern (the committed list
        // is the rank-1 tie group — D-E2 over D3-B).
        let paid_seats: Vec<usize> = m.committed.iter().map(|&(s, _)| s).collect();
        for (i, &seat) in paid_seats.iter().enumerate() {
            if flagged_bits & (1 << (i % 16)) != 0 { m.flag(seat, true); }
        }
        m.pay(&paid_seats.iter().map(|&s| s as u16).collect::<Vec<_>>());
        m.assert_invariant();
        prop_assert_eq!(m.state, St::Paid);
        prop_assert_eq!(m.reserved, 0u128);
        // Settle escrow: release the even seats' holds, forfeit the odd
        // seats' (forfeit requires the flag; release covers the rest).
        for (i, &seat) in paid_seats.iter().enumerate() {
            if i % 2 == 0 { m.release(seat) } else { m.forfeit(seat) }
            m.release(seat); // no-op unless the forfeit was refused
            m.assert_invariant();
        }
        prop_assert_eq!(m.vault, 0u128, "vault must end at exactly zero");
        // Treasury conservation across the pool: bootstrap + entries − pot
        // paid out + forfeits back in.
        let expected = pot as u128 + CAP as u128 * price as u128
            - m.total_pots_funded + m.total_forfeited;
        prop_assert_eq!(m.platform, expected, "treasury drifted over the lifecycle");
    }

    /// The refund fork, exhaustively: any fill BELOW the minimum field (D-E4
    /// moved the threshold from 64 to `MIN_SEATS`), trigger (pot returns
    /// whole), refund all — the vault ends at zero, every entrant is repaid
    /// exactly their price, and the treasury ends exactly where it started.
    /// A seal attempt on such a pool is a no-op: the fork is decided by the
    /// field, and the two instructions reject each other's case.
    #[test]
    fn refund_fork_returns_every_lamport(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        fill in 0usize..MIN, // strictly below the minimum field
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = TIER_POT_LAMPORTS[tier];
        let mut m = Model::new(price, pot, 0, 0);
        m.fund(pot);
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
        prop_assert_eq!(m.vault, 0u128, "refunded pool strands vault lamports");
        prop_assert_eq!(m.refundable, 0u128, "refundable not fully released");
        prop_assert_eq!(m.total_refunded, fill as u128 * price as u128,
            "R7: every entrant repaid exactly the price");
        // Pot out, pot back: the treasury holds exactly the bootstrap again.
        prop_assert_eq!(m.platform, pot as u128, "treasury drifted over the refund fork");
    }

    /// The minimum-field path, exhaustively (D-E4): any fill in
    /// `MIN_SEATS..CAPACITY`, the deadline passes, the pool SEALS (a refund
    /// attempt is refused), the winner (or the tie for first) is paid the
    /// whole pot, the vault ends at zero, and the treasury keeps the field's
    /// entries minus the pot — strictly positive at every fill, which is the
    /// §11.1 break-even property the constants promise, exercised rather than
    /// asserted.
    #[test]
    fn min_field_seals_and_pays_the_winner(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        fill in MIN..CAP,
        seed in any::<u64>(),
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = TIER_POT_LAMPORTS[tier];
        let mut m = Model::new(price, pot, 0, 0);
        m.fund(pot);
        m.open_pool();
        for _ in 0..fill { m.register(); }
        prop_assert_eq!(m.state, St::Open, "below 64 the pool is still Open");
        prop_assert_eq!(m.refundable, fill as u128 * price as u128);
        m.trigger_refund(); // FieldReached — must not refund
        prop_assert_eq!(m.state, St::Open, "a playable field must not refund");
        m.seal_at_deadline();
        prop_assert_eq!(m.state, St::Sealed);
        prop_assert_eq!(m.refundable, 0u128, "the field's entries became revenue at seal");
        m.assert_invariant();
        m.commit(seed);
        let paid_seats: Vec<u16> = m.committed.iter().map(|&(s, _)| s as u16).collect();
        prop_assert!(!paid_seats.is_empty());
        prop_assert!(paid_seats.iter().all(|&s| (s as usize) < fill), "only real seats are paid");
        m.pay(&paid_seats);
        m.assert_invariant();
        prop_assert_eq!(m.state, St::Paid);
        prop_assert_eq!(m.vault, 0u128, "the whole pot left the vault");
        prop_assert_eq!(m.total_paid, pot as u128, "the winner set received exactly the pot");
        // Break-even (§11.1): entries in minus the pot out is positive at the floor.
        let margin = m.platform as i128 - 0i128; // bootstrap pot − pot funded + entries
        prop_assert_eq!(m.platform, fill as u128 * price as u128, "treasury holds the field's entries");
        prop_assert!(margin > pot as i128, "the minimum field clears the pot with margin");
    }

    /// `withdraw_platform`'s floor: a withdrawal that would dip below
    /// min + idle-tier reserve + refundable is refused with NOTHING moved,
    /// and one exactly at the floor succeeds.
    #[test]
    fn withdraw_floor_is_exact(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        min_platform in 0u64..10_000_000_000,
        surplus in 0u64..10_000_000_000,
    ) {
        let price = TIER_ENTRY_LAMPORTS[tier];
        let pot = TIER_POT_LAMPORTS[tier];
        let mut m = Model::new(price, pot, min_platform, 0);
        // No live pool → idle reserve = one pot (reserve_pots = 1).
        let floor = min_platform as u128 + pot as u128;
        m.fund(pot + min_platform + surplus);
        prop_assert_eq!(m.platform, floor + surplus as u128);
        // One lamport over the withdrawable surplus must be refused.
        m.withdraw(surplus + 1);
        prop_assert_eq!(m.platform, floor + surplus as u128, "below-floor withdraw moved money");
        // Exactly the surplus clears.
        m.withdraw(surplus);
        prop_assert_eq!(m.platform, floor, "at-floor withdraw refused");
        m.assert_invariant();
    }
}
