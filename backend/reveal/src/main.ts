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
 *   BLOTTO_INDEXER_ANNOUNCE_URL, BLOTTO_HELIUS_WEBHOOK_SECRET
 *                                where to tell the indexer a settled pool's
 *                                bundle is (POST /bundles on its webhook
 *                                service, the indexer's own secret). Both
 *                                set = announce ON; otherwise OFF, warned on
 *                                devnet and REFUSED on mainnet (startup.ts,
 *                                audit 2026-09-11 D-02)
 *   BLOTTO_MAX_UNREADABLE_ENTRIES
 *                                the founder-owned ceiling on entries that
 *                                may fail to read back before the crank
 *                                refuses to settle a pool (crank.ts). Unset
 *                                on devnet = the crank's default, printed;
 *                                REQUIRED on mainnet (startup.ts)
 *   SANCTIONS_*                  the winner check at resolving (Stage F) —
 *                                same variables and same selector as the
 *                                packet service (`sanctions/src/select.ts`).
 *                                The daemon REFUSES TO START with no source
 *                                configured: it would otherwise pay winners
 *                                unscreened while the rules page says it
 *                                checks them
 *
 * One seam stays open, on the record (docs/hosting.md):
 *   - the detection ipHash rides empty (the hashed-IP capture at ciphertext
 *     submission is not stored yet) — device correlation still runs on the
 *     sealed device hash.
 *
 * Detection is MANUAL-ONLY (prompt v2 §E, recorded 2026-09-07; report path
 * ratified as D-E9 on 2026-09-12): the pipeline runs on every pool and its
 * report is PERSISTED for the reviewer's page (`detection_reports`, migration
 * 0021), but the crank's `detect` hook returns no auto-flags — a flag is a
 * signed human decision through the review path (backend/detection,
 * `flag_entry`), never the daemon's. `Config.detection_hard_block` is read by
 * nothing here or anywhere else off-chain (audit D-36); see the hook.
 */

import { readFileSync } from 'fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadPostgresConfig } from '../../_shared/src/config';
import { clusterName, resolveRpcUrl } from '../../_shared/src/cluster';
import { createPool } from '../../_shared/src/db';
import {
  PgCiphertextStore,
  PgPublishedKeyStore,
  TurnkeyCustody,
  turnkeyEnvelope,
  type PoolKeyCustody,
} from '../../sealing/src';
import { detectPool } from '../../detection/src/pipeline';
import { PgDecisionLog } from '../../detection/src/log-pg';
import { PgDetectionReportStore } from '../../detection/src/reports-pg';
import { appealState } from '../../detection/src/appeals';
import { wireScreening } from '../../sanctions/src';
import { buildMonitor, loadMonitor } from '../../_shared/src/monitor';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import { makeWinnerScreen } from './winner-screening';
import { Web3Chain } from './chain-web3';
import { crankPool, publishBundle, type CrankDeps, type RevealedForDetection } from './crank';
import { PgPublishedBundleStore } from './published-store';
import { makePriorityFeeSampler } from './priority-fee';
import { makeDaemon, StubVrfCoordinator, type VrfCoordinator } from './daemon';
import { makeSwitchboardOps, SwitchboardVrfCoordinator } from './vrf-switchboard';
import { IrysPublisher, irysNetworkFor, irysUploaderFromEnv } from './publisher-irys';
import { STALE_TICK_MS, newDaemonHealth, serveDaemonHealth, type DaemonPhase } from './health';
import {
  announceVerdict,
  assertCanPayFees,
  formatSol,
  parseUnreadableCeiling,
  step,
  uploadWalletVerdict,
} from './startup';
import { base58Decode } from '../../_shared/src/blotto-events';
import { intEnv, portEnv } from '../../_shared/src/env-number';
import { startMetricsListener } from '../../_shared/src/metrics-listener';

const SERVICE = 'daemon';
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
// The RPC endpoint follows BLOTTO_CLUSTER (devnet by default, mainnet only
// by name and never without an explicit endpoint) — _shared/src/cluster.ts.

/**
 * Budgets for the two startup steps that leave the process and talk to a
 * vendor. Switchboard measured 19-21s on devnet, so 45s is generous without
 * being indefinite; Irys is given the same. Exceeding either is fatal — see
 * startup.ts for why a stalled daemon must not be allowed to sit silently.
 */
const SWITCHBOARD_BUDGET_MS = 45_000;
const IRYS_BUDGET_MS = 45_000;
// Was 30s, on the reasoning that "the OFAC mirror is a single file download"
// and so needed less than the oracle steps above. The premise was right and
// the number was wrong: that single file is the ~29 MB SDN export, fetched
// across the Atlantic and then parsed, and 30s never covered it. It had never
// been measured because SANCTIONS_OFAC_SDN was first staged for the daemon in
// the release of 2026-09-08, the same release whose packet-service boot failed
// on exactly this load.
//
// 150s is set against the mirror's own fetch timeout (120s, `ofac-sdn.ts`)
// plus room to parse. A budget shorter than the operation it wraps cannot
// report anything useful — it fires first and reports only itself.
const SANCTIONS_BUDGET_MS = 150_000;
// Per-call budgets inside a tick (audit 2026-09-11, C-22). Until 2026-09-12
// no RPC call and no announce carried a timeout, so one hung socket wedged
// the whole loop while /health kept answering 200. Every RPC request the
// chain client makes now aborts after RPC_CALL_BUDGET_MS (web3.js retries
// its own confirmation polling on top), and the announce after
// ANNOUNCE_BUDGET_MS. A tick that still hangs — a vendor SDK with no signal
// — is caught by /health's staleness rule (health.ts) and a restart.
const RPC_CALL_BUDGET_MS = 30_000;
const ANNOUNCE_BUDGET_MS = 10_000;

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
  // Whole numbers or nothing (audit 2026-09-11, E-20). A blank
  // BLOTTO_DAEMON_INTERVAL_MS used to become 0, which is a tick loop with no
  // pause between settlement passes; a blank health port used to become 0,
  // which binds a random port the platform's health check cannot reach.
  const intervalMs = intEnv(env, 'BLOTTO_DAEMON_INTERVAL_MS', 15_000, { min: 1 });
  const healthPort = portEnv(env, 'BLOTTO_DAEMON_HEALTH_PORT', 8084);

  // FIRST, before any credential, database handle or network fetch. The
  // Switchboard and Irys steps below take ~25s between them, and a platform
  // health check that arrives during those seconds must find something
  // listening — see health.ts for the 2026-09-06 deploy this comes from.
  // Past the startup budget the endpoint turns 503, so a wedged init is a
  // restart rather than a machine that looks fine forever.
  // Metrics and alerts: the daemon's first Monitor wiring (audit 2026-09-11,
  // E-04). The sink follows BLOTTO_MONITOR_SINK like every other service; the
  // Prometheus sink also serves /metrics beside /health.
  const monitor = buildMonitor(loadMonitor(env), SERVICE);
  // E-09: the exposition, on the private network only. Silent no-op on
  // every sink but prometheus.
  startMetricsListener(monitor, SERVICE, env);
  const health = newDaemonHealth();
  serveDaemonHealth(health, healthPort, Date.now, monitor);
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

  // Two settings that are pure and cheap are decided BEFORE any credential
  // is loaded: a misconfigured daemon should refuse in its first second, not
  // after four minutes of vendor loads. The cluster name is the one the RPC
  // resolution below uses too (_shared/src/cluster.ts).
  const cluster = clusterName(env);
  const unreadable = parseUnreadableCeiling(env.BLOTTO_MAX_UNREADABLE_ENTRIES, cluster);
  log(unreadable.message);

  enter('connecting');
  const db = createPool(loadPostgresConfig(env));

  const rpcUrl = resolveRpcUrl(env);
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    // Every request the client makes, bounded (C-22). The cast is because
    // web3.js types its fetch against its own bundled declaration.
    fetch: ((input: string | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(RPC_CALL_BUDGET_MS) })) as never,
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

  const programId = new PublicKey(env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID);
  const chain: Web3Chain = new Web3Chain({
    connection,
    programId,
    settlementSigner,
    keeperSigner,
    makeVrfRevealIx: swCoordinator
      ? (account) => swCoordinator.makeVrfRevealIx(account)
      : undefined,
    // The same fee choice the browser bids (C-34), sampled once per window.
    priorityFeeMicroLamports: makePriorityFeeSampler(connection, {
      lockedWritableAccounts: [programId],
    }),
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

  // THE CLOCK IS THE CHAIN'S (audit 2026-09-11, C-35 / F-10). The program
  // judges "past the fill deadline" on the Clock sysvar's unix_timestamp;
  // until 2026-09-12 the daemon judged it on this host's wall clock — the
  // same operator against a different clock, and the export policy decided
  // whether a pool's secret may leave custody on that comparison. One sysvar
  // read per tick feeds every comparison the tick makes; the policy reads it
  // fresh because an export is worth its own round trip.
  let chainNowCache = await chain.chainNow();
  const now = (): bigint => chainNowCache;
  // The sealing property as an export policy: a pool's secret exports only
  // once the pool is out of Open, or past its fill deadline (custody.ts).
  const policy = async (poolId: bigint): Promise<boolean> => {
    const pool = await chain.getPool(poolId);
    return pool.state !== 'Open' || (await chain.chainNow()) > pool.fillDeadline;
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
          BLOTTO_CLUSTER: env.BLOTTO_CLUSTER,
          BLOTTO_RPC_URL: rpcUrl,
        }),
      log
    )
  );
  // The upload wallet's balance, checked HERE rather than discovered at the
  // first settlement (audit 2026-09-11, C-01 — the second half of that fix).
  // The uploader above already accepted the key, so a key this parse cannot
  // read is logged and skipped, never a reason to refuse on our own account.
  try {
    const uploadWallet = Keypair.fromSecretKey(base58Decode(env.IRYS_UPLOAD_KEY ?? ''));
    const uploadLamports = BigInt(
      await connection.getBalance(uploadWallet.publicKey, 'confirmed')
    );
    const verdict = uploadWalletVerdict(
      uploadWallet.publicKey.toBase58(),
      uploadLamports,
      // E-12: the same resolver the uploader uses. The old test here read
      // `IRYS_NETWORK === 'mainnet'`, so a mainnet deployment that left the
      // variable unset judged its upload wallet against devnet's figures.
      irysNetworkFor(env)
    );
    if (verdict.refuse) throw new Error(verdict.message);
    log(verdict.message);
  } catch (e) {
    if (e instanceof Error && /upload wallet .* holds .* below/.test(e.message)) throw e;
    console.warn(
      `${SERVICE}: could not read the upload wallet's balance — ` +
        `${e instanceof Error ? e.message : String(e)}. Uploads will be attempted regardless.`
    );
  }

  // Where a detection run goes now that it goes somewhere (A-18). Same
  // Postgres the indexer migrates at boot; the review service reads it back.
  const detectionReports = new PgDetectionReportStore(db);

  // R11, MANUAL-ONLY (founder ruling D-E9, 2026-09-12): the report is
  // computed for every pool and PERSISTED; NOTHING is flagged by the daemon.
  // `report.hardBlocks` is deliberately not returned — a flag is a reviewer's
  // signed decision (backend/detection), and the crank's hook is kept as the
  // seam it always was.
  //
  // WHAT CHANGED, AND WHY (audit 2026-09-11, A-18 / D-36). Until 2026-09-12
  // the report went to standard output, and only when it had findings. A
  // finding therefore reached a human if and only if someone was reading this
  // process's log at the moment a pool settled, and nothing was left
  // afterwards to read at all — the layer that exists to TELL a reviewer what
  // to look at was connected to nothing. D-E9 ratified the report path:
  // persist every run and surface it to the reviewer before the review window
  // closes (`GET /detection` on the review service, migration 0021).
  //
  // The on-chain `Config.detection_hard_block` switch is READ BY NOTHING, here
  // or anywhere off-chain: `fullEscrowTier` below is the constant `false`.
  // Flipping that switch today changes no behaviour, and R11's automatic path
  // stays a signed founder decision after ten settled pools of quiet data.
  //
  // A store failure must never wedge settlement, so it is caught, counted and
  // alerted rather than thrown: the pool still pays.
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
    try {
      await detectionReports.save({
        // Keyed by the pool's PDA: that is what every review surface keys on,
        // and it is what `GET /detection?pool=` is asked with.
        pool: chain.poolAddress(id),
        poolId: id.toString(),
        producedAt: new Date().toISOString(),
        report,
      });
      monitor.recordEvent(METRIC.reveal.detectionReport, {
        outcome: report.findings.length > 0 ? 'findings' : 'clean',
      });
    } catch (e) {
      monitor.recordEvent(METRIC.reveal.detectionReportUnstored);
      monitor.alert(ALERT.reveal.detectionReportUnstored, {
        poolId: id.toString(),
        findings: report.findings.length,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (report.findings.length > 0) {
      console.log(`${SERVICE}: detection pool=${id}`, JSON.stringify(report));
    }
    if (report.reviewRecommended.length > 0) {
      // The whole control, under a manual policy: a person has to look. The
      // review window is hours, so this has to reach someone now, not at the
      // next dashboard glance. No player is named in the alert's detail —
      // the report itself is where the entries are inspected.
      monitor.alert(ALERT.reveal.detectionReviewRecommended, {
        poolId: id.toString(),
        pool: chain.poolAddress(id),
        entries: report.reviewRecommended.length,
      });
    }
    return [];
  };

  // Stage F: the winner check at resolving. Selected, loaded and scheduled
  // by the SAME wiring the packet service uses at entry, so the two ends of
  // a pool's life cannot drift apart. A throw here ends the process: with no
  // source configured the daemon would pay winners unscreened, and the rules
  // page says it checks them. What the daemon does with a screening that
  // cannot ANSWER is the other half, and lives in `winner-screening.ts`: it
  // holds the payment for a human rather than stalling the pool.
  const sanctions = await step(
    'sanctions screening',
    SANCTIONS_BUDGET_MS,
    () => wireScreening(env, SERVICE),
    log
  );
  console.log(`${SERVICE}: sanctions = ${sanctions.describe.join('; ')}`);
  const screenWinners = makeWinnerScreen(sanctions.check, (stage, detail) =>
    console.log(`${SERVICE}: ${stage}`, JSON.stringify(detail ?? {}))
  );

  // E3 §4.4 (live path): after the crank publishes a bundle, tell the
  // indexer where it is — POST /bundles on the webhook server, same shared
  // secret as the Helius deliveries (one secret, one receiver). Fire-safe by
  // the daemon's contract — a throw here becomes a tick error, never a
  // blocked sweep; a non-2xx (including the indexer's 503 "root not ingested
  // yet") throws so the miss is visible in the tick report rather than
  // silently waiting on the backfill.
  //
  // OFF is no longer a routine line (audit 2026-09-11, D-02): with the
  // upload key set the daemon is publishing bundles nobody is told about,
  // which is a warning here and a refusal on mainnet — see startup.ts. The
  // verdict is also on /health (`bundleAnnounce`) so backend-status shows it.
  const announce = announceVerdict(env, cluster);
  if (announce.refuse) throw new Error(announce.message);
  if (announce.warn) console.warn(announce.message);
  else log(announce.message);
  health.announce = announce.on ? 'on' : 'off';
  const announceUrl = (env.BLOTTO_INDEXER_ANNOUNCE_URL ?? '').trim();
  const announceSecret = (env.BLOTTO_HELIUS_WEBHOOK_SECRET ?? '').trim();
  const announceBundle = announce.on
    ? async (poolId: bigint, bundleUri: string): Promise<void> => {
        const res = await fetch(announceUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: announceSecret },
          body: JSON.stringify({ pool_id: poolId.toString(), uri: bundleUri }),
          signal: AbortSignal.timeout(ANNOUNCE_BUDGET_MS),
        });
        if (!res.ok) {
          throw new Error(`bundle announce: HTTP ${res.status} ${await res.text()}`);
        }
      }
    : undefined;

  // The daemon's memory of published bundles (C-09 / B-32 / D-27) and the
  // review decision log the clock consults before it releases (D-03). Both
  // read the shared Postgres the indexer migrates at boot; the decision log
  // is keyed by the pool's PDA, which the chain client derives.
  const published = new PgPublishedBundleStore(db);
  const decisionLog = new PgDecisionLog(db);
  const decisions = {
    forfeitLogged: async (poolId: bigint, player: string): Promise<boolean> =>
      appealState(await decisionLog.listFor(chain.poolAddress(poolId), player)).forfeit !== null,
  };
  const crankDeps: CrankDeps = {
    chain,
    custody,
    ciphertexts,
    publisher,
    detect,
    screenWinners,
    maxUnreadableEntries: unreadable.ceiling,
    published,
    monitor,
  };
  const daemon = makeDaemon({
    chain,
    custody,
    ciphertexts,
    vrf,
    crank: (poolId) => crankPool(crankDeps, poolId),
    publishOwed: (poolId) => publishBundle(crankDeps, poolId),
    published,
    decisions,
    monitor,
    now,
    announceBundle,
    log: (stage, detail) => console.log(`${SERVICE}: ${stage}`, JSON.stringify(detail ?? {})),
  });

  // Initialisation is done: the endpoint now reports ready, and `lastTick`
  // becomes the liveness signal — a hung RPC shows up as a stale `at`.
  enter('ready');
  health.readyAtMs = Date.now();
  console.log(
    `${SERVICE}: READY — health on :${healthPort}, ticking every ${intervalMs}ms ` +
      `(startup took ${Date.now() - health.startedAtMs}ms)`
  );

  // ONE loop, and it is the one the daemon suite drives (audit 2026-09-11,
  // A-23). This entry used to ship a second `for (;;)` of its own, so
  // `Daemon.run` — the loop with tests — was dead in production and the loop
  // that actually ran had none. Everything this entry needs around a tick is
  // a hook now. Never returns, like the loop it replaces.
  await daemon.run(intervalMs, undefined, {
    beforeTick: async () => {
      // One sysvar read a tick: every deadline comparison in the tick uses
      // the chain's clock as it stood when the tick began.
      chainNowCache = await chain.chainNow();
    },
    afterTick: async (report) => {
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
    },
    onTickError: (err) => {
      console.error(`${SERVICE}: tick threw:`, err instanceof Error ? err.message : err);
    },
    afterIteration: () => {
      // A tick that throws (config unreadable, RPC down) still counts as
      // completed for liveness — the loop is alive and will retry. A tick
      // that never returns is the case /health's staleness rule catches; say
      // so here too, since a restart wipes the evidence.
      const lastAt = health.lastTick ? Date.parse(health.lastTick.at) : (health.readyAtMs ?? 0);
      if (Date.now() - lastAt > STALE_TICK_MS) {
        monitor.alert(ALERT.reveal.tickStale, { sinceMs: Date.now() - lastAt });
      }
    },
  });
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`${SERVICE}: fatal:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
