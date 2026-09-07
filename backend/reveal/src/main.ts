/**
 * The settlement daemon's deployment entry (E5): env → deps → run loop +
 * health endpoint. Wires the PRODUCTION adapters end to end — Web3Chain,
 * Turnkey custody over the durable PG key store, the PG ciphertext store,
 * the Irys publisher, and the R11 detection pipeline — and refuses loudly
 * when a credentialed seam is unconfigured.
 *
 *   BLOTTO_DAEMON_INTERVAL_MS    default 15000
 *   BLOTTO_DAEMON_HEALTH_PORT    default 8084 — GET /health, bound before
 *                                anything else: startup phase while it comes
 *                                up, last tick once running, 503 if it is
 *                                still starting past the budget (health.ts)
 *   BLOTTO_RPC_URL               default devnet
 *   BLOTTO_PROGRAM_ID            default the declared id
 *   BLOTTO_DATABASE_URL          Postgres (ciphertexts + published pool keys)
 *   SETTLEMENT_SIGNER_KEYPAIR    path to the settlement keypair JSON
 *   KEEPER_KEYPAIR               optional — the key `open_pool` requires
 *                                (`Config.keeper`, prompt v2 §A). Absent =
 *                                the settlement signer opens pools too, the
 *                                devnet posture until E6 splits the keys
 *   SWITCHBOARD_QUEUE            the Switchboard On-Demand queue (base58) —
 *                                selects the PRODUCTION VRF coordinator
 *                                (vrf-switchboard.ts): fresh Randomness
 *                                account per pool, reveal bundled with
 *                                commit_vrf_seed
 *   RANDOMNESS_ACCOUNT           a fixed Randomness account for the STUB
 *                                coordinator (tests/bench only; ignored when
 *                                SWITCHBOARD_QUEUE is set). One of the two
 *                                must be set — the daemon refuses to start
 *                                with neither (fail-closed, like every
 *                                credentialed seam).
 *   TURNKEY_API_BASE_URL/_PUBLIC_KEY/_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID,
 *   TURNKEY_USER_ID              pool-key custody (R21)
 *   IRYS_UPLOAD_KEY, IRYS_NETWORK  bundle publishing
 *
 * One seam stays open, on the record (docs/hosting.md):
 *   - the detection ipHash rides empty (the hashed-IP capture at ciphertext
 *     submission is not stored yet) — device correlation still runs on the
 *     sealed device hash, in SHADOW mode (below).
 *
 * Detection is MANUAL-ONLY (prompt v2 §E, recorded 2026-09-07): the pipeline
 * runs on every pool and its report is logged, but the crank's `detect`
 * hook returns no auto-flags — a flag is a signed human decision through
 * the review path (backend/detection, `flag_entry`), never the daemon's.
 */

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
import { makeDaemon, StubVrfCoordinator, type VrfCoordinator } from './daemon';
import { makeSwitchboardOps, SwitchboardVrfCoordinator } from './vrf-switchboard';
import { IrysPublisher, irysUploaderFromEnv } from './publisher-irys';
import { newDaemonHealth, serveDaemonHealth, type DaemonPhase } from './health';
import { assertCanPayFees, formatSol, step } from './startup';

const SERVICE = 'daemon';
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const DEFAULT_RPC = 'https://api.devnet.solana.com';

/**
 * Budgets for the two startup steps that leave the process and talk to a
 * vendor. Switchboard measured 19-21s on devnet, so 45s is generous without
 * being indefinite; Irys is given the same. Exceeding either is fatal — see
 * startup.ts for why a stalled daemon must not be allowed to sit silently.
 */
const SWITCHBOARD_BUDGET_MS = 45_000;
const IRYS_BUDGET_MS = 45_000;

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
  console.log(`${SERVICE}: build ${env.BLOTTO_BUILD_COMMIT ?? 'unknown'}`);
  const intervalMs = Number(env.BLOTTO_DAEMON_INTERVAL_MS ?? 15_000);
  const healthPort = Number(env.BLOTTO_DAEMON_HEALTH_PORT ?? 8084);

  // FIRST, before any credential, database handle or network fetch. The
  // Switchboard and Irys steps below take ~25s between them, and a platform
  // health check that arrives during those seconds must find something
  // listening — see health.ts for the 2026-09-06 deploy this comes from.
  // Past the startup budget the endpoint turns 503, so a wedged init is a
  // restart rather than a machine that looks fine forever.
  const health = newDaemonHealth();
  serveDaemonHealth(health, healthPort);
  console.log(`${SERVICE}: tick every ${intervalMs}ms once ready`);

  // Every phase change is logged with elapsed time. The log is the only
  // witness to a stall: a blocked event loop cannot answer /health at all,
  // and once past the startup budget the 503 takes the daemon out of the
  // proxy's rotation — either way the endpoint cannot report its own trouble.
  // The rss figure is here because the 2026-09-06 stall had to be inferred
  // from an OOM line in the platform's own log rather than read from ours.
  const enter = (phase: DaemonPhase): void => {
    health.phase = phase;
    const rssMb = Math.round(process.memoryUsage().rss / 1_048_576);
    console.log(
      `${SERVICE}: phase=${phase} (+${Date.now() - health.startedAtMs}ms, rss ${rssMb}MB)`
    );
  };
  const log = (line: string): void => console.log(`${SERVICE}: ${line}`);

  enter('connecting');
  const db = createPool(loadPostgresConfig(env));

  const connection = new Connection(env.BLOTTO_RPC_URL ?? DEFAULT_RPC, {
    commitment: 'confirmed',
  });
  const settlementSigner = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(readFileSync(requireEnv(env, 'SETTLEMENT_SIGNER_KEYPAIR'), 'utf8')) as number[]
    )
  );

  // Fail closed on an empty fee payer, in the same place and the same way as
  // every other credentialed seam here — see startup.ts for the incident.
  health.settlementLamports = BigInt(
    await connection.getBalance(settlementSigner.publicKey, 'confirmed')
  );
  assertCanPayFees(settlementSigner.publicKey.toBase58(), health.settlementLamports);
  log(
    `settlement signer ${settlementSigner.publicKey.toBase58()} holds ` +
      `${formatSol(health.settlementLamports)} SOL`
  );

  // VRF: the production Switchboard coordinator when a queue is configured;
  // the fixed-account stub only when explicitly asked for (tests/bench);
  // neither configured → refuse to start, like every credentialed seam.
  // The coordinator and the chain reference each other (the chain bundles
  // the coordinator's reveal ix; the coordinator lands the commit through
  // the chain), resolved by closure: both arrows run only inside daemon
  // ticks, long after both consts below are assigned.
  let vrf: VrfCoordinator;
  enter('switchboard');
  const swCoordinator: SwitchboardVrfCoordinator | null = env.SWITCHBOARD_QUEUE
    ? new SwitchboardVrfCoordinator({
        ops: await step('switchboard queue', SWITCHBOARD_BUDGET_MS, () =>
          makeSwitchboardOps({
            connection,
            payer: settlementSigner,
            queue: new PublicKey(env.SWITCHBOARD_QUEUE as string),
          }),
          log
        ),
        commitOnChain: (poolId, account): Promise<void> => chain.commitVrfSeed(poolId, account),
        log: (stage, detail) => console.log(`${SERVICE}: ${stage}`, JSON.stringify(detail ?? {})),
      })
    : null;

  const keeperSigner = env.KEEPER_KEYPAIR
    ? Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(readFileSync(env.KEEPER_KEYPAIR, 'utf8')) as number[])
      )
    : undefined;
  log(
    keeperSigner
      ? `keeper ${keeperSigner.publicKey.toBase58()} opens pools (KEEPER_KEYPAIR set)`
      : 'keeper = the settlement signer (KEEPER_KEYPAIR unset — the devnet posture)'
  );

  const chain: Web3Chain = new Web3Chain({
    connection,
    programId: new PublicKey(env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID),
    settlementSigner,
    keeperSigner,
    makeVrfRevealIx: swCoordinator
      ? (account) => swCoordinator.makeVrfRevealIx(account)
      : undefined,
  });

  // Same reasoning as the packet service's signer line: both coordinators
  // start cleanly and report healthy, so the only way an operator can tell a
  // production run from one silently pinned to the stub is to say so here.
  if (swCoordinator) {
    console.log(`${SERVICE}: VRF = SWITCHBOARD On-Demand (queue ${env.SWITCHBOARD_QUEUE})`);
    vrf = swCoordinator;
  } else if (env.RANDOMNESS_ACCOUNT) {
    console.warn(
      `${SERVICE}: VRF = STUB COORDINATOR (RANDOMNESS_ACCOUNT=${env.RANDOMNESS_ACCOUNT}) — ` +
        `tests and bench only. The class draw is NOT consuming live Switchboard ` +
        `randomness. Set SWITCHBOARD_QUEUE for production.`
    );
    vrf = new StubVrfCoordinator(chain, env.RANDOMNESS_ACCOUNT);
  } else {
    throw new Error(
      `${SERVICE}: set SWITCHBOARD_QUEUE (production) or RANDOMNESS_ACCOUNT (stub, tests/bench) — refusing to run without a VRF coordinator`
    );
  }

  const now = (): bigint => BigInt(Math.floor(Date.now() / 1000));
  // The sealing property as an export policy: a pool's secret exports only
  // once the pool is out of Open, or past its fill deadline (custody.ts).
  const policy = async (poolId: bigint): Promise<boolean> => {
    const pool = await chain.getPool(poolId);
    return pool.state !== 'Open' || now() > pool.fillDeadline;
  };

  const custody = buildCustody(env, new PgPublishedKeyStore(db), policy);
  const ciphertexts = new PgCiphertextStore(db);
  enter('irys');
  const publisher = new IrysPublisher(
    await step(
      'irys uploader',
      IRYS_BUDGET_MS,
      () =>
        irysUploaderFromEnv({
          IRYS_UPLOAD_KEY: env.IRYS_UPLOAD_KEY,
          IRYS_NETWORK: env.IRYS_NETWORK,
          BLOTTO_RPC_URL: env.BLOTTO_RPC_URL ?? DEFAULT_RPC,
        }),
      log
    )
  );

  // R11 in SHADOW mode (manual-only detection, 2026-09-07): the report is
  // computed and logged for every pool with findings; NOTHING is flagged by
  // the daemon. `report.hardBlocks` is deliberately not returned — a flag
  // is a reviewer's signed decision (backend/detection), and the crank's
  // hook is kept as the seam it always was.
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
      console.log(`${SERVICE}: detection (shadow) pool=${id}`, JSON.stringify(report));
    }
    return [];
  };

  // E3 §4.4 (live path): after the crank publishes a bundle, tell the
  // indexer where it is — POST /bundles on the webhook server, same shared
  // secret as the Helius deliveries (one secret, one receiver). Optional:
  // without both env vars the archive fills by `archive-backfill` alone.
  // Fire-safe by the daemon's contract — a throw here becomes a tick error,
  // never a blocked sweep; a non-2xx (including the indexer's 503 "root not
  // ingested yet") throws so the miss is visible in the tick report rather
  // than silently waiting on the backfill.
  const announceUrl = env.BLOTTO_INDEXER_ANNOUNCE_URL;
  const announceSecret = env.BLOTTO_HELIUS_WEBHOOK_SECRET;
  const announceBundle =
    announceUrl && announceSecret
      ? async (poolId: bigint, bundleUri: string): Promise<void> => {
          const res = await fetch(announceUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: announceSecret },
            body: JSON.stringify({ pool_id: poolId.toString(), uri: bundleUri }),
          });
          if (!res.ok) {
            throw new Error(`bundle announce: HTTP ${res.status} ${await res.text()}`);
          }
        }
      : undefined;
  if (!announceBundle) {
    console.log(
      `${SERVICE}: bundle announce OFF (set BLOTTO_INDEXER_ANNOUNCE_URL + ` +
        `BLOTTO_HELIUS_WEBHOOK_SECRET) — archive relies on archive-backfill`
    );
  }

  const daemon = makeDaemon({
    chain,
    custody,
    ciphertexts,
    vrf,
    crank: (poolId) => crankPool({ chain, custody, ciphertexts, publisher, detect }, poolId),
    now,
    announceBundle,
    log: (stage, detail) => console.log(`${SERVICE}: ${stage}`, JSON.stringify(detail ?? {})),
  });

  // Initialisation is done: the endpoint now reports ready, and `lastTick`
  // becomes the liveness signal — a hung RPC shows up as a stale `at`.
  enter('ready');
  console.log(
    `${SERVICE}: READY — health on :${healthPort}, ticking every ${intervalMs}ms ` +
      `(startup took ${Date.now() - health.startedAtMs}ms)`
  );

  // The loop: tick, record, sleep. A throwing tick is logged and retried.
  for (;;) {
    try {
      const report = await daemon.tick();
      health.lastTick = { at: new Date().toISOString(), report };
      // One cheap call per tick, so a drain toward the floor shows on /health
      // rather than only at the next restart. A failure here must never take
      // down a tick that otherwise worked.
      try {
        health.settlementLamports = BigInt(
          await connection.getBalance(settlementSigner.publicKey, 'confirmed')
        );
      } catch {
        // leave the last known value; the RPC error surfaces via the tick itself
      }
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
