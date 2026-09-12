/**
 * The geo path after audit finding B-04: several sources behind one answer,
 * a failure signal that reaches the operator, and a spending ceiling with a
 * reserve the unauthenticated pre-flight cannot touch.
 *
 * Three properties are pinned here, one per module, and a fourth across the
 * service seam:
 *
 *   1. The composite falls through in ORDER and stops at the first answer
 *      (`geo-composite.ts`) — and every failure is a monitor event, with a
 *      spent allowance and a refused key each raising an alert.
 *   2. The budget's two faces share one allowance and the pre-flight face
 *      stops first, so a flood of page views cannot starve issuance
 *      (`geo-budget.ts`).
 *   3. Fail-closed is unchanged: when nothing can answer, `geoVerdict` still
 *      says false and issuance is still refused.
 *   4. `geoVerdict` actually uses the pre-flight face and issuance the
 *      issuance face — the wiring the whole reserve depends on.
 */

import { strict as assert } from 'assert';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import type { Labels, Monitor } from '../../_shared/src/monitor';
import { CompositeGeoLookup, GeoUnavailableError, classifyGeoFailure } from '../src/geo-composite';
import { GeoBudget, GeoBudgetSpentError } from '../src/geo-budget';
import { GeoAuthError, GeoQuotaError } from '../src/geo-iplocate';
import {
  geoVerdict,
  issuePacket,
  type GeoLookup,
  type GeoLookupResult,
  type PacketServiceDeps,
} from '../src/service';
import { loadTerritorySchedule } from '../src/territories';
import { resolve } from 'path';

const TERRITORIES = loadTerritorySchedule(
  resolve(__dirname, '..', '..', '..', 'config', 'territories.json')
);

/** A monitor that remembers everything it was told. */
class RecordingMonitor implements Monitor {
  events: { name: string; labels?: Labels }[] = [];
  alerts: { reason: string; detail: Record<string, unknown> }[] = [];
  recordEvent(name: string, labels?: Labels): void {
    this.events.push({ name, labels });
  }
  reportGauge(): void {}
  alert(reason: string, detail: Record<string, unknown>): void {
    this.alerts.push({ reason, detail });
  }
  count(name: string, labels?: Labels): number {
    return this.events.filter(
      (e) =>
        e.name === name &&
        (labels === undefined ||
          Object.entries(labels).every(([k, v]) => e.labels?.[k] === v))
    ).length;
  }
}

const GB = { country: 'GB', vpnOrProxy: false };
const DE = { country: 'DE', vpnOrProxy: false };

/** A source under test: the lookup, and how often it was actually asked. */
interface CountingSource {
  calls: number;
  lookup: GeoLookup;
}

/** A source that answers with a fixed result and counts its calls. The
 * annotation is load-bearing: the closure reads `src`, and without a declared
 * type the initializer would depend on its own inferred type (TS7022). */
function answering(result: GeoLookupResult): CountingSource {
  const src: CountingSource = {
    calls: 0,
    lookup: {
      lookup: async () => {
        src.calls++;
        return result;
      },
    },
  };
  return src;
}

/** A source that throws the given error and counts its calls. */
function failing(error: Error): CountingSource {
  const src: CountingSource = {
    calls: 0,
    lookup: {
      lookup: async () => {
        src.calls++;
        throw error;
      },
    },
  };
  return src;
}

// Keep the stderr of a run readable: the composite logs each failure.
let restoreError: typeof console.error;
before(() => {
  restoreError = console.error;
  console.error = () => undefined;
});
after(() => {
  console.error = restoreError;
});

describe('CompositeGeoLookup — sources in order, first answer wins', () => {
  it('asks only the first source when it answers, and records nothing', async () => {
    const m = new RecordingMonitor();
    const first = answering(GB);
    const second = answering(DE);
    const geo = new CompositeGeoLookup(
      [
        { name: 'primary', lookup: first.lookup },
        { name: 'secondary', lookup: second.lookup },
      ],
      m
    );
    assert.deepEqual(await geo.lookup('1.2.3.4'), GB);
    assert.equal(first.calls, 1);
    assert.equal(second.calls, 0, 'the fallback costs money; it is not asked for a second opinion');
    assert.equal(m.events.length, 0);
    assert.equal(m.alerts.length, 0);
  });

  it('falls through to the second source when the first is out of credits', async () => {
    const m = new RecordingMonitor();
    const first = failing(new GeoQuotaError(429));
    const second = answering(DE);
    const geo = new CompositeGeoLookup(
      [
        { name: 'primary', lookup: first.lookup },
        { name: 'secondary', lookup: second.lookup },
      ],
      m
    );
    assert.deepEqual(await geo.lookup('1.2.3.4'), DE, 'the second source decides');
    assert.equal(first.calls, 1);
    assert.equal(second.calls, 1);
    // The acceptance test the audit asked for: a quota error is a monitor
    // event, with the bounded reason, and an alert — not a console line.
    assert.equal(m.count(METRIC.packet.geoSourceFailed, { reason: 'quota' }), 1);
    assert.equal(m.count(METRIC.packet.geoFellThrough), 1);
    assert.equal(m.alerts.length, 1);
    assert.equal(m.alerts[0].reason, ALERT.packet.geoQuotaSpent);
    assert.equal(m.alerts[0].detail.source, 'primary');
  });

  it('a refused credential alerts by name, a transient fault only counts', async () => {
    const m = new RecordingMonitor();
    const geo = new CompositeGeoLookup(
      [
        { name: 'primary', lookup: failing(new GeoAuthError(401)).lookup },
        { name: 'secondary', lookup: failing(new Error('geo vendor: HTTP 503')).lookup },
        { name: 'tertiary', lookup: answering(GB).lookup },
      ],
      m
    );
    assert.deepEqual(await geo.lookup('1.2.3.4'), GB);
    assert.equal(m.count(METRIC.packet.geoSourceFailed, { reason: 'credential' }), 1);
    assert.equal(m.count(METRIC.packet.geoSourceFailed, { reason: 'fault' }), 1);
    assert.equal(m.alerts.length, 1, 'only the credential failure pages');
    assert.equal(m.alerts[0].reason, ALERT.packet.geoCredentialRefused);
  });

  it('throws GeoUnavailableError naming every source when none can answer', async () => {
    const m = new RecordingMonitor();
    const geo = new CompositeGeoLookup(
      [
        { name: 'primary', lookup: failing(new GeoQuotaError(429)).lookup },
        { name: 'secondary', lookup: failing(new Error('unreachable')).lookup },
      ],
      m
    );
    await assert.rejects(geo.lookup('1.2.3.4'), (e: unknown) => {
      assert.ok(e instanceof GeoUnavailableError);
      assert.deepEqual(e.failed, ['primary', 'secondary']);
      assert.match(e.message, /primary: geo vendor: QUOTA/);
      assert.match(e.message, /secondary: unreachable/);
      return true;
    });
    assert.equal(m.count(METRIC.packet.geoFellThrough), 0, 'nothing answered, so no fall-through');
    const reasons = m.alerts.map((a) => a.reason);
    assert.ok(reasons.includes(ALERT.packet.geoQuotaSpent));
    assert.ok(reasons.includes(ALERT.packet.geoAllSourcesFailed));
  });

  it('refuses to be built with no sources', () => {
    assert.throws(() => new CompositeGeoLookup([], new RecordingMonitor()), /no sources/);
  });

  it('classifies the four failure kinds as a bounded label', () => {
    assert.equal(classifyGeoFailure(new GeoQuotaError(429)), 'quota');
    assert.equal(classifyGeoFailure(new GeoAuthError(403)), 'credential');
    assert.equal(classifyGeoFailure(new GeoBudgetSpentError('preflight', 5, 5)), 'budget');
    assert.equal(classifyGeoFailure(new Error('anything else')), 'fault');
    assert.equal(classifyGeoFailure('not even an Error'), 'fault');
  });
});

describe('GeoBudget — one allowance, two faces, issuance holds the reserve', () => {
  it('the pre-flight face stops at cap minus reserve; issuance continues to the cap', async () => {
    const m = new RecordingMonitor();
    const inner = answering(GB);
    const budget = new GeoBudget(inner.lookup, { dailyCap: 10, reserve: 4, monitor: m });
    const preflight = budget.forPreflight();
    const issuance = budget.forIssuance();

    // Six page views spend the pre-flight's share…
    for (let i = 0; i < 6; i++) await preflight.lookup(`10.0.0.${i}`);
    assert.equal(budget.used, 6);
    // …and the seventh is refused WITHOUT reaching the vendor.
    await assert.rejects(preflight.lookup('10.0.0.99'), GeoBudgetSpentError);
    assert.equal(inner.calls, 6, 'a refused lookup costs no vendor credit');
    assert.equal(m.count(METRIC.packet.geoBudgetRefused, { purpose: 'preflight' }), 1);

    // Issuance still has its four.
    for (let i = 0; i < 4; i++) await issuance.lookup(`10.1.0.${i}`);
    assert.equal(inner.calls, 10);
    await assert.rejects(issuance.lookup('10.1.0.99'), GeoBudgetSpentError);
    assert.equal(m.count(METRIC.packet.geoBudgetRefused, { purpose: 'issuance' }), 1);
  });

  it('a flood of pre-flights cannot touch what issuance needs', async () => {
    const inner = answering(GB);
    const budget = new GeoBudget(inner.lookup, { dailyCap: 100, reserve: 25 });
    const preflight = budget.forPreflight();
    let refused = 0;
    for (let i = 0; i < 1_000; i++) {
      try {
        await preflight.lookup(`192.0.2.${i}`);
      } catch (e) {
        assert.ok(e instanceof GeoBudgetSpentError);
        refused++;
      }
    }
    assert.equal(refused, 925, 'exactly the reserve is protected');
    assert.equal(inner.calls, 75);
    // The whole reserve is still there for paying entrants.
    for (let i = 0; i < 25; i++) await budget.forIssuance().lookup(`198.51.100.${i}`);
    assert.equal(inner.calls, 100);
  });

  it('the window turns over after its length and the allowance returns', async () => {
    let now = 1_000_000;
    const inner = answering(GB);
    const budget = new GeoBudget(inner.lookup, {
      dailyCap: 2,
      reserve: 0,
      windowMs: 1_000,
      now: () => now,
    });
    const face = budget.forIssuance();
    await face.lookup('a');
    await face.lookup('b');
    await assert.rejects(face.lookup('c'), GeoBudgetSpentError);
    now += 999;
    await assert.rejects(face.lookup('c'), GeoBudgetSpentError, 'not yet');
    now += 1;
    assert.deepEqual(await face.lookup('c'), GB, 'a new window');
    assert.equal(budget.used, 1);
  });

  it('counts a lookup whether or not the vendor answers', async () => {
    const budget = new GeoBudget(failing(new Error('geo vendor: HTTP 503')).lookup, {
      dailyCap: 2,
      reserve: 0,
    });
    const face = budget.forIssuance();
    await assert.rejects(face.lookup('a'), /HTTP 503/);
    await assert.rejects(face.lookup('a'), /HTTP 503/);
    // The third is stopped by us, not by the vendor: a failing vendor is not
    // hammered for the rest of the window.
    await assert.rejects(face.lookup('a'), GeoBudgetSpentError);
    assert.equal(budget.used, 2);
  });

  it('defaults the reserve to a quarter of the cap and rejects a nonsensical one', () => {
    const geo = answering(GB).lookup;
    assert.equal(new GeoBudget(geo, { dailyCap: 1000 }).ceilingFor('preflight'), 750);
    assert.equal(new GeoBudget(geo, { dailyCap: 1000 }).ceilingFor('issuance'), 1000);
    assert.throws(() => new GeoBudget(geo, { dailyCap: 0 }), /positive/);
    assert.throws(() => new GeoBudget(geo, { dailyCap: 10, reserve: 10 }), /between/);
    assert.throws(() => new GeoBudget(geo, { dailyCap: 10, reserve: -1 }), /between/);
  });
});

describe('the service seam — two faces, and fail-closed is unchanged', () => {
  function deps(issuance: GeoLookup, preflight?: GeoLookup): PacketServiceDeps {
    return {
      geo: issuance,
      preflightGeo: preflight,
      sanctions: { isSanctioned: async () => false },
      signer: {
        sign: async () => new Uint8Array(64),
        publicKey: async () => new Uint8Array(32),
      },
      attestations: {
        get: async () => ({ attested18: true, termsVersion: 1, wallet: 'w' }) as never,
        put: async () => undefined,
      } as never,
      config: { territories: TERRITORIES, kycTier: 0, termsVersion: 1, termsUpdated: '2026-01-01' },
      now: () => 0n,
      nonce: () => 0n,
    };
  }

  it('geoVerdict uses the pre-flight face; issuePacket uses the issuance face', async () => {
    const issuance = answering(GB);
    const preflight = answering(GB);
    const d = deps(issuance.lookup, preflight.lookup);

    assert.equal(await geoVerdict(d, '1.2.3.4'), true);
    assert.equal(preflight.calls, 1);
    assert.equal(issuance.calls, 0);

    const issued = await issuePacket(d, { wallet: 'w', pool: 'p', ip: '1.2.3.4' });
    assert.equal(issued.ok, true);
    assert.equal(preflight.calls, 1);
    assert.equal(issuance.calls, 1);
  });

  it('without a pre-flight face, geoVerdict falls back to the issuance lookup', async () => {
    const only = answering(GB);
    assert.equal(await geoVerdict(deps(only.lookup), '1.2.3.4'), true);
    assert.equal(only.calls, 1);
  });

  it('when every source has failed, the pre-flight says false and issuance is refused', async () => {
    const m = new RecordingMonitor();
    const dead = new CompositeGeoLookup(
      [{ name: 'primary', lookup: failing(new GeoQuotaError(429)).lookup }],
      m
    );
    const d = deps(dead, dead);
    assert.equal(await geoVerdict(d, '1.2.3.4'), false, 'fail-closed, as before');
    const issued = await issuePacket(d, { wallet: 'w', pool: 'p', ip: '1.2.3.4' });
    assert.equal(issued.ok, false, 'no packet without a territory answer');
    // And this time the operator hears about it.
    assert.ok(m.alerts.some((a) => a.reason === ALERT.packet.geoQuotaSpent));
    assert.ok(m.alerts.some((a) => a.reason === ALERT.packet.geoAllSourcesFailed));
  });

  it('a spent pre-flight allowance says false while issuance still answers', async () => {
    const inner = answering(GB);
    const budget = new GeoBudget(inner.lookup, { dailyCap: 2, reserve: 1 });
    const d = deps(budget.forIssuance(), budget.forPreflight());
    assert.equal(await geoVerdict(d, '1.2.3.4'), true);
    assert.equal(await geoVerdict(d, '5.6.7.8'), false, 'the pre-flight share is one lookup');
    const issued = await issuePacket(d, { wallet: 'w', pool: 'p', ip: '5.6.7.8' });
    assert.equal(issued.ok, true, 'the reserve carried the entrant through');
  });
});
