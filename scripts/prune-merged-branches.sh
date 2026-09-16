#!/usr/bin/env bash
#
# Delete every remote branch whose work is already in main.
#
# WHY THIS EXISTS. On 2026-09-16 the repository carried 28 branches under three
# competing naming conventions, 21 of them fully merged and simply never
# removed. A branch list that long is not a list anyone reads, and a newcomer
# cannot tell which of them are live.
#
# It is a script rather than a one-off because the agent sessions that produce
# most of these branches cannot delete refs — the push is refused 403 — so the
# cleanup has to be run by a human with normal repository rights.
#
# THE TEST. A branch is deleted only on POSITIVE proof that its work is in main,
# and every such proof is a statement about the branch's CURRENT TIP:
#
#   1. its tip is an ancestor of main, or
#   2. `git cherry` finds every one of its patches already applied to main —
#      the squash-merge case, where no tip of the branch is ever in main.
#
# A branch failing both is LEFT ALONE and printed. No branch is deleted for
# looking old, and none is deleted on the GitHub API's `merged` flag, which
# reads false even for merged PRs sitting in main's history.
#
# WHAT IS DELIBERATELY NOT A TEST, AND MUST NOT BE RE-ADDED.
#
# A branch NAME appearing in a merge commit subject on main — `Merge PR #133
# from <owner>/<branch>` — is NOT proof that the branch is merged. It is proof
# that a branch of that name was merged ONCE. The agent sessions here routinely
# merge a branch, delete it, and later recreate the SAME NAME with new work; the
# old merge commit still names it forever.
#
# This was not hypothetical. The first version of this script carried exactly
# that test as a third clause, and on 2026-09-16 it marked
# `claude/sharp-bohr-c8aeub` — the live battle-test branch, five commits ahead,
# the newest committed hours earlier — as deletable, because main carried
# `Merge PR #133 from tomtblock/claude/sharp-bohr-c8aeub` from an earlier
# lifetime of that name. It also marked `claude/entry-signer-fail-closed`,
# which carried an unmerged commit.
#
# The clause was also redundant. It could only ever run after test 1 had already
# failed, so every branch it could reach was one whose tip is NOT in main. The
# only sound case left to it was a squash merge, which test 2 above decides
# correctly and on evidence. It could remove nothing that test 2 does not, and
# it could remove work.
#
# The lesson generalises: a test here must inspect COMMITS, never names, subject
# lines, or metadata about what happened in the past. `--self-test` pins this by
# building the recreated-branch case and asserting it is kept.
#
# RUN A FULL CLONE. A shallow clone has no real ancestry: `git merge-base`
# fails, every branch looks unmerged, and a naive reading of that says "delete
# nothing" while a naive inversion says "delete everything". The script refuses
# to run shallow rather than guess.
#
# Usage:
#   scripts/prune-merged-branches.sh              # dry run: print the verdicts
#   scripts/prune-merged-branches.sh --delete     # remove the merged ones
#   scripts/prune-merged-branches.sh --self-test  # prove the classifier is sound
set -euo pipefail

REMOTE="${REMOTE:-origin}"
BASE="${BASE:-$REMOTE/main}"
SCOPE="${SCOPE:-remote}"          # remote | local — `local` is for --self-test
MODE="${1:-}"

# --- the classifier -------------------------------------------------------
#
# Populates the globals `drop` and `keep` and prints one line per branch.
# Reads $BASE and $SCOPE. Deliberately free of any network call so --self-test
# can drive it against a throwaway repository.
classify() {
  drop=(); keep=()
  local ns strip current ref b tip why n

  if [ "$SCOPE" = "local" ]; then
    ns="refs/heads/"; strip=""
  else
    ns="refs/remotes/$REMOTE/"; strip="$REMOTE/"
  fi

  current="$(git rev-parse --abbrev-ref HEAD)"

  for ref in $(git for-each-ref --format='%(refname:short)' "$ns"); do
    b="${ref#$strip}"
    [ "$ref" = "$BASE" ] && continue           # never the base itself
    [ "$b" = "HEAD" ] && continue
    [ "$b" = "$current" ] && continue          # never the branch you are on

    tip="$(git rev-parse "$ref")"
    why=""
    if git merge-base --is-ancestor "$tip" "$BASE" 2>/dev/null; then
      why="tip is an ancestor of ${BASE##*/}"
    elif [ "$(git cherry "$BASE" "$ref" 2>/dev/null | grep -c '^+' || true)" = "0" ]; then
      why="every patch already in ${BASE##*/} (squash merge)"
    fi

    if [ -n "$why" ]; then
      drop+=("$b"); printf '  MERGED    %-42s %s\n' "$b" "$why"
    else
      n="$(git cherry "$BASE" "$ref" 2>/dev/null | grep -c '^+' || true)"
      keep+=("$b"); printf '  KEEP      %-42s %s commit(s) not in %s · %s\n' \
        "$b" "$n" "${BASE##*/}" "$(git log -1 --format=%cs "$ref")"
    fi
  done
}

# --- self-test ------------------------------------------------------------
#
# Builds a repository containing one branch of each shape this classifier has
# to tell apart, and asserts every verdict. Exits 2 on any disagreement, so an
# edit that reintroduces a name match fails here rather than in someone's
# branch list. No network, no remote, nothing outside its own temp directory.
self_test() {
  local dir rc=0 fail=0
  dir="$(mktemp -d)"

  (
    cd "$dir"
    git init -q -b main .
    git config user.email t@example.com
    git config user.name t
    git commit -q --allow-empty -m root

    # 1. merged by a merge commit, untouched since   -> MERGED (test 1)
    git checkout -q -b plain-merge
    echo a > a.txt; git add a.txt; git commit -q -m 'add a'
    git checkout -q main
    git merge -q --no-ff -m 'Merge PR #1 from acme/plain-merge' plain-merge

    # 2. squash-merged: its patch is in main, its tip never is -> MERGED (test 2)
    git checkout -q -b squashed main
    echo b > b.txt; git add b.txt; git commit -q -m 'add b'
    git checkout -q main
    git cherry-pick squashed >/dev/null  # same patch-id, different commit

    # 3. merged, branch removed, SAME NAME recreated with new work -> KEEP.
    #    This is the case the removed name-match clause got wrong.
    git checkout -q -b recreated main
    echo c > c.txt; git add c.txt; git commit -q -m 'add c'
    git checkout -q main
    git merge -q --no-ff -m 'Merge PR #2 from acme/recreated' recreated
    git branch -q -D recreated
    git checkout -q -b recreated main
    echo c2 > c2.txt; git add c2.txt; git commit -q -m 'add c2 — new work'

    # 4. never merged -> KEEP
    git checkout -q -b never-merged main
    echo d > d.txt; git add d.txt; git commit -q -m 'add d'

    git checkout -q main

    # The fixture is only meaningful if the trap is actually armed: main must
    # carry a merge commit naming `recreated`. If it does not, this self-test
    # would pass a classifier that IS name-matching, which is worse than useless.
    if ! git log --merges --format='%s' main | grep -q 'from acme/recreated'; then
      echo "self-test BROKEN: main carries no merge commit naming 'recreated'," >&2
      echo "so the fixture does not exercise the case it exists for." >&2
      exit 2
    fi

    BASE=main SCOPE=local
    export BASE SCOPE
    classify > /dev/null

    verdict() {   # $1 = branch, $2 = MERGED|KEEP
      local b="$1" want="$2" got="KEEP"
      if printf '%s\n' "${drop[@]:-}" | grep -Fxq "$b"; then got="MERGED"; fi
      if [ "$got" = "$want" ]; then
        printf '  ok    %-16s %s\n' "$b" "$want"
      else
        printf '  FAIL  %-16s expected %s, got %s\n' "$b" "$want" "$got"
        return 1
      fi
    }

    verdict plain-merge  MERGED || fail=1
    verdict squashed     MERGED || fail=1
    verdict recreated    KEEP   || fail=1
    verdict never-merged KEEP   || fail=1
    exit $fail
  ) || rc=$?
  rm -rf "$dir"

  if [ "$rc" -eq 2 ]; then
    echo "self-test could not run." >&2
    return 2
  elif [ "$rc" -ne 0 ]; then
    echo >&2
    echo "SELF-TEST FAILED — this classifier would delete the wrong branches." >&2
    echo "A branch must be judged on its commits, never on a name in a merge" >&2
    echo "commit subject. See 'WHAT IS DELIBERATELY NOT A TEST' above." >&2
    return 2
  fi
  echo
  echo "self-test passed: the recreated-branch case is kept."
  return 0
}

# --- main -----------------------------------------------------------------

if [ "$MODE" = "--self-test" ]; then
  self_test
  exit $?
fi

if [ "$(git rev-parse --is-shallow-repository)" != "false" ]; then
  echo "refusing to run on a shallow clone — ancestry is not knowable here." >&2
  echo "run:  git fetch --unshallow" >&2
  exit 2
fi

# The classifier is only as current as the refs it reads, and the whole point is
# to avoid removing work that landed while you were not looking.
git fetch "$REMOTE" --prune --quiet

classify

echo
echo "${#drop[@]} merged, ${#keep[@]} kept."

if [ "$MODE" != "--delete" ]; then
  echo "dry run. re-run with --delete to remove the ${#drop[@]} merged branches."
  exit 0
fi

for b in "${drop[@]}"; do
  echo "deleting $REMOTE/$b"
  git push "$REMOTE" --delete "$b"
done
