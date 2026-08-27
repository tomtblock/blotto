//! The vault-invariant model suite (roadmap 1.7) — the substitute for an
//! audit under R5, so it errs toward paranoia.
//!
//! A model of the program's money flows is driven through 10k random
//! instruction sequences. The model calls the SAME arithmetic the handlers
//! call (`prize_math`), and mirrors each handler's preconditions; after every
//! step it asserts the ledger identity from roadmap 1.7:
//!
//! ```text
//! vault == Σ vault_share(entries) − Σ paid − Σ refunded(80%)
//!          − Σ released − Σ forfeited
//! fees  == Σ fee_share(entries)  − swept  − Σ refunded(20%)
//! ```
//!
//! plus the terminal conditions: a fully settled pool leaves the vault at
//! exactly zero (nothing stranded, nothing minted), and a fully refunded pool
//! leaves BOTH PDAs at exactly zero — R7's "full refund" is exact, not
//! approximate.
//!
//! What this does and does not prove: it proves the arithmetic and the state
//! machine conserve lamports under any interleaving the program permits. It
//! does not execute the real BPF program — the LiteSVM integration suite
//! covers the on-chain half against the compiled artifact.

use blotto_cup::constants::{CAPACITY, PAID_RANKS, TIER_ENTRY_LAMPORTS};
use blotto_cup::prize_math::{band_amount, fee_share, pot, vault_share};
use proptest::prelude::*;

const CAP: usize = CAPACITY as usize;

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
    entry_lamports: u64,
    state: St,
    entrants: usize,
    vault: u128,
    fees: u128,
    swept: bool,
    paid_mask: u16,
    winners: Vec<usize>, // entry indices, rank order (index 0 = rank 1)
    kyc_above: u64,
    entries: [EntryModel; CAP],
    // Ledger tallies for the invariant.
    total_in_vault_shares: u128,
    total_in_fee_shares: u128,
    total_paid: u128,
    total_refunded_80: u128,
    total_refunded_20: u128,
    total_released: u128,
    total_forfeited: u128,
    total_swept: u128,
}

impl Model {
    fn new(entry_lamports: u64, kyc_above: u64) -> Self {
        Model {
            entry_lamports,
            state: St::Open,
            entrants: 0,
            vault: 0,
            fees: 0,
            swept: false,
            paid_mask: 0,
            winners: Vec::new(),
            kyc_above,
            entries: [EntryModel::default(); CAP],
            total_in_vault_shares: 0,
            total_in_fee_shares: 0,
            total_paid: 0,
            total_refunded_80: 0,
            total_refunded_20: 0,
            total_released: 0,
            total_forfeited: 0,
            total_swept: 0,
        }
    }

    /// `register` — the two credits, and the 64th entry's seal + sweep.
    fn register(&mut self) {
        if self.state != St::Open || self.entrants >= CAP {
            return; // handler would revert
        }
        let v = vault_share(self.entry_lamports) as u128;
        let f = fee_share(self.entry_lamports) as u128;
        self.vault += v;
        self.fees += f;
        self.total_in_vault_shares += v;
        self.total_in_fee_shares += f;
        self.entries[self.entrants].exists = true;
        self.entrants += 1;
        if self.entrants == CAP {
            self.state = St::Sealed;
            self.total_swept = self.fees;
            self.fees = 0;
            self.swept = true;
        }
    }

    fn flag(&mut self, i: usize, on: bool) {
        let e = &mut self.entries[i];
        if !e.exists || e.settled {
            return;
        }
        e.flagged = on;
    }

    /// `commit_results` — 16 distinct winners drawn from the 64 entries.
    fn commit(&mut self, seed: u64) {
        if self.state != St::Sealed {
            return;
        }
        // Deterministic distinct pick: walk the seats from a seeded start.
        let start = (seed as usize) % CAP;
        let stride = 1 + (seed as usize / CAP) % 7;
        let mut w = Vec::with_capacity(PAID_RANKS);
        let mut k = start;
        while w.len() < PAID_RANKS {
            if !w.contains(&(k % CAP)) {
                w.push(k % CAP);
            }
            k += stride;
        }
        self.winners = w;
        self.state = St::Scored;
    }

    /// `pay_prizes` on a batch of ranks (1-based).
    fn pay(&mut self, ranks: &[u8]) {
        if self.state != St::Scored {
            return;
        }
        let pot = pot(self.entry_lamports);
        for &rank in ranks {
            if !(1..=PAID_RANKS as u8).contains(&rank) {
                continue;
            }
            let bit = 1u16 << (rank - 1);
            if self.paid_mask & bit != 0 {
                continue; // handler reverts the batch; model skips — same net state
            }
            let wi = self.winners[(rank - 1) as usize];
            let e = &mut self.entries[wi];
            if e.settled {
                continue;
            }
            let amount = band_amount(pot, rank);
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
        if self.paid_mask == 0xFFFF {
            self.state = St::Paid;
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

    fn forfeit(&mut self, i: usize) {
        let e = &mut self.entries[i];
        if !e.exists || e.escrow == 0 || !e.flagged {
            return;
        }
        let amount = e.escrow as u128;
        assert!(self.vault >= amount, "vault underflow at forfeit");
        self.vault -= amount;
        self.total_forfeited += amount;
        e.escrow = 0;
    }

    fn trigger_refund(&mut self) {
        if self.state != St::Open {
            return;
        }
        self.state = if self.entrants == 0 {
            St::Closed
        } else {
            St::Refunding
        };
    }

    fn refund(&mut self, i: usize) {
        if self.state != St::Refunding {
            return;
        }
        let e = &mut self.entries[i];
        if !e.exists || e.refunded {
            return;
        }
        let v = vault_share(self.entry_lamports) as u128;
        let f = fee_share(self.entry_lamports) as u128;
        assert!(self.vault >= v, "vault underflow at refund");
        assert!(self.fees >= f, "fees underflow at refund");
        self.vault -= v;
        self.fees -= f;
        self.total_refunded_80 += v;
        self.total_refunded_20 += f;
        e.refunded = true;
        if self.entries.iter().all(|e| !e.exists || e.refunded) {
            self.state = St::Closed;
        }
    }

    /// The roadmap-1.7 ledger identity, checked after EVERY operation.
    fn assert_invariant(&self) {
        assert_eq!(
            self.vault,
            self.total_in_vault_shares
                - self.total_paid
                - self.total_refunded_80
                - self.total_released
                - self.total_forfeited,
            "vault ledger identity broken"
        );
        assert_eq!(
            self.fees,
            self.total_in_fee_shares - self.total_swept - self.total_refunded_20,
            "fees ledger identity broken"
        );
        // Escrow is backed: the vault always covers every recorded claim.
        let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
        assert!(
            self.vault >= escrow_total,
            "escrow claims exceed vault balance"
        );
        // Every balance the program would hold in a u64 fits one.
        assert!(self.vault <= u64::MAX as u128 && self.fees <= u64::MAX as u128);
    }

    fn assert_terminal(&self) {
        match self.state {
            St::Paid => {
                let escrow_total: u128 = self.entries.iter().map(|e| e.escrow as u128).sum();
                // A settled pool's vault holds exactly the outstanding escrow —
                // zero once escrow settles. Nothing stranded, nothing minted.
                assert_eq!(self.vault, escrow_total, "Paid pool strands lamports");
                assert!(self.swept, "Paid pool never swept fees");
            }
            St::Closed => {
                assert_eq!(self.vault, 0, "Closed pool strands vault lamports");
                assert_eq!(self.fees, 0, "Closed pool strands fee lamports");
            }
            _ => {}
        }
    }
}

/// One random operation. Indices are folded into range at execution.
#[derive(Clone, Debug)]
enum Op {
    Register,
    Flag(usize, bool),
    Commit(u64),
    Pay(Vec<u8>),
    Release(usize),
    Forfeit(usize),
    TriggerRefund,
    Refund(usize),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        8 => Just(Op::Register),
        2 => (0usize..CAP, any::<bool>()).prop_map(|(i, b)| Op::Flag(i, b)),
        2 => any::<u64>().prop_map(Op::Commit),
        4 => proptest::collection::vec(1u8..=16, 1..=8).prop_map(Op::Pay),
        2 => (0usize..CAP).prop_map(Op::Release),
        2 => (0usize..CAP).prop_map(Op::Forfeit),
        1 => Just(Op::TriggerRefund),
        3 => (0usize..CAP).prop_map(Op::Refund),
    ]
}

proptest! {
    // Roadmap 1.7: "Fuzz runs 10k sequences clean in CI."
    #![proptest_config(ProptestConfig { cases: 10_000, .. ProptestConfig::default() })]

    #[test]
    fn vault_ledger_holds_under_random_instruction_sequences(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        kyc_on in any::<bool>(),
        ops in proptest::collection::vec(op_strategy(), 1..200),
    ) {
        let entry = TIER_ENTRY_LAMPORTS[tier];
        // When the KYC switch is on, put the threshold where it splits the
        // band table: some prizes above, some below.
        let kyc_above = if kyc_on { band_amount(pot(entry), 5) } else { 0 };
        let mut m = Model::new(entry, kyc_above);
        for op in ops {
            match op {
                Op::Register => m.register(),
                Op::Flag(i, b) => m.flag(i % CAP, b),
                Op::Commit(seed) => m.commit(seed),
                Op::Pay(ranks) => m.pay(&ranks),
                Op::Release(i) => m.release(i % CAP),
                Op::Forfeit(i) => m.forfeit(i % CAP),
                Op::TriggerRefund => m.trigger_refund(),
                Op::Refund(i) => m.refund(i % CAP),
            }
            m.assert_invariant();
            m.assert_terminal();
        }
    }

    /// The happy path, exhaustively: fill, commit, pay all 16, settle all
    /// escrow — the vault must end at EXACTLY zero for every tier and every
    /// flag pattern.
    #[test]
    fn full_lifecycle_drains_the_vault_to_zero(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        seed in any::<u64>(),
        flagged_bits in any::<u16>(),
    ) {
        let entry = TIER_ENTRY_LAMPORTS[tier];
        let mut m = Model::new(entry, 0);
        for _ in 0..CAP { m.register(); }
        prop_assert_eq!(m.state, St::Sealed);
        prop_assert_eq!(m.fees, 0u128); // swept at seal
        m.commit(seed);
        // Flag winners according to the bit pattern.
        let winners = m.winners.clone();
        for (r, &wi) in winners.iter().enumerate() {
            if flagged_bits & (1 << r) != 0 { m.flag(wi, true); }
        }
        m.pay(&(1..=16u8).collect::<Vec<_>>());
        m.assert_invariant();
        prop_assert_eq!(m.state, St::Paid);
        // Settle escrow: release the even ranks' holds, forfeit the odd
        // ranks' (forfeit requires the flag; release covers the rest).
        for (r, &wi) in winners.iter().enumerate() {
            if r % 2 == 0 { m.release(wi) } else { m.forfeit(wi) }
            m.release(wi); // no-op unless the forfeit was refused
            m.assert_invariant();
        }
        prop_assert_eq!(m.vault, 0u128, "vault must end at exactly zero");
    }

    /// The refund fork, exhaustively: any partial fill, trigger, refund all —
    /// both PDAs end at EXACTLY zero (R7's full refund is exact).
    #[test]
    fn refund_fork_returns_every_lamport(
        tier in 0usize..TIER_ENTRY_LAMPORTS.len(),
        fill in 0usize..CAP, // strictly below capacity — a full pool seals
    ) {
        let entry = TIER_ENTRY_LAMPORTS[tier];
        let mut m = Model::new(entry, 0);
        for _ in 0..fill { m.register(); }
        m.trigger_refund();
        for i in 0..fill {
            m.refund(i);
            m.assert_invariant();
        }
        prop_assert_eq!(m.state, St::Closed);
        prop_assert_eq!(m.vault, 0u128, "refunded pool strands vault lamports");
        prop_assert_eq!(m.fees, 0u128, "refunded pool strands fee lamports");
    }
}
