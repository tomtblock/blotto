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
    await assert.rejects(
      wireSanctions(
        { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: join(tmpdir(), 'does-not-exist.xml') },
        quiet
      ),
      /ENOENT|no such file/
    );
  });

  it('a failed scheduled refresh is logged and the previous list keeps answering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blotto-sdn-'));
    const path = join(dir, 'sdn.xml');
    copyFileSync(FIXTURE, path);
    const ticks: Array<() => void> = [];
    const warnings: string[] = [];
    const wired = await wireSanctions(
      { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: path },
      {
        log: () => undefined,
        warn: (l) => warnings.push(l),
        schedule: (fn) => {
          ticks.push(fn);
          return null;
        },
      }
    );
    assert.equal(ticks.length, 1, 'one refresh was scheduled');

    // The next download is garbage — not the SDN list.
    writeFileSync(path, '<notTheList/>');
    ticks[0]();
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
