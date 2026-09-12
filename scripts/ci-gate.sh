#!/usr/bin/env bash
#
# May this commit be deployed?
#
# `deploy-backend` ships four services that hold the settlement keypair and
# the Turnkey private key. Until 2026-09-12 it would ship them from whatever
# ref the dispatcher happened to pick, with no test, typecheck or lint having
# run against that commit (audit 2026-09-11, findings G-10 and E-16). The
# only statement of the main-only convention was one sentence of prose in
# docs/go-live-devnet.md.
#
# This script is the enforcement. It answers one question — may the commit
# named by GATE_SHA, reached by the ref named by GATE_REF, be deployed? — and
# says why not when the answer is no.
#
#   exit 0   go
#   exit 1   refused; the reason is printed and, under Actions, annotated
#   exit 2   the gate itself is broken (self-test failed)
#
# WHY A SCRIPT AND NOT INLINE YAML. The gate's live inputs need a GitHub
# token, so the only way to test the decision is to separate it from the
# fetch. Both halves are pure: `lane_verdict` is JSON in, verdict out, and
# `deploy_decision` is verdicts in, decision out. `--self-test` drives twelve
# fixtures through the first and eleven through the second — six of which must
# REFUSE — so a gate whose jq quietly stopped matching, or whose policy
# quietly became permissive, cannot report "go" for ever. Same
# reasoning as scripts/check-standing-rules.sh and scripts/check-deployed.ts,
# both of which prove their detector fires before reporting a verdict.
#
# FAIL CLOSED. An API error, an unparseable answer, an absent run and an
# unrecognised status are all refusals, never passes. A gate that fails open
# is not a gate.
#
# Environment (live mode):
#   GH_TOKEN            a token that can read Actions runs (actions: read)
#   GH_REPO             owner/repo
#   GATE_SHA            the commit to be deployed (github.sha)
#   GATE_REF            the ref it was dispatched from (github.ref)
#   GATE_ALLOW_RED      "true" lets a red or missing CI result through; it
#                       never lets a non-main ref through
#   GATE_WAIT_SECONDS   how long to wait for a run still in flight (default
#                       600 — the founder clicks deploy minutes after a merge)
#   GATE_POLL_SECONDS   gap between polls (default 20)

set -uo pipefail

# The lane that must be green, and the lane that must not be red when it ran.
# ci-fast runs on every push to main; on-chain runs only when program code
# changed, so its absence is normal and is not a refusal.
REQUIRED_LANE="ci-fast.yml"
OPTIONAL_LANE="on-chain.yml"

# ---------------------------------------------------------------------------
# The pure half: a lane's runs for one commit → one verdict.
#
#   success        at least one completed run concluded success
#   pending        no success yet, and at least one run is still in flight
#   failed:<why>   no success, nothing in flight, and a completed run did not
#                  succeed (cancelled and timed_out included — neither is
#                  evidence that the tests passed)
#   absent         no run at all for this commit
#   broken:<why>   the answer could not be read as runs
#
# A success anywhere wins: a re-run that goes green after a red attempt is a
# green lane, which is exactly what the Actions UI shows.
# ---------------------------------------------------------------------------
lane_verdict() {
  local json="$1" count
  if ! printf '%s' "$json" | jq -e 'has("workflow_runs")' >/dev/null 2>&1; then
    echo "broken:unreadable"
    return
  fi
  count=$(printf '%s' "$json" | jq '.workflow_runs | length')
  if [ "$count" = "0" ]; then
    echo "absent"
    return
  fi
  if printf '%s' "$json" | jq -e '[.workflow_runs[] | select(.status == "completed" and .conclusion == "success")] | length > 0' >/dev/null; then
    echo "success"
    return
  fi
  if printf '%s' "$json" | jq -e '[.workflow_runs[] | select(.status != "completed")] | length > 0' >/dev/null; then
    echo "pending"
    return
  fi
  # Nothing green, nothing running: report the newest run's conclusion by
  # name. `// "none"` keeps a null conclusion legible rather than empty.
  local why
  why=$(printf '%s' "$json" | jq -r '[.workflow_runs[]] | sort_by(.id) | last | (.conclusion // "none")')
  echo "failed:${why}"
}

# ---------------------------------------------------------------------------
# The policy: two lane verdicts and the override flag → one decision.
#
#   go                  deploy
#   override:<problem>  deploy, loudly, because a person ticked the box
#   refuse:<problem>    do not deploy
#
# ci-fast must be GREEN. It is the lane that covers the backend being shipped,
# so anything other than a success — red, cancelled, still running past the
# wait, or never having run — is a refusal.
#
# on-chain must merely not be RED. It tests the program, which this workflow
# does not ship, so its absence is normal (it runs only on program changes)
# and waiting out its ~10 minutes would delay every backend deploy for a lane
# that ships nothing here. A failure still refuses: it says this commit is
# broken, and the backend encodes that program's instructions by hand.
# ---------------------------------------------------------------------------
deploy_decision() {
  local required="$1" optional="$2" allow_red="$3" problem=""
  case "$required" in
    success) ;;
    absent)  problem="no ci-fast run exists for this commit" ;;
    pending) problem="ci-fast is still running" ;;
    broken:*) problem="ci-fast could not be read (${required#broken:})" ;;
    *)       problem="ci-fast is ${required#failed:}" ;;
  esac
  if [ -z "$problem" ]; then
    case "$optional" in
      success|absent|pending) ;;
      broken:*) problem="on-chain could not be read (${optional#broken:})" ;;
      *)        problem="on-chain is ${optional#failed:}" ;;
    esac
  fi
  if [ -z "$problem" ]; then
    echo "go"
  elif [ "$allow_red" = "true" ]; then
    echo "override:${problem}"
  else
    echo "refuse:${problem}"
  fi
}

# ---------------------------------------------------------------------------
# The impure half: fetch one lane's runs for one commit.
# ---------------------------------------------------------------------------
fetch_runs() {
  local lane="$1" body status
  body=$(curl --silent --show-error --max-time 30 \
    --write-out '\n%{http_code}' \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GH_REPO}/actions/workflows/${lane}/runs?head_sha=${GATE_SHA}&per_page=20" 2>/dev/null)
  status=$(printf '%s' "$body" | tail -n1)
  if [ "$status" != "200" ]; then
    # A 404 here means the workflow file itself is gone, which is a refusal
    # like any other: we cannot show the lane was green.
    echo "{\"http_error\":${status}}"
    return
  fi
  printf '%s' "$body" | sed '$d'
}

say() { printf '%s\n' "$*"; }
refuse() {
  say "::error::deploy refused — $*"
  say ""
  say "Nothing was deployed. docs/deploy-backend.md Step 5 explains both preconditions."
  exit 1
}

# ---------------------------------------------------------------------------
# Self-test: the fixtures the live path will never produce on demand.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  failures=""
  expect() {
    local name="$1" want="$2" json="$3" got
    got=$(lane_verdict "$json")
    if [ "$got" != "$want" ]; then
      failures="${failures}\n  ${name}: expected '${want}', got '${got}'"
    fi
  }

  run() { # status conclusion id → one run object
    printf '{"id":%s,"status":"%s","conclusion":%s}' "$3" "$1" \
      "$([ "$2" = "null" ] && echo null || printf '"%s"' "$2")"
  }
  runs() { printf '{"total_count":%s,"workflow_runs":[%s]}' "$#" "$(IFS=,; echo "$*")"; }

  expect "a green run"              success        "$(runs "$(run completed success 3)")"
  expect "a red run"                failed:failure "$(runs "$(run completed failure 3)")"
  expect "a cancelled run"          failed:cancelled "$(runs "$(run completed cancelled 3)")"
  expect "a timed-out run"          failed:timed_out "$(runs "$(run completed timed_out 3)")"
  expect "a run still going"        pending        "$(runs "$(run in_progress null 3)")"
  expect "a queued run"             pending        "$(runs "$(run queued null 3)")"
  expect "no run at all"            absent         '{"total_count":0,"workflow_runs":[]}'
  expect "a re-run that went green" success        "$(runs "$(run completed failure 3)" "$(run completed success 4)")"
  expect "red, then a re-run going" pending        "$(runs "$(run completed failure 3)" "$(run in_progress null 4)")"
  expect "two reds: the newest one" failed:startup_failure \
    "$(runs "$(run completed failure 3)" "$(run completed startup_failure 9)")"
  expect "an API error"             broken:unreadable '{"http_error":403}'
  expect "garbage"                  broken:unreadable 'not json at all'

  # And the policy on top of those verdicts. Four of these must refuse, or
  # the gate is decorative.
  decides() {
    local name="$1" want="$2" got
    got=$(deploy_decision "$3" "$4" "${5:-false}")
    if [ "$got" != "$want" ]; then
      failures="${failures}\n  ${name}: expected '${want}', got '${got}'"
    fi
  }
  decides "green, program lane absent"   go                                    success success
  decides "green, program lane untouched" go                                   success absent
  decides "green, program lane running"  go                                    success pending
  decides "green, program lane red"      "refuse:on-chain is failure"          success failed:failure
  decides "red backend lane"             "refuse:ci-fast is failure"           failed:failure success
  decides "backend lane never ran"       "refuse:no ci-fast run exists for this commit" absent absent
  decides "backend lane still running"   "refuse:ci-fast is still running"     pending absent
  decides "the API could not be read"    "refuse:ci-fast could not be read (unreadable)" broken:unreadable absent
  decides "override on a red lane"       "override:ci-fast is failure"         failed:failure success true
  decides "override on a red program lane" "override:on-chain is timed_out"    success failed:timed_out true
  decides "override changes nothing when green" go                             success success true

  if [ -n "$failures" ]; then
    say "ci-gate: BROKEN — the gate failed its own self-test."
    # shellcheck disable=SC2059
    printf "$failures\n"
    exit 2
  fi
  say "ci-gate self-test: 12 lane verdicts and 11 decisions correct (6 of them refusals)."
  exit 0
fi

# ---------------------------------------------------------------------------
# Live.
# ---------------------------------------------------------------------------
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GH_REPO:?GH_REPO is required}"
: "${GATE_SHA:?GATE_SHA is required}"
: "${GATE_REF:?GATE_REF is required}"
allow_red="${GATE_ALLOW_RED:-false}"
wait_seconds="${GATE_WAIT_SECONDS:-600}"
poll_seconds="${GATE_POLL_SECONDS:-20}"

say "commit : ${GATE_SHA}"
say "ref    : ${GATE_REF}"
say ""

# 1. The ref. No override: the way to deploy a branch is to merge it.
#    Without this, the dispatch ref selector plus a plain checkout is an
#    undocumented rollback path that redeploys older code with today's
#    credentials (audit 2026-09-11, E-16).
if [ "$GATE_REF" != "refs/heads/main" ]; then
  refuse "this workflow deploys 'main' only, and it was dispatched from '${GATE_REF}'. Merge the change first, then run it again on main. There is no override for this."
fi
say "ref check: main — ok"

# 2. The lanes. Wait for ci-fast if it is still in flight, then decide.
#    Only ci-fast is waited on: see deploy_decision above for why on-chain is
#    judged but never waited for.
deadline=$(( $(date +%s) + wait_seconds ))
while :; do
  required=$(lane_verdict "$(fetch_runs "$REQUIRED_LANE")")
  [ "$required" = "pending" ] || break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    say "ci-fast is still running after ${wait_seconds}s — not waiting any longer."
    break
  fi
  say "waiting for ci-fast on this commit (next look in ${poll_seconds}s)…"
  sleep "$poll_seconds"
done
optional=$(lane_verdict "$(fetch_runs "$OPTIONAL_LANE")")

say "ci-fast : ${required}"
say "on-chain: ${optional}   (absent is normal — it runs only when program code changes, and it is never waited on)"
say ""

decision=$(deploy_decision "$required" "$optional" "$allow_red")
case "$decision" in
  go)
    ;;
  override:*)
    say "::error::DEPLOYING PAST A RED LANE ON PURPOSE — ${decision#override:}. This run was dispatched with 'deploy_despite_red_ci' ticked. The code about to be deployed has not been shown to pass its tests."
    say "::notice::deploy_despite_red_ci was used for ${GATE_SHA} (${decision#override:})"
    ;;
  *)
    refuse "${decision#refuse:}. Fix it and merge, or re-run with 'deploy_despite_red_ci' ticked if the red lane is unrelated to the backend — the ci-fast lane also lints and builds the web app, so an app-side failure can block a backend-only fix."
    ;;
esac

say "gate: go"
