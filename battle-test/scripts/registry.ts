/**
 * Build `registry/wallets.json` — the roster (manual §5.2).
 *
 * ADDRESSES ONLY. No secret material is written here or ever committed; the
 * keypairs live under `battle-test/keys/` (gitignored) and are re-derived from
 * the founder's master seed by `keys.ts`.
 *
 * The UI wallets are added by `--ui <id>:<address>[:<deviceGroup>]` once the
 * founder reports them, so the roster is built by tooling rather than by hand.
 *
 * Run:
 *   BLOTTO_BT_SEED=<hex> npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' battle-test/scripts/registry.ts \
 *     [--ui UI-A:<addr>:device-1] [--ui UI-B:<addr>:device-2] [--ui UI-C:<addr>:device-3]
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { deriveAll, masterFromEnv, WALLET_COUNT } from './keys';

const OUT = resolve(__dirname, '..', 'registry', 'wallets.json');
const TERMS_VERSION = 2; // config/terms.json, updated 2026-09-06

interface Wallet {
  id: string;
  kind: 'headless' | 'ui';
  keypair?: string;
  address: string;
  deviceGroup?: string;
  termsVersion?: number;
  notes: string;
  history: unknown[];
}

function main(): void {
  const { funder, wallets } = deriveAll(masterFromEnv());

  const uiArgs: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ui') {
      const v = argv[i + 1];
      if (!v) throw new Error('--ui needs <id>:<address>[:<deviceGroup>]');
      uiArgs.push(v);
      i++;
    }
  }

  // Preserve any history already recorded, so rebuilding the roster never
  // discards what reconcile.ts appended.
  const previous: Record<string, unknown[]> = {};
  const previousUi: Wallet[] = [];
  if (existsSync(OUT)) {
    const old = JSON.parse(readFileSync(OUT, 'utf8')) as { wallets: Wallet[] };
    for (const w of old.wallets) {
      if (w.history?.length) previous[w.id] = w.history;
      if (w.kind === 'ui') previousUi.push(w);
    }
  }

  const rows: Wallet[] = wallets.map((w, i) => ({
    id: `W${String(i).padStart(2, '0')}`,
    kind: 'headless',
    keypair: `battle-test/keys/wallets/${String(i).padStart(2, '0')}.json`,
    address: w.publicKey.toBase58(),
    notes: i >= 64 ? 'reserved for the T6 rejected-entry set' : '',
    history: previous[`W${String(i).padStart(2, '0')}`] ?? [],
  }));

  const ui: Wallet[] = uiArgs.length > 0
    ? uiArgs.map((spec) => {
        const [id, address, deviceGroup] = spec.split(':');
        if (!id || !address) throw new Error(`malformed --ui: ${spec}`);
        return {
          id,
          kind: 'ui' as const,
          address,
          deviceGroup: deviceGroup ?? `device-${id.slice(-1).toLowerCase()}`,
          termsVersion: TERMS_VERSION,
          notes: 'browser profile; embedded wallet created at social login',
          history: previous[id] ?? [],
        };
      })
    : previousUi;

  const doc = {
    schema: 'blotto-rehearsal-wallets/1',
    cluster: 'devnet',
    programId: '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17',
    generatedAt: new Date().toISOString(),
    derivation: 'HMAC-SHA256(master, "blotto-battle-test/v1/" + label); see scripts/keys.ts',
    funder: funder.publicKey.toBase58(),
    termsVersion: TERMS_VERSION,
    walletCount: WALLET_COUNT,
    wallets: [...rows, ...ui],
  };

  writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${OUT} — ${rows.length} headless, ${ui.length} ui, funder ${doc.funder}`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
