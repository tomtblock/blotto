/*
 * The instant, rule-based half of a diagnosis: for each incident, the most
 * likely cause and the first thing to do, written for a founder reading a
 * phone. No AI and no network — it is what the alert says before Claude's
 * diagnosis (`.github/workflows/diagnose.yml`) arrives, and all it says if
 * that diagnosis cannot run.
 *
 * Every line here comes from a failure this system has actually had, or from
 * the operator guide that already describes the alert
 * (docs/guide/OPERATING-MANUAL.md). When a new failure class turns up, add it
 * here with the incident that taught it.
 */

import { ALERT } from '../../_shared/src/metrics';
import type { Incident } from './incidents';

export interface Explanation {
  cause: string;
  action: string;
}

const BACKEND_STATUS = 'Actions → backend-status → Run workflow, then read that app’s recent logs';

const REASON_ADVICE: Record<string, Explanation> = {
  [ALERT.reveal.entryRefundOwed]: {
    cause: 'An entry was scored as all-losses because its sealed allocation could not be read; the player is owed their entry back.',
    action: 'Follow OPERATING-MANUAL §7 ("An entry was scored as all-losses") to repay it.',
  },
  [ALERT.reveal.bundleUnpublished]: {
    cause: 'A settled pool’s results bundle failed to publish three times, so players cannot verify their ranking yet.',
    action: `${BACKEND_STATUS} (daemon, \`publish_owed:failed\`). The daemon keeps retrying; the usual causes are the Irys upload wallet or the network.`,
  },
  [ALERT.reveal.forfeitUnlanded]: {
    cause: 'A forfeit was decided but its transaction has not landed on chain.',
    action: 'See OPERATING-MANUAL (review and escrow section); check the settlement signer’s SOL and the daemon logs.',
  },
  [ALERT.review.forfeitNotLanded]: {
    cause: 'The review service recorded a forfeit that has not landed on chain.',
    action: `${BACKEND_STATUS} (review).`,
  },
  [ALERT.packet.geoQuotaSpent]: {
    cause: 'The geo-lookup vendor’s allowance is spent, so the entry service cannot clear anyone to enter.',
    action: 'Top up the geo vendor plan (packet service secrets in HOSTING.md). Entries resume on the next request.',
  },
  [ALERT.packet.geoCredentialRefused]: {
    cause: 'The geo-lookup vendor refused the entry service’s API key.',
    action: 'Check GEO_VENDOR_API_KEY (HOSTING.md) and redeploy the backend.',
  },
  [ALERT.packet.geoAllSourcesFailed]: {
    cause: 'No geo-lookup source answered, so entries are refused.',
    action: `${BACKEND_STATUS} (packet, \`geo source\`). Usually the vendor is down or out of allowance.`,
  },
  [ALERT.indexer.reconcileFailed]: {
    cause: 'The indexer’s background chain walk failed; the site may show stale pools.',
    action: 'Usually the RPC provider — check for an RPC alert. Otherwise run Actions → indexer-backfill.',
  },
  [ALERT.indexer.ingestFailed]: {
    cause: 'The indexer failed to store events the RPC provider’s webhook delivered.',
    action: `${BACKEND_STATUS} (indexer). The reconciliation walk repairs gaps once the cause is fixed.`,
  },
  [ALERT.sanctions.ofacStale]: {
    cause: 'The sanctions list mirror is past its staleness limit, so screening refuses.',
    action: `${BACKEND_STATUS} (packet and daemon, \`ofac-sdn mirror refresh FAILED\`).`,
  },
  [ALERT.sanctions.ofacBootFailed]: {
    cause: 'A service could not load the sanctions list at boot.',
    action: `${BACKEND_STATUS}; redeploy once the list source answers.`,
  },
};

function forRpc(inc: Incident): Explanation {
  const body = (inc.facts.body ?? '') + ' ' + inc.detail;
  if (/max usage/i.test(body)) {
    return {
      cause:
        'The Helius plan’s monthly credits are spent (429 "max usage reached"). Every service uses this key, so nothing settles, opens or indexes.',
      action:
        'Top up or turn on autoscaling at dashboard.helius.dev. Keep the same key and no redeploy is needed — the services recover within a minute.',
    };
  }
  if (/\b429\b/.test(body)) {
    return {
      cause: 'The RPC provider is rate-limiting the services.',
      action: 'Check the Helius dashboard for the request rate; a runaway caller shows up there.',
    };
  }
  return {
    cause: 'The RPC provider is failing or unreachable.',
    action: 'Check status.helius.dev and the Helius dashboard.',
  };
}

const LANE_ADVICE: Record<string, string> = {
  'deploy-backend': 'Open the run: the failing step names the cause, and nothing after it was deployed. Fix, then run deploy-backend again.',
  'ci-fast': 'main is red. Fixing it outranks new work (CONTRIBUTING.md); the stop-the-line issue tracks it.',
  'on-chain': 'The program build or its LiteSVM tests failed on main.',
  'deployed-drift':
    'The program on chain no longer matches main. If main changed the program, run scripts/deploy-devnet.sh; otherwise someone else changed the chain.',
  'backend-watch': 'A service stayed down even after a stopped machine was started.',
  'security-sweep': 'A new advisory or licence finding. Open the run for the package and fix.',
};

/** The cause and first step for one incident. */
export function explain(inc: Incident): Explanation {
  const [kind, ...rest] = inc.key.split(':');
  const name = rest.join(':');
  switch (kind) {
    case 'service':
      // 2026-10-16: Fly's platform-wide, region-by-region host reboots took
      // the daemon down for 14 minutes and the indexer for 31, one machine
      // each; both came back by themselves. The machine events said so (flyd
      // "crash", exit_code=-1, not OOM, not requested), and status.flyio.net
      // named it.
      return {
        cause: `${name} is not answering. Fly takes a failing machine out of routing but does not restart it.`,
        action: `First look at status.flyio.net: during Fly host maintenance a service is down 15–30 minutes and returns by itself. Otherwise ${BACKEND_STATUS}. If it shows "max usage reached", the Helius credits are spent. A running but stuck machine needs \`fly machine restart\` (HOSTING.md).`,
      };
    case 'daemon':
      if (name === 'tick-stale') {
        return {
          cause: 'The settlement service has not finished a tick for minutes. Nothing opens, settles or pays while this lasts.',
          action: `Usually the RPC provider (look for an RPC alert). Otherwise ${BACKEND_STATUS} (daemon) and restart the machine if the logs have stopped moving.`,
        };
      }
      if (name === 'tick-errors') {
        return {
          cause:
            'The settlement service runs, but one of its steps fails every tick while /health still reads ok — the pattern behind the 2026-10-10 entry outage.',
          action: `${BACKEND_STATUS} (daemon) and search for "tick error": its "action" names the step (keeper = opening pools and pass collections, settle = a closing pool).`,
        };
      }
      return {
        cause: 'The settlement signer pays for pool launches, settlement and payouts. When it runs dry they stop.',
        action: 'Send SOL to the settlement signer (its address is in HOSTING.md). On devnet: solana airdrop.',
      };
    case 'pools':
      if (name === 'not-enterable') {
        return {
          cause: 'An open pool lacks something the program checks at entry, so every entry is refused.',
          action:
            'A missing pass collection means the settlement service’s launch step is failing — see its tick errors and logs ("keeper:failed"). Paused entries are lifted with scripts/admin.ts.',
        };
      }
      if (name === 'past-deadline') {
        return {
          cause: 'The settlement service has not closed a pool whose deadline has passed.',
          action: `${BACKEND_STATUS} (daemon, "settle:failed").`,
        };
      }
      return {
        cause: 'The settlement service is not opening the next pool on an enabled tier.',
        action: `${BACKEND_STATUS} (daemon, "keeper:hold" names the reason). If the treasury is short, it is a funding question.`,
      };
    case 'treasury':
      return {
        cause: 'The platform treasury cannot fund the next pot, so that tier will not open another pool.',
        action: 'Fund the platform treasury (OPERATING-MANUAL, treasury section), or disable the tier.',
      };
    case 'indexer':
      if (name === 'read-api') {
        // 2026-10-17: the database's plan quota was spent; every query was
        // refused for 37 hours while the indexer's /health read ok.
        return {
          cause:
            'The indexer is up, but the pages the site reads (/pools, /treasury) fail, so players see no tournaments. The usual cause is the database: every service shares it, so entries and settlement are likely failing too.',
          action: `${BACKEND_STATUS} (indexer, "read API failed on"). If it says "exceeded the quota", the Neon plan's limit is spent: console.neon.tech → Billing.`,
        };
      }
      if (name === 'chain-read') {
        return {
          cause: 'The indexer’s own chain reads are failing, so its numbers fall back to its ledger.',
          action: 'Usually the RPC provider — look for an RPC alert.',
        };
      }
      return {
        cause: 'The site is showing stale pools or entrant counts.',
        action: `${BACKEND_STATUS} (indexer, "reconciliation walk failed"). Run Actions → indexer-backfill if it does not catch up.`,
      };
    case 'rpc':
      return forRpc(inc);
    case 'alerts': {
      const reason = rest.slice(1).join(':');
      return (
        REASON_ADVICE[reason] ?? {
          cause: `The service raised its own "${reason}" alert.`,
          action: `${BACKEND_STATUS}; the alert is defined in backend/_shared/src/metrics.ts.`,
        }
      );
    }
    case 'site':
      if (name === 'deploy-lag') {
        return {
          cause: 'Vercel has not deployed the latest main — usually a failed build.',
          action: 'Vercel → the project → Deployments: open the failed build’s log.',
        };
      }
      return {
        cause:
          name === 'domain'
            ? 'www.blotto.gg is not answering: domain, certificate or Vercel. The Android app loads this same site.'
            : 'The web app on Vercel is not answering. The Android app loads the same site, so it is down too.',
        action: 'Check vercel.com → the project → Deployments and Domains, and vercel-status.com.',
      };
    case 'github':
      return {
        cause: `The ${name} workflow failed on main.`,
        action: LANE_ADVICE[name] ?? 'Open the run linked above.',
      };
    case 'watch':
      if (name === 'github') {
        return {
          cause: 'The watcher’s GitHub token was refused — it has probably expired. CI alerts and diagnoses are paused.',
          action: 'Create a new fine-grained token (HOSTING.md, "The watcher"), update WATCH_GITHUB_TOKEN, run deploy-watch.',
        };
      }
      if (name === 'chain-rpc') {
        return {
          cause: 'The watcher cannot read the chain through its own RPC, so the pool checks are blind.',
          action: 'Check WATCH_CHAIN_RPC_URL (the public devnet RPC by default).',
        };
      }
      return {
        cause: 'The watcher cannot reach that service’s private metrics, so its own alerts are invisible.',
        action: 'Check that the app runs with BLOTTO_MONITOR_SINK=prometheus and that both apps are in the same Fly organisation.',
      };
    default:
      return { cause: 'Not a failure the watcher recognises.', action: 'Wait for the diagnosis below, or read the logs.' };
  }
}
