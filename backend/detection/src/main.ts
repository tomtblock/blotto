/**
 * The review service's deployment entry (E5): env → deps → serve.
 *
 *   BLOTTO_REVIEW_PORT           default 8083
 *   BLOTTO_TRUST_PROXY           "1" ONLY behind our own proxy (Fly) — the
 *                                rate limiter's client key (Stage E)
 *   BLOTTO_API_CORS_ORIGINS etc. BR-005 hygiene (_shared/http-hygiene.ts);
 *                                the app's origin MUST be allowlisted or the
 *                                browser's POSTs are refused at preflight
 *   BLOTTO_DATABASE_URL          Postgres (the append-only decision log, the
 *                                detection report store (migration 0021) AND
 *                                the complaints record (migration 0024))
 *   BLOTTO_REVIEWERS_PATH        default config/reviewers.json (founder-owned)
 *   BLOTTO_RPC_URL               default devnet
 *   BLOTTO_PROGRAM_ID            default the declared id
 *   SETTLEMENT_SIGNER_KEYPAIR    path to the settlement keypair JSON — the
 *                                key that executes flag/clear/release/forfeit
 *                                (Turnkey-held in the target custody story;
 *                                a mounted keypair is the interim wiring the
 *                                custody page discloses)
 *   BLOTTO_MONITOR_SINK          metrics/alert sink (_shared/src/monitor.ts);
 *                                default `logging`, which is where the B-24 /
 *                                B-25 / C-07 alerts go until the Prometheus
 *                                sink is selected
 *   BLOTTO_REVIEW_OPERATOR_TOKEN shared operator secret for `GET /detection`
 *                                (ruling D-E9). UNSET ⇒ that route answers
 *                                503: the detection report names players no
 *                                human has looked at yet, so it fails closed
 *   BLOTTO_REVIEW_ACTION_BUDGET  decisions one reviewer key may sign per
 *   BLOTTO_REVIEW_ACTION_WINDOW_MS
 *                                window (audit B-25). Both default to the
 *                                RATIFIED numbers in budget.ts (D-E13,
 *                                founder ruling 2026-09-13: 64 per hour)
 *
 * The chain client is @blotto/reveal's Web3Chain — the same
 * settlement-signed client the daemon drives; pool ADDRESSES from the
 * review page resolve to pool IDS by reading the Pool account's first
 * field after the discriminator (actions-chain.ts module doc). It also
 * serves the two READS the state preconditions run on (B-25).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
// web3.js from the REVEAL package's own copy: Web3Chain's constructor types
// carry web3 classes with private members, and TypeScript treats a second
// installed copy as a different nominal type — one copy, one declaration.
import {
  Connection,
  Keypair,
  PublicKey,
} from '../../reveal/node_modules/@solana/web3.js';
import { loadPostgresConfig, parsePositiveInt } from '../../_shared/src/config';
import { resolveRpcUrl } from '../../_shared/src/cluster';
import { urlForLog } from '../../_shared/src/short';
import { createPool } from '../../_shared/src/db';
import { loadHygieneConfig } from '../../_shared/src/http-hygiene';
import { buildMonitor, loadMonitor } from '../../_shared/src/monitor';
import { startMetricsListener } from '../../_shared/src/metrics-listener';
import { Web3Chain } from '../../reveal/src/chain-web3';
import { serveReviewApi } from './server';
import { parseReviewerRegistry } from './auth';
import { BUDGET_ENV, DEFAULT_REVIEWER_BUDGET, type ReviewerBudget } from './budget';
import { PgDecisionLog } from './log-pg';
import { PgComplaintStore } from './complaints-pg';
import { PgDetectionReportStore } from './reports-pg';
import { reviewActionsFromChain } from './actions-chain';

const SERVICE = 'review';
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
// The RPC endpoint follows BLOTTO_CLUSTER — _shared/src/cluster.ts.

export function main(env: NodeJS.ProcessEnv = process.env): void {
  // The same standard the packet service and daemon carry: say which code is
  // running before anything can fail, then name every seam that was chosen
  // rather than leaving it to be inferred from the absence of an error.
  console.log(`${SERVICE}: build ${env.BLOTTO_BUILD_COMMIT ?? 'unknown'}`);
  const port = Number(env.BLOTTO_REVIEW_PORT ?? 8083);
  const db = createPool(loadPostgresConfig(env));
  const registry = parseReviewerRegistry(
    // Repo-root default, CWD-independent — the same fix as the packet
    // service's config paths (first Fly deploy, 2026-08-28): the images
    // run with WORKDIR backend/<service> while config/ sits at the root.
    JSON.parse(
      readFileSync(
        env.BLOTTO_REVIEWERS_PATH ?? resolve(__dirname, '..', '..', '..', 'config', 'reviewers.json'),
        'utf8'
      )
    )
  );

  const keypairPath = env.SETTLEMENT_SIGNER_KEYPAIR;
  if (!keypairPath) {
    throw new Error(`${SERVICE}: SETTLEMENT_SIGNER_KEYPAIR is not set (path to the keypair JSON)`);
  }
  const rpcUrl = resolveRpcUrl(env);
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
  });
  const chain = new Web3Chain({
    connection,
    programId: new PublicKey(env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID),
    settlementSigner: Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')) as number[])
    ),
  });

  // Pool address → pool id: the Pool account's u64 LE at offset 8 (the
  // first field after the Anchor discriminator).
  const resolvePoolId = async (pool: string): Promise<bigint> => {
    const info = await connection.getAccountInfo(new PublicKey(pool), 'confirmed');
    if (!info) throw new Error(`pool account not found: ${pool}`);
    return info.data.readBigUInt64LE(8);
  };

  // Alerts, not just counters: B-24 (a decision applied but not logged),
  // C-07 (a forfeit recorded and not landed) and B-25 (a reviewer key
  // spending its whole budget) are all states no response body reaches.
  // Default sink is `logging`, so an unconfigured deployment still says them
  // out loud on stdout rather than dropping them.
  const monitor = buildMonitor(loadMonitor(env), SERVICE);
  // E-09: the exposition, on the private network only — never on this
  // service's own listener, which the platform routes to the internet.
  // Silent no-op on every sink but prometheus.
  startMetricsListener(monitor, SERVICE, env);

  // Founder-owned numbers (budget.ts): read from env, defaulted to the
  // architect proposals, and PRINTED at boot so a deployment cannot be
  // running a bound nobody remembers choosing.
  const budget: ReviewerBudget = {
    actions: parsePositiveInt(env, BUDGET_ENV.actions, DEFAULT_REVIEWER_BUDGET.actions),
    windowMs: parsePositiveInt(env, BUDGET_ENV.windowMs, DEFAULT_REVIEWER_BUDGET.windowMs),
  };

  const operatorToken = (env.BLOTTO_REVIEW_OPERATOR_TOKEN ?? '').trim();

  serveReviewApi(
    {
      registry,
      actions: reviewActionsFromChain(chain, resolvePoolId),
      log: new PgDecisionLog(db),
      reports: new PgDetectionReportStore(db),
      // The complaints record (2026-09-19). Always on where a database is:
      // the route the terms and the privacy notice both point at must not
      // depend on a second deployment decision, and the shared database has
      // the table (migration 0024).
      complaints: new PgComplaintStore(db),
      operatorToken: operatorToken === '' ? undefined : operatorToken,
      monitor,
      budget,
      trustProxyHeader: env.BLOTTO_TRUST_PROXY === '1',
      // Posture from env, widened in CODE to this service's browser-facing
      // POST surface (the entry server's rule: methods are a property of
      // the code, never of a deployment).
      hygiene: (() => {
        const base = loadHygieneConfig(env);
        return {
          ...base,
          cors: { ...base.cors, allowMethods: 'GET, POST, OPTIONS', allowHeaders: 'content-type' },
        };
      })(),
    },
    port
  );
  // An empty reviewer registry is not an error — config/reviewers.json ships
  // empty by design — but it means NO decision will verify, and that is worth
  // saying out loud rather than discovering when the first flag is raised.
  if (registry.members.length === 0) {
    console.warn(
      `${SERVICE}: reviewers registry is EMPTY — no review decision will verify. ` +
        `Fill config/reviewers.json (BLOTTO_REVIEWERS_PATH) before the detection drill.`
    );
  }
  // The published appeal rule needs a SECOND reviewer: an appeal is decided
  // by someone other than the reviewer who upheld the flag, and with one
  // member no appeal can ever be decided. Said at boot, not at the first
  // appeal (audit O24; config/reviewers.json is founder-owned).
  if (registry.members.length === 1) {
    console.warn(
      `${SERVICE}: reviewers registry has ONE member — appeals can be lodged but NONE can be ` +
        `decided (the published rule requires a different reviewer). Add a second member.`
    );
  }
  // The detection report surface is the only route that needs a secret, and
  // an unset secret closes it rather than opening it — said here because a
  // closed route and an empty report look the same from the reviewer's page.
  if (operatorToken === '') {
    console.warn(
      `${SERVICE}: BLOTTO_REVIEW_OPERATOR_TOKEN is unset — GET /detection answers 503 and the ` +
        `reviewer page will show NO detection report (ruling D-E9 expects one before the ` +
        `review window closes).`
    );
  }
  // `urlForLog`, never the raw url: the RPC url carries its API key in the
  // query string, this line runs on EVERY boot, and `backend-status` copies
  // the log into a GitHub Actions log that is retained (devnet, 2026-09-24).
  console.log(
    `${SERVICE}: chain = ${urlForLog(rpcUrl)} program ${env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID}`
  );
  console.log(
    `${SERVICE}: reviewer budget = ${budget.actions} decisions per ${budget.windowMs}ms ` +
      `(ratified D-E13 2026-09-13 — ${BUDGET_ENV.actions} / ${BUDGET_ENV.windowMs})`
  );
  console.log(`${SERVICE}: listening on :${port} (${registry.members.length} reviewer(s))`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`${SERVICE}: fatal:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
