/**
 * The review service's deployment entry (E5): env → deps → serve.
 *
 *   BLOTTO_REVIEW_PORT           default 8083
 *   BLOTTO_TRUST_PROXY           "1" ONLY behind our own proxy (Fly) — the
 *                                rate limiter's client key (Stage E)
 *   BLOTTO_API_CORS_ORIGINS etc. BR-005 hygiene (_shared/http-hygiene.ts);
 *                                the app's origin MUST be allowlisted or the
 *                                browser's POSTs are refused at preflight
 *   BLOTTO_DATABASE_URL          Postgres (the append-only decision log)
 *   BLOTTO_REVIEWERS_PATH        default config/reviewers.json (founder-owned)
 *   BLOTTO_RPC_URL               default devnet
 *   BLOTTO_PROGRAM_ID            default the declared id
 *   SETTLEMENT_SIGNER_KEYPAIR    path to the settlement keypair JSON — the
 *                                key that executes flag/clear/release/forfeit
 *                                (Turnkey-held in the target custody story;
 *                                a mounted keypair is the interim wiring the
 *                                custody page discloses)
 *
 * The chain client is @blotto/reveal's Web3Chain — the same
 * settlement-signed client the daemon drives; pool ADDRESSES from the
 * review page resolve to pool IDS by reading the Pool account's first
 * field after the discriminator (actions-chain.ts module doc).
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
import { loadPostgresConfig } from '../../_shared/src/config';
import { createPool } from '../../_shared/src/db';
import { loadHygieneConfig } from '../../_shared/src/http-hygiene';
import { Web3Chain } from '../../reveal/src/chain-web3';
import { serveReviewApi } from './server';
import { parseReviewerRegistry } from './auth';
import { PgDecisionLog } from './log-pg';
import { reviewActionsFromChain } from './actions-chain';

const SERVICE = 'review';
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const DEFAULT_RPC = 'https://api.devnet.solana.com';

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
  const connection = new Connection(env.BLOTTO_RPC_URL ?? DEFAULT_RPC, {
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

  serveReviewApi(
    {
      registry,
      actions: reviewActionsFromChain(chain, resolvePoolId),
      log: new PgDecisionLog(db),
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
  // appeal (audit O15; config/reviewers.json is founder-owned).
  if (registry.members.length === 1) {
    console.warn(
      `${SERVICE}: reviewers registry has ONE member — appeals can be lodged but NONE can be ` +
        `decided (the published rule requires a different reviewer). Add a second member.`
    );
  }
  console.log(
    `${SERVICE}: chain = ${env.BLOTTO_RPC_URL ?? DEFAULT_RPC} program ${env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID}`
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
