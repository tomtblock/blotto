#!/usr/bin/env bash
#
# Every service image must drop to an unprivileged user (audit 2026-09-11,
# E-22).
#
# All four images ran as root, including the two that decode the settlement
# signer into shared memory at boot. Root inside a container is not root on
# the host, but it removes the last barrier between a remote-code bug in a
# public-facing Node service and everything else in that container — the
# decoded signing key among it.
#
# The fix is one `USER` line per image, which is exactly the kind of line a
# later edit drops without anyone noticing, because nothing about a
# root-running container looks wrong from outside. So it is asserted here.
#
# THE RULE. Every `deploy/docker/Dockerfile.*` must contain a `USER`
# instruction that is neither `root` nor `0`, and it must come BEFORE the
# instruction that starts the service (`CMD` / `ENTRYPOINT`) — a `USER` line
# after them changes nothing about the running process.
#
# Self-test first, as every gate in this repository does: the checker is run
# against images that are deliberately wrong, and must reject each one. A
# gate that has never been seen to fire is not evidence.
set -euo pipefail

fail=0

# Report one problem. Collected rather than fatal, so one run names every
# image that needs attention instead of the first.
problem() {
  printf 'container user: %s\n' "$1" >&2
  fail=1
}

# Check one Dockerfile. Prints nothing when it is fine.
#   $1 — path to the Dockerfile
check_image() {
  local file="$1"
  local user_line user_value first_run_line user_line_no

  # The LAST USER instruction is the one in force when the service starts.
  user_line="$(grep -nE '^[[:space:]]*USER[[:space:]]+' "$file" | tail -n 1 || true)"
  if [ -z "$user_line" ]; then
    problem "$file declares no USER — the service runs as root"
    return
  fi

  user_line_no="${user_line%%:*}"
  user_value="$(printf '%s' "$user_line" | sed -E 's/^[0-9]+:[[:space:]]*USER[[:space:]]+//' | awk '{print $1}')"
  case "$user_value" in
    root | 0 | 0:* | root:*)
      problem "$file sets USER $user_value — that is root"
      return
      ;;
  esac

  # A USER that lands after CMD/ENTRYPOINT changes nothing about the process
  # those lines start.
  first_run_line="$(grep -nE '^[[:space:]]*(CMD|ENTRYPOINT)[[:space:]]' "$file" | head -n 1 | cut -d: -f1 || true)"
  if [ -n "$first_run_line" ] && [ "$user_line_no" -gt "$first_run_line" ]; then
    problem "$file sets USER on line $user_line_no, after the CMD/ENTRYPOINT on line $first_run_line"
  fi
}

# --- self-test ------------------------------------------------------------
# Four images the checker must reject and two it must accept, written to a
# scratch directory and run through the same function as the real ones.
self_test() {
  local dir before
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN

  printf 'FROM node:22-slim\nCMD ["node", "x.js"]\n' > "$dir/no-user"
  printf 'FROM node:22-slim\nUSER root\nCMD ["node", "x.js"]\n' > "$dir/root"
  printf 'FROM node:22-slim\nUSER 0\nCMD ["node", "x.js"]\n' > "$dir/uid-zero"
  printf 'FROM node:22-slim\nUSER node\nUSER root\nCMD ["node", "x.js"]\n' > "$dir/last-wins"
  printf 'FROM node:22-slim\nCMD ["node", "x.js"]\nUSER node\n' > "$dir/too-late"

  printf 'FROM node:22-slim\nUSER node\nCMD ["node", "x.js"]\n' > "$dir/good"
  printf 'FROM node:22-slim\nUSER root\nRUN true\nUSER node\nENTRYPOINT ["/e"]\nCMD ["node", "x.js"]\n' > "$dir/good-drops-late"

  for bad in no-user root uid-zero last-wins too-late; do
    before=$fail
    fail=0
    check_image "$dir/$bad" 2>/dev/null
    if [ "$fail" -eq 0 ]; then
      printf 'container user: SELF-TEST FAILED — the checker accepted %s\n' "$bad" >&2
      exit 2
    fi
    fail=$before
  done

  for good in good good-drops-late; do
    before=$fail
    fail=0
    check_image "$dir/$good"
    if [ "$fail" -ne 0 ]; then
      printf 'container user: SELF-TEST FAILED — the checker rejected %s\n' "$good" >&2
      exit 2
    fi
    fail=$before
  done
}

self_test

# --- the real images ------------------------------------------------------
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shopt -s nullglob
images=("$root_dir"/deploy/docker/Dockerfile.*)
if [ "${#images[@]}" -eq 0 ]; then
  echo 'container user: no deploy/docker/Dockerfile.* found — has the layout moved?' >&2
  exit 2
fi

for image in "${images[@]}"; do
  check_image "$image"
done

if [ "$fail" -ne 0 ]; then
  echo >&2
  echo 'Add a USER line that is not root, before the CMD/ENTRYPOINT. The node:22-slim' >&2
  echo 'base already ships an unprivileged `node` user (uid 1000, with a home directory),' >&2
  echo 'so `COPY --chown=node:node` the tree and `USER node` before the installs.' >&2
  exit 1
fi

echo "container user: ${#images[@]} service image(s) run unprivileged (self-test passed)"
