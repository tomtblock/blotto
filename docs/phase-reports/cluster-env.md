# One variable for the cluster — 2026-09-08

Branch `claude/cluster-env` (stacks on `claude/wallet-and-signin`, #91, because the provider
bridge it edits lives there). The first code step towards a mainnet copy: devnet and mainnet
now differ by configuration, not by editing files.

## Before

"devnet" was written into the product in eight places: the provider's chain id, the app's RPC
fallback and explorer link, the daemon, the review service and the indexer's RPC fallbacks,
and both operator scripts. `deploy-devnet.sh` had `--url devnet` three times.

## After

- **App**: `NEXT_PUBLIC_SOLANA_CLUSTER = devnet | mainnet` (unset → devnet) in
  `app/src/chain/cluster.ts` drives `SOLANA_CHAIN`, the RPC fallback, the explorer link and
  the funding method. Mainnet has **no** public fallback RPC and is never inferred from a URL;
  `assertClusterInvariants` is the whole contract as data and `cluster.test.ts` runs it against
  the real build environment, so a mainnet build with a devnet RPC, the faucet link or the
  automation signer fails to build.
- **Services and scripts**: `BLOTTO_CLUSTER` + `BLOTTO_RPC_URL` through
  `backend/_shared/src/cluster.ts::resolveRpcUrl`, used by the daemon, the review service, the
  indexer, `admin.ts` and `check-deployed.ts`. A URL that looks like the other cluster is
  refused at startup. The deploy workflow names `BLOTTO_CLUSTER=devnet` beside every RPC it
  hands over.
- **Deploy script**: `BLOTTO_CLUSTER` selects the cluster; mainnet is refused unless
  `BLOTTO_CONFIRM_MAINNET=1` is also set, and refused outright with a keypair whose path names
  devnet — the mainnet program is a fresh keypair and id, so a devnet key leak can never touch
  it (the recommendation in the address map).

## Judgement calls (PHASE-N-REVIEW)

1. The script keeps its name (`deploy-devnet.sh`) because the docs and runbook cite it.
2. Mainnet needs to be asked for twice in the deploy script; once elsewhere. The script is
   the only place a mistake spends real SOL on a program account.
3. `rpc.test.ts`'s "never mainnet" gate now reads "never mainnet unless the cluster says so";
   the stronger contract moved to `cluster.test.ts`.

## Not in this change (mainnet checklist, from the address map)

Fresh program keypair and id; Squads multisig re-created on mainnet with a real threshold and
the upgrade authority moved into it (O5); settlement signer to Turnkey co-signing (O6); Helius
mainnet project; Privy mainnet chain and domain; a separate Fly app set; and the audit's Stage 5
gates.

## Verification

tsc · eslint 0 errors · 311 app tests (46 files; `cluster.test.ts` new) · backend `_shared`
66, `reveal` 92, `detection` 30, `indexer` 52 · the three gates · `bash -n` on the script ·
`next build`.
