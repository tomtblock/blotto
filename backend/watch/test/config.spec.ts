import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG_PATH, loadEnv, SHAPE, solToLamports, lamportsToSol, validateWatchConfig } from '../src/config';

const ROOT = path.resolve(__dirname, '../../..');
const raw = (): Record<string, any> => JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));

/** Every dotted key path in the shape, e.g. `daemon.tickStaleSeconds`. */
function keys(shape: Record<string, unknown>, at = ''): string[] {
  return Object.entries(shape).flatMap(([k, v]) => (typeof v === 'object' ? keys(v as Record<string, unknown>, `${at}${k}.`) : [`${at}${k}`]));
}

describe('config/watch.json', () => {
  it('validates as committed', () => {
    expect(() => validateWatchConfig(raw())).not.to.throw();
  });

  it('refuses a missing key, an unknown key and a float amount — listing every problem at once', () => {
    const bad = raw();
    delete bad.loop.intervalSeconds;
    bad.loop.surprise = 1;
    bad.daemon.settlementFloorLamports = 0.2;
    expect(() => validateWatchConfig(bad))
      .to.throw(/loop\.intervalSeconds is missing/)
      .and.to.match(/loop\.surprise is not a known setting/)
      .and.to.match(/settlementFloorLamports must be a whole number of lamports/);
  });

  it('documents every key in config/watch.README.md', () => {
    const legend = fs.readFileSync(path.join(ROOT, 'config/watch.README.md'), 'utf8');
    for (const k of keys(SHAPE)) expect(legend, k).to.contain(`\`${k}\``);
  });

  it('gives each service longer than its Fly grace period before calling it down', () => {
    const cfg = validateWatchConfig(raw());
    for (const app of cfg.services.apps) {
      const toml = fs.readFileSync(path.join(ROOT, `deploy/fly/${app.replace('blotto-', '')}.fly.toml`), 'utf8');
      const grace = /\[\[http_service\.checks\]\][\s\S]*?grace_period = "(\d+)s"/.exec(toml);
      expect(grace, `${app} grace period`).to.not.equal(null);
      const waitS = cfg.services.failuresToAlert[app] * cfg.loop.intervalSeconds;
      expect(waitS, app).to.be.greaterThan(Number(grace![1]));
    }
  });

  it('scrapes the port every service serves its private metrics on', () => {
    const cfg = validateWatchConfig(raw());
    for (const app of cfg.services.apps) {
      const toml = fs.readFileSync(path.join(ROOT, `deploy/fly/${app.replace('blotto-', '')}.fly.toml`), 'utf8');
      expect(toml, app).to.contain(`BLOTTO_METRICS_PORT = "${cfg.alerts.metricsPort}"`);
    }
  });

  it('watches only lanes that exist, and never app-lighthouse (red by design, D-E12)', () => {
    const cfg = validateWatchConfig(raw());
    for (const wf of cfg.lanes.watched) expect(fs.existsSync(path.join(ROOT, '.github/workflows', wf)), wf).to.equal(true);
    expect(cfg.lanes.watched).not.to.include('app-lighthouse.yml');
  });
});

describe('amounts and the environment', () => {
  it('converts SOL and lamports with integers only', () => {
    expect(solToLamports('9.196024324')).to.equal(9_196_024_324n);
    expect(lamportsToSol(200_000_000n)).to.equal('0.2');
    expect(() => solToLamports('1e9')).to.throw();
  });

  it('refuses to start without Telegram credentials unless a dry run is asked for', () => {
    expect(() => loadEnv({})).to.throw(/TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required/);
    expect(loadEnv({ WATCH_DRY_RUN: '1' }).dryRun).to.equal(true);
    const e = loadEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '-1' });
    expect(e.chainRpcUrl).to.equal('https://api.devnet.solana.com');
    expect(e.githubToken).to.equal(null);
  });
});
