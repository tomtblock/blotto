/**
 * The sanctions WIRING (Phase 2, Stage B) — not the adapters, which have
 * their own suites under backend/sanctions/test. What is pinned here is the
 * property the rules page and the audit care about: a wallet on a published
 * sanctions list is refused a packet by THIS service, through `issuePacket`
 * itself, against real OFAC data; and a deployment that has no screener
 * configured does not start, so a packet is never issued unscreened.
 *
 * Until 2026-09-07 `main.ts` wired this seam to `async () => false`. The
 * first test is that state, and it must fail closed.
 */

import { strict as assert } from 'assert';
import { copyFileSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_TERRITORY_SCHEDULE,
  GENERIC_REJECTION,
  LocalPacketSigner,
  MemoryAttestationStore,
  issuePacket,
  type PacketServiceDeps,
  type SanctionsList,
} from '../src';
import { base58Encode } from '../src/shared';
import { ofacRefreshIntervalMs, wireSanctions } from '../src/sanctions-wiring';
import { MemorySanctionsRefusalLog } from '../../sanctions/src/refusal-log';
import { ALERT } from '../../_shared/src/metrics';
import { short } from '../../_shared/src/short';

/** The verbatim SDN excerpt the sanctions package tests against. */
const FIXTURE = join(__dirname, '..', '..', 'sanctions', 'fixtures', 'ofac-sdn-excerpt.xml');
/** The one `Digital Currency Address - SOL` in that excerpt. */
const LISTED_SOL = '42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi';
const CLEAN = base58Encode(new Uint8Array(32).fill(3));
const POOL = base58Encode(new Uint8Array(32).fill(4));

/** Deps identical to packet.spec's, except for the screener under test. */
function depsWith(sanctions: SanctionsList): PacketServiceDeps {
  const attestations = new MemoryAttestationStore();
  for (const wallet of [LISTED_SOL, CLEAN]) {
    void attestations.put({
      wallet,
      termsVersion: 1,
      attested18: true,
      timestamp: 1_756_000_000n,
      walletSignature: 'dGVzdA==',
    });
  }
  return {
    geo: { async lookup() { return { country: 'GB', vpnOrProxy: false }; } },
    sanctions,
    signer: new LocalPacketSigner(new Uint8Array(32).fill(7)),
    attestations,
    config: { territories: DEFAULT_TERRITORY_SCHEDULE, kycTier: 0, termsVersion: 1, termsUpdated: '2026-09-06' },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

const request = (wallet: string) => ({ wallet, pool: POOL, ip: '203.0.113.7' });
const quiet = { log: () => undefined, warn: () => undefined, schedule: () => null };

describe('sanctions wiring (packet service)', () => {
  it('REGRESSION: nothing configured refuses to start — a packet is never issued unscreened', async () => {
    await assert.rejects(wireSanctions({}, quiet), /no sanctions screener configured/);
  });

  it('the dev stub refuses to start without its explicit opt-in', async () => {
    await assert.rejects(
      wireSanctions({ SANCTIONS_STUB_LISTED: '' }, quiet),
      /ALLOW_STUB_SANCTIONS=1/
    );
  });

  it('the dev stub, opted in, refuses the wallets it names and admits the rest', async () => {
    const wired = await wireSanctions(
      { SANCTIONS_STUB_LISTED: LISTED_SOL, ALLOW_STUB_SANCTIONS: '1' },
      quiet
    );
    const deps = depsWith(wired.list);
    assert.deepEqual(await issuePacket(deps, request(LISTED_SOL)), GENERIC_REJECTION);
    assert.equal((await issuePacket(deps, request(CLEAN))).ok, true);
    wired.stop();
  });

  it('the OFAC mirror: an SDN-listed SOL address is refused a packet; a clean wallet is issued one', async () => {
    const lines: string[] = [];
    const wired = await wireSanctions(
      { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: FIXTURE },
      { ...quiet, log: (l) => lines.push(l) }
    );
    assert.ok(wired.ofac, 'the mirror is exposed for health');
    assert.match(wired.describe.join(' '), /ofac-sdn mirror/);
    assert.ok(lines.some((l) => /ofac-sdn mirror loaded — \d+ entries, \d+ digital-currency addresses/.test(l)));

    const deps = depsWith(wired.list);
    const refused = await issuePacket(deps, request(LISTED_SOL));
    assert.deepEqual(refused, GENERIC_REJECTION, 'the listed address gets the generic rejection');
    const issued = await issuePacket(deps, request(CLEAN));
    assert.equal(issued.ok, true, 'a clean wallet still enters');
    wired.stop();
  });

  it('a mirror that cannot load refuses to start rather than answering "clean"', async () => {
    // The boot load is retried since 2026-09-12 (audit C-18) — the retry
    // POLICY is pinned in sanctions/test/wire.spec.ts; here it is only made
    // cheap, so this suite does not spend ten seconds proving backoff twice.
    await assert.rejects(
      wireSanctions(
        { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: join(tmpdir(), 'does-not-exist.xml') },
        { ...quiet, boot: { attempts: 2, backoffMs: 1 } }
      ),
      /only configured screening source/
    );
  });

  it('a failed scheduled refresh is logged and the previous list keeps answering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blotto-sdn-'));
    const path = join(dir, 'sdn.xml');
    copyFileSync(FIXTURE, path);
    const ticks: Array<{ fn: () => void; ms: number }> = [];
    const warnings: string[] = [];
    const wired = await wireSanctions(
      { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: path },
      {
        log: () => undefined,
        warn: (l) => warnings.push(l),
        schedule: (fn, ms) => {
          ticks.push({ fn, ms });
          return null;
        },
      }
    );
    // Two schedules since 2026-09-12 (audit B-28): the refresh, and the
    // staleness watch that alerts as the mirror approaches its max age.
    assert.equal(ticks.length, 2, 'a refresh and a staleness watch were scheduled');
    assert.equal(ticks[0].ms, 9 * 3_600_000, 'the refresh is a quarter of the max age');
    assert.equal(ticks[1].ms, 3_600_000, 'the age is looked at hourly');

    // The next download is garbage — not the SDN list.
    writeFileSync(path, '<notTheList/>');
    ticks[0].fn();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(
      warnings.some((w) => /ofac-sdn mirror refresh FAILED \(previous list kept/.test(w)),
      `expected a refresh warning, got: ${warnings.join(' | ')}`
    );
    // Still deciding from the list loaded at boot.
    const deps = depsWith(wired.list);
    assert.deepEqual(await issuePacket(deps, request(LISTED_SOL)), GENERIC_REJECTION);
    wired.stop();
  });

  it('refreshes at a quarter of the max age, never faster than once a minute', () => {
    assert.equal(ofacRefreshIntervalMs(36 * 3_600_000), 9 * 3_600_000);
    assert.equal(ofacRefreshIntervalMs(1_000), 60_000);
  });
});

/**
 * The refusal RECORD (audit 2026-09-11, B-36).
 *
 * A refused entry is the one event a regulator asks about by name, and until
 * 2026-09-12 it left one line of standard output — no wallet, no list, no
 * row anywhere. These tests run the whole path: the real SDN excerpt, the
 * real wiring, `issuePacket` itself, and the log the wiring attaches.
 */
describe('a sanctions refusal is written down (B-36)', () => {
  const ofacEnv = { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: FIXTURE };

  it('records the wallet, the pool, the list that matched, and when', async () => {
    const refusals = new MemorySanctionsRefusalLog();
    const wired = await wireSanctions(ofacEnv, { ...quiet, refusals });
    const deps = depsWith(wired.list);

    assert.deepEqual(await issuePacket(deps, request(LISTED_SOL)), GENERIC_REJECTION);
    assert.equal(refusals.records.length, 1, 'the refusal was persisted');
    const r = refusals.records[0];
    assert.equal(r.service, 'packet');
    assert.equal(r.wallet, LISTED_SOL, 'WHICH wallet — the subject of the decision');
    assert.equal(r.pool, POOL, 'and which entry it was');
    assert.equal(r.matches.length, 1, 'WHICH list matched');
    assert.equal(r.matches[0].source, 'ofac-sdn');
    assert.match(r.matches[0].listName, /\w/, 'the programme, as the source names it');
    assert.match(r.matches[0].entityName, /\w/, 'and the party it named');
    assert.deepEqual(r.consulted, ['ofac-sdn']);
    assert.deepEqual(r.failed, [], 'a refusal decided on one source with others down is legible');
    assert.match(r.screenedAt, /^\d{4}-\d{2}-\d{2}T/, 'WHEN, from the screener');
    assert.equal(r.country, 'GB', 'the geo input to the same decision');
    wired.stop();
  });

  it('keeps the IP truncated exactly as the log does — no wider than the log', async () => {
    const refusals = new MemorySanctionsRefusalLog();
    const wired = await wireSanctions(ofacEnv, { ...quiet, refusals });
    await issuePacket(depsWith(wired.list), { wallet: LISTED_SOL, pool: POOL, ip: '203.0.113.7' });
    assert.equal(refusals.records[0].ipPrefix, '203.0.x.x');
    assert.ok(
      !JSON.stringify(refusals.records[0]).includes('113.7'),
      'the remaining octets are not collected: nothing in the decision reads them'
    );
    wired.stop();
  });

  it('records NOTHING for an entry refused by anything other than a sanctions match', async () => {
    const refusals = new MemorySanctionsRefusalLog();
    const wired = await wireSanctions(ofacEnv, { ...quiet, refusals });
    const deps: PacketServiceDeps = {
      ...depsWith(wired.list),
      // Belgium: refused by the territory schedule, screened clean.
      geo: { async lookup() { return { country: 'BE', vpnOrProxy: false }; } },
    };
    assert.deepEqual(await issuePacket(deps, request(CLEAN)), GENERIC_REJECTION);
    assert.equal(refusals.records.length, 0, 'this table is not a general request log');
    wired.stop();
  });

  it('a store that will not write cannot change the answer, and pages — without reprinting the record', async () => {
    // Rewritten in place on 2026-09-16 under the founder's data-minimisation
    // ruling of 2026-09-15. Until then this case asserted that a failed
    // insert "shouted the record": the whole refusal — wallet, matches, the
    // listed party's name — dumped into standard output as the fallback
    // evidence. A log stream is the wrong place for a second, unbounded
    // copy of a wallet. The failure is now named with TRUNCATED identifiers
    // and raised as an alert, so the operator learns the record is missing
    // from a page rather than from a grep.
    const broken = {
      async record(): Promise<void> {
        throw new Error('connection refused');
      },
    };
    const wired = await wireSanctions(ofacEnv, { ...quiet, refusals: broken });
    const errors: string[] = [];
    const warnings: string[] = [];
    const alerts: { reason: string; detail: Record<string, unknown> }[] = [];
    const monitor = {
      recordEvent: () => undefined,
      reportGauge: () => undefined,
      alert: (reason: string, detail: Record<string, unknown>) => void alerts.push({ reason, detail }),
    };
    const realError = console.error;
    const realWarn = console.warn;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      assert.deepEqual(
        await issuePacket({ ...depsWith(wired.list), monitor }, request(LISTED_SOL)),
        GENERIC_REJECTION,
        'still refused — the record is evidence, never a gate'
      );
    } finally {
      console.error = realError;
      console.warn = realWarn;
    }
    const failure = errors.find((e) => /FAILED to persist a sanctions refusal/.test(e));
    assert.ok(failure, `expected the failure named in the log, got: ${errors.join(' | ')}`);
    assert.ok(failure.includes(short(LISTED_SOL)), 'the truncated wallet is enough to find the row');
    for (const line of [...errors, ...warnings]) {
      assert.ok(!line.includes(LISTED_SOL), `a whole wallet reached the log: ${line}`);
    }
    assert.deepEqual(
      alerts.map((a) => a.reason),
      [ALERT.packet.sanctionsRefusalUnrecorded],
      'the missing record pages'
    );
    assert.equal(alerts[0].detail.wallet, short(LISTED_SOL));
    assert.ok(!JSON.stringify(alerts[0].detail).includes(LISTED_SOL), 'nor does the alert');
    wired.stop();
  });

  it('a seam that offers only the boolean still refuses, and still leaves a record', async () => {
    // Every pre-existing test double is this shape; the richer screening is
    // optional on purpose.
    const refusals = new MemorySanctionsRefusalLog();
    const deps = depsWith({
      isSanctioned: async (wallet: string) => wallet === LISTED_SOL,
      recordRefusal: async (refusal) => {
        await refusals.record({
          service: 'packet',
          wallet: refusal.wallet,
          pool: refusal.pool,
          screenedAt: refusal.screening.checkedAt,
          matches: [],
          consulted: [],
          failed: [],
          country: refusal.country,
          ipPrefix: refusal.ipPrefix,
        });
      },
    });
    assert.deepEqual(await issuePacket(deps, request(LISTED_SOL)), GENERIC_REJECTION);
    assert.equal(refusals.records.length, 1);
    assert.equal(refusals.records[0].matches.length, 0, 'no list name is knowable from a boolean');
  });
});
