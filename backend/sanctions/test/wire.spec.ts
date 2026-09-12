/**
 * The boot-time wiring: the retried mirror load (audit 2026-09-11, C-18) and
 * the staleness watch (B-28).
 *
 * Both are about the same 36-hour window. The mirror answers only while it is
 * younger than `SANCTIONS_OFAC_MAX_AGE_HOURS`; loading it is a ~29 MB
 * download from a government host in a required boot path, and in the staged
 * production config it is the only assured source. So the two failure modes
 * that matter are "it would not load at boot" — which crash-looped both
 * services on one unlucky restart — and "it quietly aged out", which stopped
 * entry and held every payment while announcing itself on standard output.
 *
 * Everything here runs offline: the mirror is driven through a local file
 * path or a structural fake, and every clock, sleep and schedule is injected.
 */

import { expect } from 'chai';
import { join } from 'path';
import { tmpdir } from 'os';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import { OfacSdnMirror } from '../src/ofac-sdn';
import {
  OFAC_RECOVERY_INTERVAL_MS,
  OFAC_STALE_SOON_FRACTION,
  loadMirrorAtBoot,
  makeStalenessWatch,
  ofacRefreshIntervalMs,
  ofacStalenessCheckIntervalMs,
  wireScreening,
} from '../src/wire';

const FIXTURE = join(__dirname, '..', 'fixtures', 'ofac-sdn-excerpt.xml');
const MISSING = join(tmpdir(), 'blotto-no-such-sdn.xml');
const HOUR = 3_600_000;

interface Recorded {
  events: Array<{ name: string; labels?: Record<string, string> }>;
  gauges: Array<{ name: string; value: number }>;
  alerts: Array<{ reason: string; detail: Record<string, unknown> }>;
}

function recorder(): { monitor: Monitor; seen: Recorded } {
  const seen: Recorded = { events: [], gauges: [], alerts: [] };
  return {
    seen,
    monitor: {
      recordEvent: (name, labels) => seen.events.push({ name, labels }),
      reportGauge: (name, value) => seen.gauges.push({ name, value }),
      alert: (reason, detail) => seen.alerts.push({ reason, detail }),
    },
  };
}

const quiet = { log: () => undefined, warn: () => undefined };
/** Boot policy with no real waiting anywhere. */
const fastBoot = { attempts: 3, backoffMs: 1, sleep: async () => undefined, random: () => 0 };

// ---------------------------------------------------------------------------
// C-18 — the boot load is retried
// ---------------------------------------------------------------------------

describe('loadMirrorAtBoot — a blip at restart is not a crash loop (C-18)', () => {
  /** A mirror-shaped fake: fails `failures` times, then answers. */
  function flaky(failures: number, record?: number[]): OfacSdnMirror {
    let calls = 0;
    return {
      maxAgeMs: 36 * HOUR,
      async refresh(opts: { timeoutMs?: number } = {}) {
        calls++;
        record?.push(opts.timeoutMs ?? -1);
        if (calls <= failures) throw new Error(`ofac-sdn: HTTP 503 (attempt ${calls})`);
        return { publishDate: '09/11/2026', entries: 2, addresses: 1, loadedAt: new Date() };
      },
    } as unknown as OfacSdnMirror;
  }

  it('REGRESSION: two failed attempts no longer end the boot — the third loads', async () => {
    const result = await loadMirrorAtBoot(flaky(2), fastBoot);
    expect(result.snapshot, 'the mirror loaded').to.not.equal(null);
    expect(result.attempts).to.equal(3);
    expect(result.error).to.equal(undefined);
  });

  it('gives up after `attempts` and reports the last failure rather than throwing', async () => {
    const result = await loadMirrorAtBoot(flaky(99), { ...fastBoot, attempts: 2 });
    expect(result.snapshot).to.equal(null);
    expect(result.attempts).to.equal(2);
    expect(result.error?.message).to.match(/HTTP 503 \(attempt 2\)/);
  });

  /** A mirror whose every attempt burns `spendMs` of the injected clock. */
  function slow(spendMs: number, clock: { t: number }, timeouts: number[]): OfacSdnMirror {
    return {
      maxAgeMs: 36 * HOUR,
      async refresh(opts: { timeoutMs?: number } = {}) {
        timeouts.push(opts.timeoutMs ?? -1);
        clock.t += spendMs;
        throw new Error('ofac-sdn: HTTP 503');
      },
    } as unknown as OfacSdnMirror;
  }

  it('each attempt gets what is LEFT of the budget, so three cannot become three downloads', async () => {
    const timeouts: number[] = [];
    const clock = { t: 1_000 };
    await loadMirrorAtBoot(slow(20_000, clock, timeouts), {
      ...fastBoot,
      attempts: 3,
      budgetMs: 90_000,
      now: () => clock.t,
    });
    expect(timeouts).to.deep.equal([90_000, 70_000, 50_000]);
    expect(
      timeouts.reduce((a, b) => a + b, 0),
      'a per-attempt timeout would allow 270 s inside a 90 s budget'
    ).to.be.greaterThan(90_000);
  });

  it('stops when the budget is spent even with attempts left', async () => {
    const timeouts: number[] = [];
    const clock = { t: 0 };
    const result = await loadMirrorAtBoot(slow(6_000, clock, timeouts), {
      ...fastBoot,
      attempts: 9,
      budgetMs: 10_000,
      now: () => clock.t,
    });
    expect(result.snapshot).to.equal(null);
    expect(timeouts.length, 'the budget bound, not the attempt bound').to.equal(2);
    expect(result.error, 'the reason is kept, whichever bound ran out').to.not.equal(undefined);
  });
});

describe('wireScreening — what happens when the mirror ultimately will not load', () => {
  it('MIRROR ONLY: refuses to start, names the remedy, and alerts', async () => {
    const { monitor, seen } = recorder();
    let message = '';
    try {
      await wireScreening(
        { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: MISSING },
        'packet',
        { ...quiet, monitor, boot: { ...fastBoot, attempts: 2 }, schedule: () => null }
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/only configured screening source/);
    expect(message, 'the operator is told what to do next').to.match(
      /SANCTIONS_OFAC_SDN_PATH to a local copy/
    );
    const alert = seen.alerts.find((a) => a.reason === ALERT.sanctions.ofacBootFailed);
    expect(alert, 'the refusal is alerted, not only thrown').to.not.equal(undefined);
    expect(alert!.detail.started).to.equal(false);
  });

  it('A VENDOR BESIDE IT: starts screening on the vendor, loudly, instead of crash-looping', async () => {
    const { monitor, seen } = recorder();
    const warnings: string[] = [];
    const wired = await wireScreening(
      {
        SANCTIONS_CHAINALYSIS_API_KEY: 'k-not-used-offline',
        SANCTIONS_OFAC_SDN: '1',
        SANCTIONS_OFAC_SDN_PATH: MISSING,
      },
      'packet',
      {
        log: () => undefined,
        warn: (l) => warnings.push(l),
        monitor,
        boot: { ...fastBoot, attempts: 2 },
        schedule: () => null,
      }
    );
    expect(wired.ofacLoaded, 'the health payload must be able to say the fallback is absent').to.equal(
      false
    );
    expect(wired.describe.join(' ')).to.match(/chainalysis/);
    const alert = seen.alerts.find((a) => a.reason === ALERT.sanctions.ofacBootFailed);
    expect(alert!.detail.started).to.equal(true);
    expect(alert!.detail.screeningOn).to.deep.equal(['chainalysis']);
    expect(warnings.some((w) => /fallback is absent/.test(w))).to.equal(true);
    wired.stop();
  });

  it('retries a never-loaded mirror every ten minutes, not every nine hours', async () => {
    const armed: Array<{ ms: number; fn: () => void }> = [];
    const wired = await wireScreening(
      {
        SANCTIONS_CHAINALYSIS_API_KEY: 'k-not-used-offline',
        SANCTIONS_OFAC_SDN: '1',
        SANCTIONS_OFAC_SDN_PATH: MISSING,
      },
      'packet',
      {
        ...quiet,
        monitor: recorder().monitor,
        boot: { ...fastBoot, attempts: 1 },
        schedule: (fn, ms) => {
          armed.push({ ms, fn });
          return null;
        },
      }
    );
    const refresh = armed[0];
    expect(refresh.ms, 'the recovery cadence, not the 9 h refresh one').to.equal(
      OFAC_RECOVERY_INTERVAL_MS
    );
    expect(refresh.ms).to.be.lessThan(ofacRefreshIntervalMs(36 * HOUR));
    wired.stop();
  });

  it('a recovered mirror goes back to the ordinary refresh cadence', async () => {
    const armed: Array<{ ms: number; fn: () => void }> = [];
    const logs: string[] = [];
    // The file is missing at boot and present at the first recovery tick.
    const env = { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: MISSING };
    const wired = await wireScreening({ ...env, SANCTIONS_CHAINALYSIS_API_KEY: 'k' }, 'packet', {
      log: (l) => logs.push(l),
      warn: () => undefined,
      monitor: recorder().monitor,
      boot: { ...fastBoot, attempts: 1 },
      schedule: (fn, ms) => {
        armed.push({ ms, fn });
        return null;
      },
    });
    // Point the mirror at the real fixture and run the recovery tick.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wired.ofac as unknown as { o: { path: string } }).o.path = FIXTURE;
    armed[0].fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(wired.ofacLoaded).to.equal(true);
    expect(logs.some((l) => /RECOVERED/.test(l))).to.equal(true);
    const rearmed = armed[armed.length - 1];
    expect(rearmed.ms).to.equal(ofacRefreshIntervalMs(36 * HOUR));
    wired.stop();
  });

  it('a mirror that loads first time behaves exactly as before', async () => {
    const logs: string[] = [];
    const wired = await wireScreening(
      { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: FIXTURE },
      'packet',
      { log: (l) => logs.push(l), warn: () => undefined, schedule: () => null, boot: fastBoot }
    );
    expect(wired.ofacLoaded).to.equal(true);
    expect(logs.some((l) => /ofac-sdn mirror loaded — \d+ entries/.test(l))).to.equal(true);
    expect(logs.some((l) => /after \d+ attempts/.test(l)), 'no retry noise on a clean boot').to.equal(
      false
    );
    wired.stop();
  });
});

// ---------------------------------------------------------------------------
// B-28 — the staleness cliff is announced to something that can page
// ---------------------------------------------------------------------------

describe('the staleness watch (B-28)', () => {
  /** A mirror-shaped fake whose age the test sets directly. */
  function aged(ageMs: number | null, maxAgeMs = 36 * HOUR): OfacSdnMirror {
    return { maxAgeMs, ageMs: () => ageMs } as unknown as OfacSdnMirror;
  }

  it('says nothing while the mirror is fresh, but still reports the age', () => {
    const { monitor, seen } = recorder();
    makeStalenessWatch(aged(4 * HOUR), 'packet', monitor, () => undefined)();
    expect(seen.alerts).to.deep.equal([]);
    expect(seen.gauges).to.deep.equal([{ name: METRIC.sanctions.ofacAgeHours, value: 4 }]);
  });

  it('alerts ONCE on the approach — three consecutive failed refreshes, not one', () => {
    const { monitor, seen } = recorder();
    const warnings: string[] = [];
    const watch = makeStalenessWatch(aged(27 * HOUR), 'packet', monitor, (l) => warnings.push(l));
    watch();
    watch();
    watch();
    const approaching = seen.alerts.filter((a) => a.reason === ALERT.sanctions.ofacStaleSoon);
    expect(approaching.length, 'hourly repeats of an actionable-but-not-urgent alert teach muting').to.equal(1);
    expect(approaching[0].detail).to.include({ ageHours: 27, limitHours: 36, hoursLeft: 9 });
    expect(warnings[0]).to.match(/9 h left to fix it/);
    // 27 h is exactly the documented fraction of the 36 h window.
    expect(27 * HOUR).to.equal(36 * HOUR * OFAC_STALE_SOON_FRACTION);
  });

  it('alerts EVERY time once the limit has passed — the gate is shut until someone acts', () => {
    const { monitor, seen } = recorder();
    const watch = makeStalenessWatch(aged(40 * HOUR), 'packet', monitor, () => undefined);
    watch();
    watch();
    const past = seen.alerts.filter((a) => a.reason === ALERT.sanctions.ofacStale);
    expect(past.length).to.equal(2);
    expect(past[0].detail.consequence).to.match(/refuses every screening/);
  });

  it('re-arms the approach alert after a recovery, so the next slide is announced too', () => {
    const { monitor, seen } = recorder();
    let age = 30 * HOUR;
    const watch = makeStalenessWatch(
      { maxAgeMs: 36 * HOUR, ageMs: () => age } as unknown as OfacSdnMirror,
      'packet',
      monitor,
      () => undefined
    );
    watch(); // approaching → alert 1
    age = 1 * HOUR;
    watch(); // a refresh landed; back to healthy
    age = 30 * HOUR;
    watch(); // approaching again → alert 2
    expect(seen.alerts.filter((a) => a.reason === ALERT.sanctions.ofacStaleSoon).length).to.equal(2);
  });

  it('says nothing at all about a mirror that has never loaded (the boot path owns that)', () => {
    const { monitor, seen } = recorder();
    makeStalenessWatch(aged(null), 'packet', monitor, () => undefined)();
    expect(seen.alerts).to.deep.equal([]);
    expect(seen.gauges).to.deep.equal([]);
  });

  it('looks at the age nine times per refresh, and at least hourly', () => {
    expect(ofacStalenessCheckIntervalMs(36 * HOUR)).to.equal(HOUR);
    expect(ofacStalenessCheckIntervalMs(9 * HOUR)).to.equal(15 * 60_000);
    expect(ofacStalenessCheckIntervalMs(1_000)).to.equal(60_000);
  });

  it('is armed by wireScreening beside the refresh, and stopped with it', async () => {
    const armed: number[] = [];
    const wired = await wireScreening(
      { SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_SDN_PATH: FIXTURE },
      'daemon',
      {
        ...quiet,
        boot: fastBoot,
        schedule: (_fn, ms) => {
          armed.push(ms);
          return null;
        },
      }
    );
    expect(armed).to.deep.equal([ofacRefreshIntervalMs(36 * HOUR), ofacStalenessCheckIntervalMs(36 * HOUR)]);
    wired.stop();
  });
});
