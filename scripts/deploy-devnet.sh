#!/usr/bin/env bash
#
# Program deploy (C12) — the one script behind docs/guide/DEVNET-REHEARSAL.md
# step 1 plus the data-plane catch-up:
#
#   1. put the REAL program keypair in place (never committed — the path
#      comes from the environment),
#   2. `anchor build` + `solana program deploy` against the configured
#      cluster,
#   3. apply every pending database migration (the forward-only runner:
#      a clean database gets all of them; an existing one gets exactly
#      the new files — 0004/0005/0006/... in filename order),
#   4. `re-derive` the derived tables from the events ledger.
#
# Environment:
#   BLOTTO_PROGRAM_KEYPAIR   path to the program keypair JSON (required)
#   BLOTTO_DEPLOY_KEYPAIR    path to the keypair that pays and holds the
#                            upgrade authority (required; the manual's rule 1:
#                            every solana command names its key explicitly)
#   BLOTTO_CLUSTER           devnet (default) | mainnet
#   BLOTTO_CONFIRM_MAINNET   must be exactly "1" for a mainnet deploy
#   BLOTTO_DATABASE_URL      the indexer database (required for steps 3-4;
#                            skipped with a warning when unset)
#   ANCHOR_PROVIDER_URL      RPC override — a FULL URL, not a moniker
#                            (export it, a bare assignment on its own line
#                            does not reach child processes). Required on
#                            mainnet; on devnet it defaults to the public
#                            endpoint below.
#
# The file keeps its name because the docs and the runbook cite it; since
# 2026-09-08 the cluster is a variable, not a word in the script. Mainnet is
# refused unless it is asked for twice (BLOTTO_CLUSTER and the confirm flag),
# and refused outright with a keypair whose path names devnet — the mainnet
# program is a FRESH keypair and id, so a devnet key leak can never touch it.
#
# Refuses to run if the keypair's pubkey does not match the program's
# declared id — deploying under a different id would strand every client.
#
# 2026-09-12, the first upgrade from a Mac, taught three things this script
# now carries: the loader refuses an extension under 10,240 bytes; the
# deploy's parallel sender opens hundreds of connections and dies with "Too
# many open files" under macOS's default limit of 256, which surfaced as
# "Blockhash expired" on every write; and a deploy that lands most of its
# pieces can be RESUMED from the buffer the CLI names, rather than started
# over. The upload is sent by `solana program deploy` directly (not `anchor
# deploy`, which is deprecated and takes no retry flags), with the key named.
#
# THREE THINGS CHANGED 2026-09-12 (audit 2026-09-11, A-11 / E-18 / D-25):
#
#   1. THE CLUSTER NAME IS NEVER PASSED AS `--url`. `--url mainnet` is not a
#      Solana CLI moniker (the mainnet one has always been `mainnet-beta`),
#      so every mainnet `solana program show` failed, the failure was read as
#      "no program on this cluster", and the programdata-extend guard
#      silently disabled itself on the one cluster where an unextended
#      upgrade costs real money. `rpc_url_for` now resolves the cluster to a
#      URL once and everything downstream uses that URL. Full URLs rather
#      than monikers on purpose: this repository's Solana CLI version is
#      pinned in .github/workflows/on-chain.yml but the operator's laptop is
#      not, and a URL cannot be a moniker the installed CLI has renamed.
#
#   2. "NO PROGRAM HERE" AND "THE RPC FAILED" ARE DIFFERENT ANSWERS. The old
#      guard collapsed them: `solana program show ... || true` captured an
#      empty string either way and reported a first deploy. An RPC outage
#      during an UPGRADE therefore skipped the extend AND switched the deploy
#      to the first-deploy form. The question is now asked of the JSON-RPC
#      node directly (getAccountInfo, whose `value: null` is a definitive
#      "this account does not exist" and whose transport or `error` answers
#      are definitively not), and an ambiguous answer REFUSES.
#
#   3. THE SIGNING KEY IS NAMED AND THE AMBIENT DEFAULT MUST AGREE. Every
#      `solana` command here passes `-k "$BLOTTO_DEPLOY_KEYPAIR"`, but the
#      CLI's configured default keypair is what an operator reads when they
#      check "which key am I using", and a script that signs with one key
#      while `solana config get` names another is how the wrong authority
#      ends up on a program. They must match, and on an upgrade the deploy
#      key must also BE the program's current upgrade authority — which it
#      stops being the moment the authority moves to the Squads vault. That
#      transfer has no path through this script by design; the procedure is
#      docs/guide/OPERATING-MANUAL.md §4, "Upgrading once the authority is a
#      Squads vault".
#
# `--self-test` drives the two decisions that have no business being tested
# only in production — the cluster→URL resolution and the three-way account
# answer — through fixtures, and is run by ci-fast. Same reasoning as
# scripts/ci-gate.sh: the live inputs need a cluster, so the only way to know
# the logic still judges correctly is to separate it from the fetch.

set -euo pipefail

# ---------------------------------------------------------------------------
# Pure: the cluster's RPC URL.
#
# Prints the URL, or `refuse:<why>`. ANCHOR_PROVIDER_URL wins when set.
#
# There is no public mainnet fallback here, deliberately, and the same rule
# is stated in backend/.env.example for the services: the public mainnet-beta
# endpoint is rate-limited well below what a program upload needs, and a
# mainnet deploy that dies halfway through its upload is the expensive
# failure this whole file is arranged to avoid. Name the endpoint or do not
# deploy to mainnet.
# ---------------------------------------------------------------------------
rpc_url_for() {
  local cluster="$1" override="${2:-}"
  if [ -n "$override" ]; then
    case "$override" in
      http://*|https://*) printf '%s' "$override"; return 0;;
      *) printf 'refuse:ANCHOR_PROVIDER_URL must be a full http(s) URL, not the moniker %s' "$override"; return 0;;
    esac
  fi
  case "$cluster" in
    devnet)  printf 'https://api.devnet.solana.com';;
    mainnet) printf 'refuse:a mainnet deploy needs an explicit RPC — export ANCHOR_PROVIDER_URL to the Helius mainnet URL. There is no public mainnet fallback (backend/.env.example says the same for the services).';;
    *)       printf 'refuse:unknown cluster %s' "$cluster";;
  esac
}

# ---------------------------------------------------------------------------
# Pure: what did the node say about the program account?
#
#   classify_account_answer <curl-exit-status> <body>
#
#     absent          the node answered, and the account is not there
#     present         the node answered, and it is
#     unknown:<why>   the question was not answered — a transport failure, a
#                     JSON-RPC error, or an answer in a shape we do not
#                     recognise
#
# `unknown` is the whole point. The caller refuses on it rather than
# guessing, because both guesses are wrong in an expensive way: read as
# "absent" it skips the extend and deploys in first-deploy form; read as
# "present" it would try to extend a program that is not there.
# ---------------------------------------------------------------------------
classify_account_answer() {
  local status="$1" body="$2" stripped
  if [ "$status" != "0" ]; then
    printf 'unknown:the RPC did not answer (curl exit %s)' "$status"
    return 0
  fi
  stripped="$(printf '%s' "$body" | tr -d ' \t\r\n')"
  case "$stripped" in
    '') printf 'unknown:the RPC returned an empty body'; return 0;;
  esac
  case "$stripped" in
    *'"error"'*) printf 'unknown:the RPC returned an error: %s' "$stripped"; return 0;;
  esac
  case "$stripped" in
    *'"result"'*) ;;
    *) printf 'unknown:the RPC answer carried no result: %s' "$stripped"; return 0;;
  esac
  case "$stripped" in
    *'"value":null'*) printf 'absent'; return 0;;
    *'"value":{'*)    printf 'present'; return 0;;
    *) printf 'unknown:the RPC answer had a result but no recognisable value: %s' "$stripped"; return 0;;
  esac
}

# ---------------------------------------------------------------------------
# Self-test: the fixtures the live path will never produce on demand.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  failures=""
  want() { # name expected actual
    if [ "$3" != "$2" ]; then
      failures="${failures}
  $1: expected '$2', got '$3'"
    fi
  }
  want "devnet resolves to a URL" \
    "https://api.devnet.solana.com" "$(rpc_url_for devnet)"
  want "mainnet refuses without an explicit RPC" \
    "refuse" "$(rpc_url_for mainnet | cut -d: -f1)"
  want "an override URL wins" \
    "https://rpc.example/x" "$(rpc_url_for devnet https://rpc.example/x)"
  want "an override moniker is refused" \
    "refuse" "$(rpc_url_for mainnet mainnet-beta | cut -d: -f1)"
  want "an unknown cluster is refused" \
    "refuse" "$(rpc_url_for testnet | cut -d: -f1)"

  want "a live node with no such account" \
    "absent" "$(classify_account_answer 0 '{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":null},"id":1}')"
  want "a live node with the program" \
    "present" "$(classify_account_answer 0 '{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":{"lamports":1,"owner":"BPFLoaderUpgradeab1e11111111111111111111111"}},"id":1}')"
  want "a connection that failed" \
    "unknown" "$(classify_account_answer 7 '' | cut -d: -f1)"
  want "a JSON-RPC error" \
    "unknown" "$(classify_account_answer 0 '{"jsonrpc":"2.0","error":{"code":-32005,"message":"Node is behind"},"id":1}' | cut -d: -f1)"
  want "an empty body" \
    "unknown" "$(classify_account_answer 0 '' | cut -d: -f1)"
  want "an HTML error page from a proxy" \
    "unknown" "$(classify_account_answer 0 '<html>502 Bad Gateway</html>' | cut -d: -f1)"
  want "a result in an unrecognised shape" \
    "unknown" "$(classify_account_answer 0 '{"jsonrpc":"2.0","result":{"value":"surprise"},"id":1}' | cut -d: -f1)"

  if [ -n "$failures" ]; then
    echo "deploy: BROKEN — the deploy script failed its own self-test."
    printf '%s\n' "$failures"
    echo
    echo "A guard that cannot tell an outage from an empty cluster is the"
    echo "defect this self-test exists to catch. Fix the check."
    exit 2
  fi
  echo "deploy self-test: 5 cluster resolutions and 7 account answers correct (3 refusals, 5 unknowns)."
  exit 0
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CLUSTER="${BLOTTO_CLUSTER:-devnet}"
case "$CLUSTER" in
  devnet) ;;
  mainnet)
    if [ "${BLOTTO_CONFIRM_MAINNET:-}" != "1" ]; then
      echo "deploy: BLOTTO_CLUSTER=mainnet also needs BLOTTO_CONFIRM_MAINNET=1 — refusing" >&2
      exit 1
    fi
    ;;
  *)
    echo "deploy: BLOTTO_CLUSTER must be devnet or mainnet (got '$CLUSTER')" >&2
    exit 1
    ;;
esac

DECLARED_ID="$(grep -o 'declare_id!("[^"]*")' programs/blotto_cup/src/lib.rs | cut -d'"' -f2)"

if [ -z "${BLOTTO_PROGRAM_KEYPAIR:-}" ]; then
  echo "deploy: BLOTTO_PROGRAM_KEYPAIR is not set (path to the program keypair)" >&2
  exit 1
fi
if [ -z "${BLOTTO_DEPLOY_KEYPAIR:-}" ]; then
  echo "deploy: BLOTTO_DEPLOY_KEYPAIR is not set (path to the fee payer / upgrade authority keypair)" >&2
  exit 1
fi

RPC="$(rpc_url_for "$CLUSTER" "${ANCHOR_PROVIDER_URL:-}")"
case "$RPC" in
  refuse:*)
    echo "deploy: ${RPC#refuse:}" >&2
    exit 1
    ;;
esac

DEPLOY_PUBKEY="$(solana-keygen pubkey "$BLOTTO_DEPLOY_KEYPAIR")"
echo "deploy: signing with $DEPLOY_PUBKEY ($BLOTTO_DEPLOY_KEYPAIR)"
echo "deploy: cluster $CLUSTER via $RPC"

# D-25: the key this script signs with and the key the CLI would sign with
# must be the same key. Every command below names `-k`, so the ambient
# default cannot silently sign anything — but an operator checking "which key
# am I on" reads `solana config get`, and a script that disagrees with it is
# how the wrong authority ends up owning a program. A default that cannot be
# read at all (no config, a path that is not there) is not a disagreement:
# there is nothing to be misled by, so it is reported and allowed.
AMBIENT_PATH="$(solana config get 2>/dev/null | sed -n 's/^Keypair Path:[[:space:]]*//p' | head -1 || true)"
if [ -n "$AMBIENT_PATH" ] && [ -f "$AMBIENT_PATH" ]; then
  AMBIENT_PUBKEY="$(solana-keygen pubkey "$AMBIENT_PATH" 2>/dev/null || true)"
  if [ -n "$AMBIENT_PUBKEY" ] && [ "$AMBIENT_PUBKEY" != "$DEPLOY_PUBKEY" ]; then
    echo "deploy: the CLI's default keypair is NOT the key this deploy was asked to use." >&2
    echo "        asked for : $DEPLOY_PUBKEY  ($BLOTTO_DEPLOY_KEYPAIR)" >&2
    echo "        CLI default: $AMBIENT_PUBKEY  ($AMBIENT_PATH)" >&2
    echo "        Refusing rather than signing with one key while 'solana config get'" >&2
    echo "        reports another. Either point the CLI at the deploy key" >&2
    echo "        ('solana config set --keypair $BLOTTO_DEPLOY_KEYPAIR') or set" >&2
    echo "        BLOTTO_DEPLOY_KEYPAIR to the key you actually meant." >&2
    exit 1
  fi
  echo "deploy: CLI default keypair agrees ($AMBIENT_PATH)"
else
  echo "deploy: no usable CLI default keypair to compare against — every command here names its key"
fi

# The parallel sender needs far more file descriptors than a macOS terminal
# grants by default (256). Raise the soft limit for this process; a shell
# that cannot go to 65536 usually allows 10240, which is enough.
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true
echo "deploy: open-file limit $(ulimit -n)"
if [ "$CLUSTER" = "mainnet" ] && printf '%s' "$BLOTTO_PROGRAM_KEYPAIR" | grep -qi devnet; then
  echo "deploy: refusing a mainnet deploy with a keypair whose path names devnet ($BLOTTO_PROGRAM_KEYPAIR)." >&2
  echo "        The mainnet program is a fresh keypair and id." >&2
  exit 1
fi
KEYPAIR_PUBKEY="$(solana-keygen pubkey "$BLOTTO_PROGRAM_KEYPAIR")"
if [ "$KEYPAIR_PUBKEY" != "$DECLARED_ID" ]; then
  echo "deploy: keypair pubkey $KEYPAIR_PUBKEY does not match declare_id $DECLARED_ID" >&2
  exit 1
fi

mkdir -p target/deploy
cp "$BLOTTO_PROGRAM_KEYPAIR" target/deploy/blotto_cup-keypair.json

echo "deploy: building..."
anchor build

# ---------------------------------------------------------------------------
# Is the program already on this cluster? (E-18.)
#
# Ask the node, not the CLI's exit status. `getAccountInfo` answers with a
# result whose `value` is null when the account does not exist — a positive
# statement from a node that is up — and with a transport failure or an
# `error` member when the question was not answered at all. Those are
# different facts and this script now treats them as different facts.
# ---------------------------------------------------------------------------
ACCOUNT_BODY="$(curl --silent --show-error --max-time 30 \
  -X POST -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$DECLARED_ID\",{\"encoding\":\"base64\"}]}" \
  "$RPC" 2>/dev/null)" && CURL_STATUS=0 || CURL_STATUS=$?
ACCOUNT_STATE="$(classify_account_answer "$CURL_STATUS" "$ACCOUNT_BODY")"

case "$ACCOUNT_STATE" in
  unknown:*)
    echo "deploy: could not establish whether $DECLARED_ID is already deployed." >&2
    echo "        ${ACCOUNT_STATE#unknown:}" >&2
    echo "        Refusing. An unanswered question here used to read as 'fresh cluster'," >&2
    echo "        which skips the programdata extend and switches the upload to its" >&2
    echo "        first-deploy form — both wrong, and both expensive, on an upgrade." >&2
    echo "        Check the RPC ($RPC) and run this again." >&2
    exit 1
    ;;
esac

CURRENT_SIZE=""
CURRENT_AUTHORITY=""
if [ "$ACCOUNT_STATE" = "present" ]; then
  # The account is there; the CLI is what knows how to follow the loader's
  # indirection to the programdata account. A failure HERE is ambiguous
  # again — the account exists, so an unreadable answer is not "no program"
  # — and is refused for the same reason.
  if ! SHOW_OUT="$(solana program show "$DECLARED_ID" --url "$RPC" 2>&1)"; then
    echo "deploy: $DECLARED_ID exists on this cluster but 'solana program show' failed:" >&2
    echo "$SHOW_OUT" >&2
    echo "        Refusing rather than treating an upgrade as a first deploy." >&2
    exit 1
  fi
  CURRENT_SIZE="$(printf '%s' "$SHOW_OUT" | grep -oE 'Data Length: [0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
  CURRENT_AUTHORITY="$(printf '%s' "$SHOW_OUT" | sed -n 's/^Authority:[[:space:]]*//p' | head -1 || true)"
  if [ -z "$CURRENT_SIZE" ]; then
    echo "deploy: 'solana program show' printed no Data Length for $DECLARED_ID:" >&2
    echo "$SHOW_OUT" >&2
    echo "        Refusing: the extend guard cannot size an upgrade it cannot measure." >&2
    exit 1
  fi

  # D-25, the other half: on an UPGRADE the deploy key must be the program's
  # current upgrade authority. Once that authority is the Squads vault this
  # script cannot upgrade the program at all, and should say so in one line
  # rather than failing inside the CLI with a signature error.
  if [ -n "$CURRENT_AUTHORITY" ] && [ "$CURRENT_AUTHORITY" != "$DEPLOY_PUBKEY" ]; then
    echo "deploy: $DECLARED_ID's upgrade authority is NOT the key this deploy signs with." >&2
    echo "        on-chain authority: $CURRENT_AUTHORITY" >&2
    echo "        this deploy's key  : $DEPLOY_PUBKEY" >&2
    echo "        If the authority has moved to the Squads vault, this script cannot" >&2
    echo "        perform the upgrade: follow docs/guide/OPERATING-MANUAL.md §4, 'Upgrading" >&2
    echo "        once the authority is a Squads vault' — write the buffer with this" >&2
    echo "        script's build, then propose and execute the upgrade from Squads." >&2
    exit 1
  fi
fi

# E4 (master prompt v3): on an UPGRADE, a build larger than the deployed
# programdata account fails at deploy — extend first, by the computed
# shortfall. First deploys and same-or-smaller builds skip this without error.
NEW_SIZE="$(stat -c%s target/deploy/blotto_cup.so 2>/dev/null || stat -f%z target/deploy/blotto_cup.so)"
# The loader refuses an extension smaller than 10,240 bytes ("ExtendProgram
# requires a minimum of 10240 additional bytes or to extend to maximum size")
# — found 2026-09-12 on the first upgrade whose build grew by less than that
# (384 bytes). Round the shortfall up to the minimum; the extra rent is about
# 0.07 SOL once and saves the next small growth from extending at all.
MIN_EXTEND_BYTES=10240
if [ -n "$CURRENT_SIZE" ] && [ "$NEW_SIZE" -gt "$CURRENT_SIZE" ]; then
  EXTEND_BY=$((NEW_SIZE - CURRENT_SIZE))
  if [ "$EXTEND_BY" -lt "$MIN_EXTEND_BYTES" ]; then
    echo "deploy: shortfall is $EXTEND_BY bytes; the loader's minimum extension is $MIN_EXTEND_BYTES"
    EXTEND_BY=$MIN_EXTEND_BYTES
  fi
  echo "deploy: extending programdata by $EXTEND_BY bytes ($CURRENT_SIZE -> $((CURRENT_SIZE + EXTEND_BY)))..."
  solana program extend "$DECLARED_ID" "$EXTEND_BY" -k "$BLOTTO_DEPLOY_KEYPAIR" --url "$RPC"
elif [ -n "$CURRENT_SIZE" ]; then
  echo "deploy: programdata size $CURRENT_SIZE covers the new build ($NEW_SIZE) — no extend needed"
else
  echo "deploy: the node reports no account at $DECLARED_ID — first deploy, no extend needed"
fi

echo "deploy: deploying $DECLARED_ID to $CLUSTER..."
# An upgrade names the program by id and the authority signs; a FIRST deploy
# (no program on the cluster yet) must present the program keypair to create
# it under the declared id. If the upload lands only partly, the CLI prints
# the buffer's seed phrase: recover it with `solana-keygen recover -o <file>`
# and rerun with `--buffer <file>` added to the command below, and only the
# missing pieces are sent.
if [ "$ACCOUNT_STATE" = "present" ]; then
  PROGRAM_ARG="$DECLARED_ID"
else
  PROGRAM_ARG="$BLOTTO_PROGRAM_KEYPAIR"
fi
solana program deploy target/deploy/blotto_cup.so --program-id "$PROGRAM_ARG" -k "$BLOTTO_DEPLOY_KEYPAIR" --url "$RPC" --max-sign-attempts 100
solana program show "$DECLARED_ID" --url "$RPC"

if [ -n "${BLOTTO_DATABASE_URL:-}" ]; then
  echo "deploy: applying pending migrations..."
  BLOTTO_DATABASE_URL="$BLOTTO_DATABASE_URL" npm --prefix backend/indexer run migrate
  echo "deploy: rebuilding derived tables..."
  BLOTTO_DATABASE_URL="$BLOTTO_DATABASE_URL" npm --prefix backend/indexer run re-derive
else
  echo "deploy: BLOTTO_DATABASE_URL not set — migrations + re-derive SKIPPED (run them before serving)" >&2
fi

echo "deploy: done. Next: transfer the upgrade authority to the Squads vault"
echo "        (docs/guide/DEVNET-REHEARSAL.md step 1) and start the services."
