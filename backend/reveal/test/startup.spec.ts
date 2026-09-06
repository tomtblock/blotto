/**
 * Startup step budgets. The property under test is the one the daemon lacked
 * on 2026-09-06: a vendor call that neither succeeds nor fails must become a
 * named, fatal error rather than silence.
 */

import { expect } from 'chai';
import {
  LAMPORTS_PER_SOL,
  SETTLEMENT_FLOOR_LAMPORTS,
  StartupTimeout,
  assertCanPayFees,
  formatSol,
  step,
} from '../src/startup';

const lines: string[] = [];
const log = (line: string): void => {
  lines.push(line);
};

beforeEach(() => {
  lines.length = 0;
});

describe('a bounded startup step', () => {
  it('passes the value through when the work finishes inside its budget', async () => {
    const got = await step('quick thing', 1_000, async () => 'the uploader', log);
    expect(got).to.equal('the uploader');
  });

  it('rejects with the step NAMED when the budget is exceeded', async () => {
    // A promise that never settles — the exact shape of the stall: not an
    // error, not a result, just nothing.
    const stalls = (): Promise<never> => new Promise<never>(() => {});
    let caught: unknown = null;
    try {
      await step('irys uploader', 20, stalls, log);
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(StartupTimeout);
    expect((caught as StartupTimeout).step).to.equal('irys uploader');
    expect((caught as StartupTimeout).budgetMs).to.equal(20);
    expect((caught as Error).message).to.match(/irys uploader/);
  });

  it('lets a genuine failure through unchanged rather than reporting a timeout', async () => {
    // A vendor that refuses is not a vendor that hangs; conflating them would
    // send an operator looking for a network stall that is not there.
    let caught: unknown = null;
    try {
      await step('irys uploader', 1_000, async () => {
        throw new Error('IRYS_UPLOAD_KEY is not set');
      }, log);
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(caught).to.not.be.instanceOf(StartupTimeout);
    expect((caught as Error).message).to.equal('IRYS_UPLOAD_KEY is not set');
  });

  it('logs the start and the elapsed time, because the log is the only witness', async () => {
    let clock = 1_000;
    await step('switchboard queue', 45_000, async () => 'ops', log, () => clock += 250);
    expect(lines[0]).to.match(/^switchboard queue: starting \(budget 45000ms\)$/);
    expect(lines[1]).to.match(/^switchboard queue: done in \d+ms$/);
  });

  it('does not keep the process alive on its own timer after the work resolves', async () => {
    // If the budget timer outlived a fast step, a 45s budget would hold the
    // event loop open for 45s at every boot. Proven by the suite finishing.
    const before = Date.now();
    await step('fast', 60_000, async () => 1, log);
    expect(Date.now() - before).to.be.lessThan(5_000);
  });
});

describe('the settlement signer floor', () => {
  const ADDR = 'EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD';

  it('lets a funded signer through', () => {
    expect(() => assertCanPayFees(ADDR, 2n * LAMPORTS_PER_SOL)).to.not.throw();
  });

  it('REFUSES an empty signer, naming the address — the 2026-09-06 case', () => {
    // Zero is not a degenerate input here: it is the state the daemon actually
    // ran in for forty minutes, retrying every fifteen seconds.
    expect(() => assertCanPayFees(ADDR, 0n)).to.throw(new RegExp(ADDR));
  });

  it('names what the balance is for, not just that it is low', () => {
    let message = '';
    try {
      assertCanPayFees(ADDR, 0n);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/open_pool/);
    expect(message).to.match(/prior credit/);
  });

  it('refuses just below the floor and passes exactly at it', () => {
    expect(() => assertCanPayFees(ADDR, SETTLEMENT_FLOOR_LAMPORTS - 1n)).to.throw();
    expect(() => assertCanPayFees(ADDR, SETTLEMENT_FLOOR_LAMPORTS)).to.not.throw();
  });

  it('sits the floor above one pool and below a pointless reserve', () => {
    // ~0.016 SOL per pool measured from the account layouts. A floor under one
    // pool would let the daemon open one it cannot finish settling.
    const onePool = 16_000_000n;
    expect(SETTLEMENT_FLOOR_LAMPORTS > onePool * 2n).to.equal(true);
    expect(SETTLEMENT_FLOOR_LAMPORTS < LAMPORTS_PER_SOL).to.equal(true);
  });

  it('formats lamports without a float', () => {
    expect(formatSol(2_000_000_000n)).to.equal('2.000000000');
    expect(formatSol(0n)).to.equal('0.000000000');
    expect(formatSol(1n)).to.equal('0.000000001');
  });
});
