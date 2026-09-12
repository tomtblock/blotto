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
  uploadWalletVerdict,
  UPLOAD_WALLET_FLOOR_LAMPORTS,
  UNREADABLE_CEILING_ENV,
  announceVerdict,
  parseUnreadableCeiling,
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
    // Zero is not a contrived input here: it is the state the daemon actually
    // ran in for forty minutes, retrying every fifteen seconds.
    expect(() => assertCanPayFees(ADDR, 0n)).to.throw(ADDR);
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

/*
 * The upload wallet (audit 2026-09-11, C-01, second half): an empty wallet
 * is discovered at startup, not at the first settlement — refused on
 * mainnet, where uploads are paid, and only recorded on devnet, where they
 * are free-tier and a refusal would stop a rehearsal for nothing.
 */
describe('the upload wallet floor', () => {
  const ADDRESS = '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1';

  it('REFUSES an empty wallet on mainnet, naming the address, the floor and what it pays for', () => {
    const v = uploadWalletVerdict(ADDRESS, 0n, 'mainnet');
    expect(v.refuse).to.equal(true);
    expect(v.message).to.include(ADDRESS);
    expect(v.message).to.include('0.010000000 SOL floor');
    expect(v.message).to.match(/permanent upload/);
    expect(v.message).to.match(/Fund the address/);
  });

  it('refuses just below the floor and passes exactly at it', () => {
    expect(uploadWalletVerdict(ADDRESS, UPLOAD_WALLET_FLOOR_LAMPORTS - 1n, 'mainnet').refuse).to.equal(true);
    expect(uploadWalletVerdict(ADDRESS, UPLOAD_WALLET_FLOOR_LAMPORTS, 'mainnet').refuse).to.equal(false);
  });

  it('never refuses on devnet, and says why', () => {
    const v = uploadWalletVerdict(ADDRESS, 0n, 'devnet');
    expect(v.refuse).to.equal(false);
    expect(v.message).to.match(/free-tier/);
    expect(v.message).to.include(ADDRESS);
  });
});

/*
 * The unreadable-entry ceiling's wiring (plan 2026-09-12 §5). The crank's
 * guard existed and the daemon never set it; the value is the founder's, so
 * what is pinned here is only what an unset or malformed value MEANS.
 */
describe('the unreadable-entry ceiling', () => {
  it('passes a whole number through and names the variable', () => {
    const c = parseUnreadableCeiling('3', 'mainnet');
    expect(c.ceiling).to.equal(3);
    expect(c.message).to.include('3 entries');
    expect(c.message).to.include(UNREADABLE_CEILING_ENV);
  });

  it('accepts zero — a founder may want any unreadable entry to stop the settlement', () => {
    expect(parseUnreadableCeiling('0', 'devnet').ceiling).to.equal(0);
  });

  it('on devnet an unset value is the crank default, printed as such', () => {
    const c = parseUnreadableCeiling(undefined, 'devnet');
    expect(c.ceiling).to.equal(undefined);
    expect(c.message).to.match(/default \(all but one\)/);
    expect(c.message).to.match(/mainnet refuses/);
  });

  it('on mainnet an unset value REFUSES, saying what the number is for', () => {
    expect(() => parseUnreadableCeiling('', 'mainnet')).to.throw(/required on mainnet/);
    expect(() => parseUnreadableCeiling('  ', 'mainnet')).to.throw(/63 entries lost/);
  });

  it('refuses anything that is not a whole number, on any cluster', () => {
    for (const bad of ['three', '-1', '2.5', '1e3', 'NaN']) {
      expect(() => parseUnreadableCeiling(bad, 'devnet'), bad).to.throw(/whole number/);
    }
  });
});

/*
 * The bundle announce (audit 2026-09-11, D-02): a daemon publishing bundles
 * that nobody is told about is a warning on devnet and a refusal on mainnet,
 * never a routine log line.
 */
describe('the bundle announce verdict', () => {
  const on = {
    BLOTTO_INDEXER_ANNOUNCE_URL: 'https://blotto-indexer.fly.dev:8080/bundles',
    BLOTTO_HELIUS_WEBHOOK_SECRET: 's3cret',
    IRYS_UPLOAD_KEY: 'k',
  };

  it('is ON with both variables, naming the URL and never the secret', () => {
    const v = announceVerdict(on, 'mainnet');
    expect(v.on).to.equal(true);
    expect(v.warn).to.equal(false);
    expect(v.refuse).to.equal(false);
    expect(v.message).to.include('https://blotto-indexer.fly.dev:8080/bundles');
    expect(v.message).not.to.include('s3cret');
  });

  it('OFF while publishing is a WARNING on devnet that names the missing variable and the fallback', () => {
    const v = announceVerdict({ ...on, BLOTTO_HELIUS_WEBHOOK_SECRET: '' }, 'devnet');
    expect(v.on).to.equal(false);
    expect(v.warn).to.equal(true);
    expect(v.refuse).to.equal(false);
    expect(v.message).to.include('BLOTTO_HELIUS_WEBHOOK_SECRET');
    expect(v.message).not.to.include('BLOTTO_INDEXER_ANNOUNCE_URL unset');
    expect(v.message).to.match(/archive-backfill/);
    expect(v.message).to.match(/D-02/);
  });

  it('OFF while publishing REFUSES on mainnet', () => {
    const v = announceVerdict({ IRYS_UPLOAD_KEY: 'k' }, 'mainnet');
    expect(v.refuse).to.equal(true);
    expect(v.message).to.include('BLOTTO_INDEXER_ANNOUNCE_URL + BLOTTO_HELIUS_WEBHOOK_SECRET');
    expect(v.message).to.match(/refusing to start/);
  });

  it('OFF with nothing being published is only a fact', () => {
    const v = announceVerdict({}, 'mainnet');
    expect(v.on).to.equal(false);
    expect(v.warn).to.equal(false);
    expect(v.refuse).to.equal(false);
    expect(v.message).to.match(/nothing is published either/);
  });
});
