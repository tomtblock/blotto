/**
 * The settlement daemon's deployment entry (E5): env → deps → run loop +
 * health endpoint. Wires the PRODUCTION adapters end to end — Web3Chain,
 * Turnkey custody over the durable PG key store, the PG ciphertext store,
 * the Irys publisher, and the R11 detection pipeline — and refuses loudly
 * when a credentialed seam is unconfigured.
 *
 *   BLOTTO_DAEMON_INTERVAL_MS    default 15000
 *   BLOTTO_DAEMON_HEALTH_PORT    default 8084 (GET /health: last tick)
 *   BLOTTO_RPC_URL               default devnet
 *   BLOTTO_PROGRAM_ID            default the declared id
 *   BLOTTO_DATABASE_URL          Postgres (ciphertexts + published pool keys)
 *   SETTLEMENT_SIGNER_KEYPAIR    path to the settlement keypair JSON
 *   RANDOMNESS_ACCOUNT           the Switchboard Randomness account (base58)
 *   TURNKEY_API_BASE_URL/_PUBLIC_KEY/_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID,
 *   TURNKEY_USER_ID              pool-key custody (R21)
 *   IRYS_UPLOAD_KEY, IRYS_NETWORK  bundle publishing
 *
 * Two seams stay open, on the record (docs/hosting.md):
 *   - the Switchboard REVEAL instruction (chain-web3's `makeVrfRevealIx`)
 *     is C11 vendor work — until it lands, `commit_vrf_seed` errors are
 *     caught per-tick and reported by the daemon rather than crashing it;
 *   - the detection ipHash rides empty (the hashed-IP capture at ciphertext
 *     submission is not stored yet) — device correlation, the R11 hard
 *     block, still runs on the sealed device hash.
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadPostgresConfig } from '../../_shared/src/config';
import { createPool } from '../../_shared/src/db';
import {
  PgCiphertextStore,
  PgPublishedKeyStore,
  TurnkeyCustody,
  turnkeyEnvelope,
  type PoolKeyCustody,
} from '../../sealing/src';
import { detectPool } from '../../detection/src/pipeline';
import { Web3Chain } from './chain-web3';
import { crankPool, type RevealedForDetection } from './crank';
import { makeDaemon, StubVrfCoordinator, type TickReport } from './daemon';
import { IrysPublisher, irysUploaderFromEnv } from './publisher-irys';

const SERVICE = 'daemon';
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const DEFAULT_RPC = 'https://api.devnet.solana.com';

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${SERVICE}: ${name} is required`);
  return v;
}

function buildCustody(
  env: NodeJS.ProcessEnv,
  store: PgPublishedKeyStore,
  policy: (poolId: bigint) => Promise<boolean>
): PoolKeyCustody {
  // Lazy vendor import from the sealing package's own copy (its dependency —
  // the type reference resolves through the same path).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Turnkey } =
    require('../../sealing/node_modules/@turnkey/sdk-server') as typeof import('../../sealing/node_modules/@turnkey/sdk-server');
  const client = new Turnkey({
    apiBaseUrl: requireEnv(env, 'TURNKEY_API_BASE_URL'),
    apiPublicKey: requireEnv(env, 'TURNKEY_API_PUBLIC_KEY'),
    apiPrivateKey: requireEnv(env, 'TURNKEY_API_PRIVATE_KEY'),
    defaultOrganizationId: requireEnv(env, 'TURNKEY_ORGANIZATION_ID'),
  }).apiClient();
  return new TurnkeyCustody({
    vault: client,
    envelope: turnkeyEnvelope(),
    organizationId: requireEnv(env, 'TURNKEY_ORGANIZATION_ID'),
    userId: requireEnv(env, 'TURNKEY_USER_ID'),
    policy,
    store,
  });
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const intervalMs = Number(env.BLOTTO_DAEMON_INTERVAL_MS ?? 15_000);
  const healthPort = Number(env.BLOTTO_DAEMON_HEALTH_PORT ?? 8084);
  const db = createPool(loadPostgresConfig(env));

  const connection = new Connection(env.BLOTTO_RPC_URL ?? DEFAULT_RPC, {
    commitment: 'confirmed',
  });
  const chain = new Web3Chain({
    connection,
    programId: new PublicKey(env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID),
    settlementSigner: Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(readFileSync(requireEnv(env, 'SETTLEMENT_SIGNER_KEYPAIR'), 'utf8')) as number[]
      )
    ),
  });

  const now = (): bigint => BigInt(Math.floor(Date.now() / 1000));
  // The sealing property as an export policy: a pool's secret exports only
  // once the pool is out of Open, or past its fill deadline (custody.ts).
  const policy = async (poolId: bigint): Promise<boolean> => {
    const pool = await chain.getPool(poolId);
    return pool.state !== 'Open' || now() > pool.fillDeadline;
  };

  const custody = buildCustody(env, new PgPublishedKeyStore(db), policy);
  const ciphertexts = new PgCiphertextStore(db);
  const publisher = new IrysPublisher(
    await irysUploaderFromEnv({
      IRYS_UPLOAD_KEY: env.IRYS_UPLOAD_KEY,
      IRYS_NETWORK: env.IRYS_NETWORK,
    })
  );

  // R11: the detection hook, exactly as the rehearsal wires it (hard blocks
  // flag before payout; the full report is shadow-mode logged).
  const detect = async (id: bigint, revealed: RevealedForDetection[]): Promise<string[]> => {
    const report = detectPool(
      id.toString(),
      revealed
        .filter((e) => e.battles !== null)
        .map((e) => ({
          player: e.player,
          index: e.index,
          battles: e.battles as number[][],
          timingsMs: e.timingsMs ?? [],
          deviceHash: e.deviceHash ?? '',
          ipHash: '',
          scoreHalf: e.scoreHalf,
        })),
      { fullEscrowTier: false }
    );
    if (report.findings.length > 0) {
      console.log(`${SERVICE}: detection pool=${id}`, JSON.stringify(report));
    }
    return report.hardBlocks;
  };

  const daemon = makeDaemon({
    chain,
    custody,
    vrf: new StubVrfCoordinator(chain, requireEnv(env, 'RANDOMNESS_ACCOUNT')),
    crank: (poolId) => crankPool({ chain, custody, ciphertexts, publisher, detect }, poolId),
    now,
    log: (step, detail) => console.log(`${SERVICE}: ${step}`, JSON.stringify(detail ?? {})),
  });

  // The health endpoint reports the last completed tick — a hung RPC shows
  // up as a stale `at`, which is what the platform's checks alert on.
  let lastTick: { at: string; report: TickReport } | null = null;
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: true,
          service: SERVICE,
          lastTick:
            lastTick === null
              ? null
              : {
                  at: lastTick.at,
                  opened: lastTick.report.opened.length,
                  cranked: lastTick.report.cranked.length,
                  refundsTriggered: lastTick.report.refundsTriggered.length,
                  errors: lastTick.report.errors.length,
                },
        })
      );
      return;
    }
    res.writeHead(404).end();
  }).listen(healthPort, () => {
    console.log(`${SERVICE}: health on :${healthPort}, tick every ${intervalMs}ms`);
  });

  // The loop: tick, record, sleep. A throwing tick is logged and retried.
  for (;;) {
    try {
      const report = await daemon.tick();
      lastTick = { at: new Date().toISOString(), report };
      for (const e of report.errors) {
        console.error(`${SERVICE}: tick error`, JSON.stringify(e));
      }
    } catch (err) {
      console.error(`${SERVICE}: tick threw:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`${SERVICE}: fatal:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
