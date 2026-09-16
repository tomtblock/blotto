#!/usr/bin/env bash
#
# Delete every remote branch whose work is already in main.
#
# WHY THIS EXISTS. On 2026-09-16 the repository carried 28 branches under three
# competing naming conventions, 21 of them fully merged and simply never
# removed. A branch list that long is not a list anyone reads, and a newcomer
# cannot tell which three of them are live.
#
# It is a script rather than a one-off because the agent sessions that produce
# most of these branches cannot delete refs — the push is refused 403 — so the
# cleanup has to be run by a human with normal repository rights.
#
# THE TEST. A branch is deleted only on POSITIVE proof that its work is in main:
#
#   1. its tip is an ancestor of main, or
#   2. main's history carries a merge commit naming it (`... from <owner>/<branch>`), or
#   3. `git cherry` finds every one of its patches already in main (a squash).
#
# Anything failing all three is LEFT ALONE and printed. No branch is deleted for
# looking old, and none is deleted on the GitHub API's `merged` flag, which
# reads false even for merged PRs sitting in main's history.
#
# RUN A FULL CLONE. A shallow clone has no real ancestry: `git merge-base`
# fails, every branch looks unmerged, and a naive reading of that says "delete
# nothing" while a naive inversion says "delete everything". The script refuses
# to run shallow rather than guess.
#
# Usage:
#   scripts/prune-merged-branches.sh            # dry run: print the verdicts
#   scripts/prune-merged-branches.sh --delete   # actually delete the merged ones
set -euo pipefail

REMOTE="${REMOTE:-origin}"
BASE="${BASE:-$REMOTE/main}"
DELETE=0
[ "${1:-}" = "--delete" ] && DELETE=1

if [ "$(git rev-parse --is-shallow-repository)" != "false" ]; then
  echo "refusing to run on a shallow clone — ancestry is not knowable here." >&2
  echo "run:  git fetch --unshallow" >&2
  exit 2
fi

git fetch "$REMOTE" --prune --quiet

# Branch names named by a merge commit on the base.
merged_by_name="$(git log --merges --format='%s' "$BASE" \
  | grep -oE 'from [^ ]+' | sed 's|from [^/]*/||' || true)"

keep=(); drop=()
current="$(git rev-parse --abbrev-ref HEAD)"

for ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/" \
             | grep -vE "^$REMOTE/(HEAD|main)$"); do
  b="${ref#$REMOTE/}"
  [ "$b" = "$current" ] && continue          # never the branch you are on
  tip="$(git rev-parse "$ref")"

  why=""
  if git merge-base --is-ancestor "$tip" "$BASE" 2>/dev/null; then
    why="tip is an ancestor of main"
  elif printf '%s\n' "$merged_by_name" | grep -Fxq "$b"; then
    why="named by a merge commit on main"
  elif [ "$(git cherry "$BASE" "$ref" 2>/dev/null | grep -c '^+' || true)" = "0" ]; then
    why="every patch already in main (squash merge)"
  fi

  if [ -n "$why" ]; then
    drop+=("$b"); printf '  MERGED    %-42s %s\n' "$b" "$why"
  else
    n="$(git cherry "$BASE" "$ref" 2>/dev/null | grep -c '^+' || true)"
    keep+=("$b"); printf '  KEEP      %-42s %s commit(s) not in main · %s\n' \
      "$b" "$n" "$(git log -1 --format=%cs "$ref")"
  fi
done

echo
echo "${#drop[@]} merged, ${#keep[@]} kept."

if [ "$DELETE" != "1" ]; then
  echo "dry run. re-run with --delete to remove the ${#drop[@]} merged branches."
  exit 0
fi

for b in "${drop[@]}"; do
  echo "deleting $REMOTE/$b"
  git push "$REMOTE" --delete "$b"
done
