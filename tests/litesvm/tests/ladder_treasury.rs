//! The Ladder's gates and the treasury policy across pool types (D-E19),
//! against the compiled artifact.
//!
//!   - `open_pool` refuses a disabled type, a closed tier, and economics a
//!     price change has made stale;
//!   - the remaining-accounts list (`treasury::idle_pool_type_reserve`) is
//!     believed only when it is EXACTLY every other enabled pool type, once
//!     each, in ascending address order: an incomplete, unsorted or
//!     duplicated list, the opened type itself, a disabled type smuggled in,
//!     and an account that is not a pool type are all refused — so no caller
//!     can shrink the reserve by what it leaves out;
//!   - `withdraw_platform` takes the same list (every enabled type) and its
//!     floor is the per-type reserve to the lamport;
//!   - the permissionless settlement paths take the POOL's own type by its
//!     seeds: no caller can free, or stamp, another type's slot;
//!   - the devnet launch posture — all eight pool types at tier 0, both
//!     modes × four sizes — opens in full under the treasury policy, with
//!     the treasury figures pinned exactly.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const C: u64 = VAULT_RENT_CUSHION;

fn pot(capacity: u16) -> u64 {
    table_value(&ladder_table(capacity), ENTRY)
}

#[test]
fn open_pool_refuses_a_disabled_type_a_closed_tier_and_stale_economics() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    env.ensure_pool_type(MODE_EASY, 0, 16);
    env.fund_platform(100 * ENTRY);

    // A capacity with no pool type has nothing to open.
    let ix = open_pool_ix(
        &settlement.pubkey(),
        1,
        0,
        [9; 32],
        env.sealing_secret_hash,
        MODE_EASY,
        12,
        &env.enabled_pool_types(),
    );
    assert_refused(env.send(&[ix], &[&settlement]), "3012", "AccountNotInitialized");

    // Disabled type: refused by name.
    env.set_pool_type_enabled(MODE_EASY, 0, 16, false).unwrap();
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 16);
    assert_refused(env.send(&[ix], &[&settlement]), "6077", "PoolTypeDisabled");
    env.set_pool_type_enabled(MODE_EASY, 0, 16, true).unwrap();

    // Closed tier: R6's switch governs above the type.
    env.send(&[admin_ix(&admin, "set_open_tiers", &[0; 7])], &[]).unwrap();
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 16);
    assert_refused(env.send(&[ix], &[&settlement]), "6006", "TierNotOpen");
    env.send(&[admin_ix(&admin, "set_open_tiers", &[1, 0, 0, 0, 0, 0, 0])], &[])
        .unwrap();

    // Stale: the founder moves tier 0's price to 0.2 SOL. The type's stored
    // prize pool (1 SOL) is no longer its table at the price (2 SOL), and
    // the program refuses rather than publish prizes that moved silently.
    let new_price = 200_000_000;
    env.send(&[set_tier_economics_ix(&admin, 0, new_price, 40 * new_price)], &[])
        .expect("set_tier_economics");
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 16);
    assert_refused(env.send(&[ix], &[&settlement]), "6079", "PoolTypeEconomicsStale");
    // A restatement at the OLD prize pool is refused at the source...
    let ix = set_pool_type_economics_ix(&admin, MODE_EASY, 0, 16, 10, LADDER_TABLES[1], 10 * ENTRY);
    assert_refused(env.send(&[ix], &[]), "6082", "PrizePoolMismatch");
    // ...and one at the new price clears the open, which copies the new
    // price and prize pool.
    env.set_launch_economics(MODE_EASY, 0, 16).unwrap();
    assert_eq!(
        read_pool_type(&env.svm, &pool_type_pda(MODE_EASY, 0, 16)).pot_lamports,
        10 * new_price
    );
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 16);
    env.send(&[ix], &[&settlement]).expect("restated economics open");
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!((pv.entry_lamports, pv.pot_lamports), (new_price, 10 * new_price));
    assert_eq!(env.balance(&vault_pda(1)), 10 * new_price + C);
}

#[test]
fn open_pool_believes_only_exactly_every_other_enabled_type_in_address_order() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    for &cap in &POOL_CAPACITIES {
        env.ensure_pool_type(MODE_EASY, 0, cap);
    }
    // A configured but DISABLED type, to smuggle.
    env.init_pool_type(MODE_HARD, 0, 8).unwrap();
    env.set_launch_economics(MODE_HARD, 0, 8).unwrap();
    let disabled = pool_type_pda(MODE_HARD, 0, 8);
    env.fund_platform(1_000 * ENTRY);

    let own = pool_type_pda(MODE_EASY, 0, 16);
    let others = env.other_enabled_pool_types(MODE_EASY, 0, 16);
    assert_eq!(others.len(), 3);
    assert!(others.windows(2).all(|w| w[0] < w[1]), "the harness sorts by raw bytes");
    let open = |env: &mut Env, list: &[Pubkey]| {
        let ix = open_pool_ix(
            &settlement.pubkey(),
            1,
            0,
            [9; 32],
            env.sealing_secret_hash,
            MODE_EASY,
            16,
            list,
        );
        env.send(&[ix], &[&settlement])
    };
    let sorted = |mut v: Vec<Pubkey>| {
        v.sort();
        v
    };

    // Incomplete: one left out (which would shrink the reserve), or none.
    for drop in 0..3 {
        let mut short = others.clone();
        short.remove(drop);
        assert_refused(open(&mut env, &short), "6083", "PoolTypeListIncomplete");
    }
    assert_refused(open(&mut env, &[]), "6083", "PoolTypeListIncomplete");
    // Too many: the opened type itself appended.
    let mut long = others.clone();
    long.push(own);
    assert_refused(open(&mut env, &sorted(long)), "6083", "PoolTypeListIncomplete");
    // Unsorted (every rotation of the right set but the sorted one).
    let mut rev = others.clone();
    rev.reverse();
    assert_refused(open(&mut env, &rev), "6083", "PoolTypeListIncomplete");
    let mut swapped = others.clone();
    swapped.swap(0, 1);
    assert_refused(open(&mut env, &swapped), "6083", "PoolTypeListIncomplete");
    // Duplicated: the right count, one type twice.
    let dup = sorted(vec![others[0], others[0], others[2]]);
    assert_refused(open(&mut env, &dup), "6083", "PoolTypeListIncomplete");
    // The opened type standing in for an enabled one.
    let with_own = sorted(vec![others[0], others[1], own]);
    assert_refused(open(&mut env, &with_own), "6083", "PoolTypeListIncomplete");
    // A DISABLED type smuggled in for an enabled one.
    let smuggled = sorted(vec![others[0], others[1], disabled]);
    assert_refused(open(&mut env, &smuggled), "6083", "PoolTypeListIncomplete");
    // Accounts that are not pool types: the Config and a Pool (this
    // program's, wrong discriminator), the treasury and a stranger's wallet
    // (not this program's).
    env.open_ready_pool_sized(1, 0, MODE_EASY, 8); // gives us a Pool account
    let others = env.other_enabled_pool_types(MODE_EASY, 0, 16);
    let open2 = |env: &mut Env, list: &[Pubkey]| {
        let ix = open_pool_ix(
            &settlement.pubkey(),
            2,
            0,
            [9; 32],
            env.sealing_secret_hash,
            MODE_EASY,
            16,
            list,
        );
        env.send(&[ix], &[&settlement])
    };
    for fake in [config_pda(), pool_pda(1), platform_pda(), settlement.pubkey()] {
        let list = sorted(vec![others[0], others[1], fake]);
        assert_refused(open2(&mut env, &list), "6084", "PoolTypeAccountInvalid");
    }
    assert_eq!(read_config(&env.svm).next_pool_id, 2, "nothing but pool 1 opened");

    // Exactly the other enabled types, ascending: it opens.
    open2(&mut env, &others).expect("the exact list opens");
    assert_eq!(read_pool_type(&env.svm, &own).active_pool, 2);
}

#[test]
fn withdraw_platform_needs_the_whole_list_and_holds_the_per_type_reserve_exactly() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    let dest = Pubkey::new_unique();
    // Three enabled types across both modes; hard tier 0 open.
    env.send(&[set_hard_open_tiers_ix(&admin, [true, false, false, false, false, false, false])], &[])
        .unwrap();
    env.ensure_pool_type(MODE_EASY, 0, 8);
    env.ensure_pool_type(MODE_EASY, 0, 64);
    env.ensure_pool_type(MODE_HARD, 0, 16);
    // Policy: TWO further pools of every idle enabled type, and 0.3 SOL.
    let min = 3 * ENTRY;
    env.send(&[set_treasury_policy_ix(&admin, 2, min)], &[]).unwrap();
    let per_type = |cap: u16| 2 * (pot(cap) + C);
    let floor = min + per_type(8) + per_type(64) + per_type(16);
    let surplus = 7 * ENTRY;
    env.fund_platform(floor + surplus);
    let all = env.enabled_pool_types();
    assert_eq!(all.len(), 3);

    let withdraw = |env: &mut Env, list: &[Pubkey], amount: u64| {
        let ix = withdraw_platform_ix(&admin, &dest, amount, list);
        env.send(&[ix], &[])
    };
    // The list must be every enabled type: short, empty, unsorted,
    // duplicated, smuggled — all refused, nothing moved.
    assert_refused(withdraw(&mut env, &all[..2], 1), "6083", "PoolTypeListIncomplete");
    assert_refused(withdraw(&mut env, &[], 1), "6083", "PoolTypeListIncomplete");
    let mut rev = all.clone();
    rev.reverse();
    assert_refused(withdraw(&mut env, &rev, 1), "6083", "PoolTypeListIncomplete");
    let mut dup = vec![all[0], all[0], all[2]];
    dup.sort();
    assert_refused(withdraw(&mut env, &dup, 1), "6083", "PoolTypeListIncomplete");
    env.init_pool_type(MODE_HARD, 0, 32).unwrap();
    env.set_launch_economics(MODE_HARD, 0, 32).unwrap();
    let mut smuggled = vec![all[0], all[1], pool_type_pda(MODE_HARD, 0, 32)];
    smuggled.sort();
    assert_refused(withdraw(&mut env, &smuggled, 1), "6083", "PoolTypeListIncomplete");
    let mut fake = vec![all[0], all[1], config_pda()];
    fake.sort();
    assert_refused(withdraw(&mut env, &fake, 1), "6084", "PoolTypeAccountInvalid");
    assert_eq!(env.balance(&dest), 0);

    // With the whole list the floor is exact: one lamport over the surplus
    // is refused, the surplus itself leaves.
    assert_refused(withdraw(&mut env, &all, surplus + 1), "6048", "WithdrawBelowFloor");
    withdraw(&mut env, &all, surplus).expect("exactly the surplus");
    assert_eq!(env.balance(&platform_pda()), floor);
    assert_refused(withdraw(&mut env, &all, 1), "6048", "WithdrawBelowFloor");

    // Opening the 64-player type spends its own funding out of its reserve
    // and RELEASES the rest of that reserve: a live type reserves nothing,
    // so exactly (pot + cushion) more becomes withdrawable.
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
    env.send(&[ix], &[&settlement]).expect("open from the reserve");
    assert_eq!(env.balance(&platform_pda()), floor - (pot(64) + C));
    let released = pot(64) + C;
    assert_refused(
        withdraw(&mut env, &all, released + 1),
        "6048",
        "WithdrawBelowFloor",
    );
    withdraw(&mut env, &all, released).expect("the live type's reserve is released");

    // Closing the hard TIER releases its type's reserve (the type stays
    // enabled — still on the list — but reserves nothing on a closed tier).
    env.send(&[set_hard_open_tiers_ix(&admin, [false; 7])], &[]).unwrap();
    assert_refused(
        withdraw(&mut env, &all, per_type(16) + 1),
        "6048",
        "WithdrawBelowFloor",
    );
    withdraw(&mut env, &all, per_type(16)).expect("a closed tier's type reserves nothing");

    // Disabling a type takes it off the list AND out of the reserve.
    env.set_pool_type_enabled(MODE_EASY, 0, 8, false).unwrap();
    assert_refused(withdraw(&mut env, &all, 1), "6083", "PoolTypeListIncomplete");
    let all = env.enabled_pool_types();
    assert_eq!(all.len(), 2);
    assert_refused(
        withdraw(&mut env, &all, per_type(8) + 1),
        "6048",
        "WithdrawBelowFloor",
    );
    withdraw(&mut env, &all, per_type(8)).expect("a disabled type reserves nothing");
    // What remains is the minimum alone (the 64 is live, the hard 16 on a
    // closed tier, the 8 disabled).
    assert_eq!(env.balance(&platform_pda()), min);
}

/// The settlement paths are permissionless, and each frees a SLOT — so each
/// takes the pool type by seeds derived from the pool's OWN recorded mode,
/// tier and capacity. Any other type is refused, so no caller can free, or
/// stamp a cooldown on, a slot its pool does not hold.
#[test]
fn a_permissionless_caller_cannot_free_another_types_slot() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(&[set_hard_open_tiers_ix(&admin, [true, false, false, false, false, false, false])], &[])
        .unwrap();
    env.ensure_pool_type(MODE_HARD, 0, 64);
    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 10_000_000_000).unwrap();
    let settlement = env.settlement.insecure_clone();

    // Pool 1: 8 players, full, to be paid. Pool 2: an empty 64, to be
    // closed by trigger_refund. Pool 3: a 16 with two entries, to refund.
    env.open_ready_pool_sized(1, 0, MODE_EASY, 8);
    env.open_ready_pool_sized(2, 0, MODE_EASY, 64);
    env.open_ready_pool_sized(3, 0, MODE_EASY, 16);
    let eight = env.register_n(1, 8);
    let sixteen = env.register_n(3, 2);
    let t8 = pool_type_pda(MODE_EASY, 0, 8);
    let t16 = pool_type_pda(MODE_EASY, 0, 16);
    let t64 = pool_type_pda(MODE_EASY, 0, 64);
    let h64 = pool_type_pda(MODE_HARD, 0, 64);
    let slots = |env: &Env| {
        [t8, t16, t64, h64].map(|t| {
            let v = read_pool_type(&env.svm, &t);
            (v.active_pool, v.next_open_at)
        })
    };
    let before = slots(&env);
    assert_eq!(before.map(|s| s.0), [1, 3, 2, 0]);

    // pay_prizes on pool 1 naming another type — another size, another mode.
    env.reveal(1);
    let payouts = straight_payouts(&LADDER_TABLES[0], ENTRY);
    env.commit(1, [1u8; 32], &payouts).unwrap();
    let metas: Vec<(Pubkey, Pubkey)> = payouts
        .iter()
        .map(|&(s, _)| (eight[s as usize].0.pubkey(), eight[s as usize].1))
        .collect();
    let seats: Vec<u16> = payouts.iter().map(|&(s, _)| s).collect();
    for wrong in [t64, t16, h64] {
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, &wrong, &seats, &metas);
        assert_refused(env.send(&[ix], &[&settlement]), "2006", "ConstraintSeeds");
    }
    // A non-pool-type account in the slot fails to load at all.
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &config_pda(), &seats, &metas);
    assert!(env.send(&[ix], &[&settlement]).is_err());
    assert_eq!(slots(&env), before, "no slot moved");

    // trigger_refund on pool 2 (past its deadline, empty) naming another type.
    env.advance_time(12 * 3600 + 1);
    for wrong in [t8, t16, h64] {
        let ix = trigger_refund_ix(&rando.pubkey(), 2, &wrong);
        assert_refused(env.send(&[ix], &[&rando]), "2006", "ConstraintSeeds");
    }
    // refund on pool 3 (Refunding once triggered) naming another type.
    let ix = env.trigger_refund_ix(&rando.pubkey(), 3);
    env.send(&[ix], &[&rando]).expect("pool 3 refunds");
    for wrong in [t8, t64, h64] {
        let (p, e) = &sixteen[0];
        let ix = refund_ix(&rando.pubkey(), 3, e, &p.pubkey(), &wrong);
        assert_refused(env.send(&[ix], &[&rando]), "2006", "ConstraintSeeds");
    }
    assert_eq!(slots(&env), before, "no slot moved, no cooldown stamped");

    // With their own types, each path frees exactly its own slot.
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &t8, &seats, &metas);
    env.send(&[ix], &[&settlement]).expect("pool 1 paid");
    let ix = trigger_refund_ix(&rando.pubkey(), 2, &t64);
    env.send(&[ix], &[&rando]).expect("pool 2 closed");
    for (p, e) in &sixteen {
        let ix = refund_ix(&rando.pubkey(), 3, e, &p.pubkey(), &t16);
        env.send(&[ix], &[&rando]).expect("pool 3 refund");
    }
    let now = env.now();
    assert_eq!(
        slots(&env),
        [(0, now + 300), (0, now + 300), (0, now + 300), before[3]],
        "each pool freed its own type's slot; the hard type was never touched"
    );
}

/// The devnet launch posture: all eight pool types at tier 0 — easy and
/// hard × 8, 16, 32, 64 — enabled, both tiers open, `reserve_pots = 1`, no
/// minimum. Their prize pools are 5, 10, 20 and 40 entries per mode: 15 SOL
/// in all at 0.1 SOL, plus one rent cushion per vault.
///
/// Because each open's threshold is its own funding plus one pool of every
/// OTHER idle type, the first open needs all eight pools' funding, and each
/// open after it is pre-funded exactly by the reserve the previous one left:
/// exactly 15 SOL + 8 cushions opens all eight, one lamport less opens none.
#[test]
fn eight_pool_types_at_tier_zero_are_all_open_at_once_under_the_treasury_policy() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    env.send(&[set_hard_open_tiers_ix(&admin, [true, false, false, false, false, false, false])], &[])
        .unwrap();
    let mut types: Vec<(u8, u16)> = Vec::new();
    for mode in [MODE_EASY, MODE_HARD] {
        for &cap in &POOL_CAPACITIES {
            env.ensure_pool_type(mode, 0, cap);
            types.push((mode, cap));
        }
    }
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.enabled_pool_types, 8);
    assert_eq!((cfg.treasury_reserve_pots, cfg.treasury_min_platform_lamports), (1, 0));
    let total_pots: u64 = types.iter().map(|&(_, cap)| pot(cap)).sum();
    assert_eq!(total_pots, 15_000_000_000, "2 × (0.5 + 1 + 2 + 4) SOL");
    let total = total_pots + 8 * C;

    // One lamport short: the first open (whichever) is refused.
    env.fund_platform(total - 1);
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
    assert_refused(env.send(&[ix], &[&settlement]), "6049", "TreasuryShortfall");
    env.fund_platform(1);
    assert_eq!(env.balance(&platform_pda()), total);

    // Open all eight with no further funding. Before each open the treasury
    // holds exactly the funding of every type still idle, and none of it is
    // withdrawable.
    let mut idle: Vec<(u8, u16)> = types.clone();
    for (i, &(mode, cap)) in types.iter().enumerate() {
        let expected: u64 = idle.iter().map(|&(_, c)| pot(c) + C).sum();
        assert_eq!(env.balance(&platform_pda()), expected, "before opening ({mode}, {cap})");
        let ix = env.withdraw_ix(&Pubkey::new_unique(), 1);
        assert_refused(env.send(&[ix], &[]), "6048", "WithdrawBelowFloor");
        let id = i as u64 + 1;
        let ix = env.open_ix(&settlement.pubkey(), id, 0, mode, cap);
        env.send(&[ix], &[&settlement])
            .unwrap_or_else(|e| panic!("open ({mode}, {cap}): {e}"));
        idle.retain(|&t| t != (mode, cap));
    }

    // All eight live at once, each in its own slot, each vault holding its
    // own prize pool and cushion; the treasury spent to the lamport.
    for (i, &(mode, cap)) in types.iter().enumerate() {
        let id = i as u64 + 1;
        let t = read_pool_type(&env.svm, &pool_type_pda(mode, 0, cap));
        assert_eq!(t.active_pool, id, "({mode}, {cap}) live");
        let pv = read_pool(&env.svm, &pool_pda(id));
        assert_eq!((pv.state, pv.mode, pv.capacity), (0, mode, cap));
        assert_eq!(env.balance(&vault_pda(id)), pot(cap) + C);
    }
    let vaults: u64 = (1..=8).map(|id| env.balance(&vault_pda(id))).sum();
    assert_eq!(vaults, total, "every lamport funded sits in a vault");
    assert_eq!(env.balance(&platform_pda()), 0);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.platform_reserved, 15_000_000_000);
    assert_eq!(cfg.platform_refundable, 0);
    assert_eq!(cfg.next_pool_id, 9);

    // A ninth pool has no type to go to: every type's slot is taken.
    env.fund_platform(100 * ENTRY);
    let ix = env.open_ix(&settlement.pubkey(), 9, 0, MODE_HARD, 32);
    assert_refused(env.send(&[ix], &[&settlement]), "6008", "TierAlreadyHasOpenPool");
}
