/**
 * The bank/recycle harness (B-f). These are the properties the twenty-pool
 * run depends on and cannot check for itself once it is running.
 *
 * Deliberately NOT tested here: the transfers. They need a cluster, and a
 * mock of `sendAndConfirmTransaction` would assert that this file calls the
 * function this file calls. Pool 1's reported bank delta is the real test of
 * the money movement — which is exactly why `assertSweepWorked` exists and is
 * covered below.
 */

import { expect } from 'chai';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  assertSweepWorked,
  bankLedger,
  deriveEntrantWallets,
  ENTRANT_FEE_BUFFER_LAMPORTS,
  SWEEP_WORKING_MAX_LOSS_LAMPORTS,
} from '../src/bank';

const bank = Keypair.generate().publicKey;
const sol = (n: bigint) => n * BigInt(LAMPORTS_PER_SOL);

describe('entrant wallet derivation', () => {
  it('is deterministic — the whole point, so a crashed run can recover the funds', () => {
    const first = deriveEntrantWallets(bank, 1n, 64);
    const again = deriveEntrantWallets(bank, 1n, 64);
    expect(first.map((w) => w.keypair.publicKey.toBase58())).to.deep.equal(
      again.map((w) => w.keypair.publicKey.toBase58())
    );
  });

  it('gives every seat a distinct wallet', () => {
    const wallets = deriveEntrantWallets(bank, 1n, 64);
    const unique = new Set(wallets.map((w) => w.keypair.publicKey.toBase58()));
    expect(unique.size).to.equal(64);
    expect(wallets.map((w) => w.seat)).to.deep.equal([...Array(64).keys()]);
  });

  it('never reuses a wallet across pools', () => {
    const one = deriveEntrantWallets(bank, 1n, 64).map((w) => w.keypair.publicKey.toBase58());
    const two = deriveEntrantWallets(bank, 2n, 64).map((w) => w.keypair.publicKey.toBase58());
    expect(one.some((a) => two.includes(a))).to.equal(false);
  });

  it('is scoped to the bank, so another operator derives different wallets', () => {
    const other = Keypair.generate().publicKey;
    const mine = deriveEntrantWallets(bank, 1n, 4).map((w) => w.keypair.publicKey.toBase58());
    const theirs = deriveEntrantWallets(other, 1n, 4).map((w) => w.keypair.publicKey.toBase58());
    expect(mine.some((a) => theirs.includes(a))).to.equal(false);
  });

  it('refuses a non-positive count rather than returning nothing useful', () => {
    expect(() => deriveEntrantWallets(bank, 1n, 0)).to.throw(/positive/);
  });
});

describe('the bank ledger', () => {
  it('reports a loss without floats', () => {
    const l = bankLedger(sol(20n), sol(20n) - 410_000_000n);
    expect(l.net).to.equal(-410_000_000n);
    expect(l.netSol).to.equal('-0.410000000');
  });

  it('reports a gain', () => {
    const l = bankLedger(sol(20n), sol(21n));
    expect(l.net).to.equal(sol(1n));
    expect(l.netSol).to.equal('1.000000000');
  });

  it('keeps sub-lamport-free precision at nine places', () => {
    expect(bankLedger(0n, 1n).netSol).to.equal('0.000000001');
  });
});

describe('the pool-1 sweep gate', () => {
  it('passes the shape of a working sweep (about -0.41 SOL)', () => {
    expect(() => assertSweepWorked(bankLedger(sol(20n), sol(20n) - 410_000_000n))).to.not.throw();
  });

  it('FAILS the shape of a sweep that silently did nothing (about -5.5 SOL)', () => {
    expect(() =>
      assertSweepWorked(bankLedger(sol(20n), sol(20n) - 5_500_000_000n))
    ).to.throw(/sweep-back is working/);
  });

  it('never blocks a pool that gained', () => {
    expect(() => assertSweepWorked(bankLedger(sol(20n), sol(21n)))).to.not.throw();
  });

  it('sits the threshold between the two outcomes, not near either', () => {
    // A gate that can only pass is worth nothing; one that trips on normal
    // variation stops the run for no reason. 2 SOL is ~5x a working pool's
    // cost and ~0.36x a broken one — comfortably clear of both.
    const working = 410_000_000n;
    const broken = 5_500_000_000n;
    // chai's numeric matchers do not accept BigInt; compare and assert the
    // boolean rather than losing precision through Number().
    expect(SWEEP_WORKING_MAX_LOSS_LAMPORTS > working * 4n).to.equal(true);
    expect(SWEEP_WORKING_MAX_LOSS_LAMPORTS < broken / 2n).to.equal(true);
  });
});

describe('funding arithmetic', () => {
  it('leaves each entrant its entry price plus a fee buffer', () => {
    const entry = 100_000_000n; // the 0.1 SOL tier
    expect(entry + ENTRANT_FEE_BUFFER_LAMPORTS).to.equal(130_000_000n);
  });
});
