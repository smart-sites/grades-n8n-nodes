#!/usr/bin/env bash
#
# Run CI for a local branch, commit or worktree on Google Cloud Build (cloudbuild/test.yaml) and print PASS/FAIL.
#
#   bin/ci-cloud.sh feat/my-branch          # a ref of this repository (branch, tag, sha)
#   bin/ci-cloud.sh ../.worktrees/<dir>     # a worktree: its HEAD plus uncommitted changes to tracked files
#
# Uploads `git archive` of the commit (a clean tree, no ignored files). Exit status 0 = PASS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=bin/cloud-lib.sh
. "$ROOT/bin/cloud-lib.sh"
TARGET="${1:?usage: bin/ci-cloud.sh <ref|worktree dir>}"

if [[ -d "$TARGET" ]]; then
    REPO="$(cd "$TARGET" && pwd)"
    REF="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
    SHA="$(git -C "$REPO" stash create 2> /dev/null || true)"
    if [[ -n "$SHA" ]]; then
        echo "note: uncommitted changes to tracked files are included (untracked files are not)"
        REF="$REF+changes"
    else
        SHA="$(git -C "$REPO" rev-parse HEAD)"
    fi
else
    REPO="$ROOT"
    SHA="$(git -C "$REPO" rev-parse --verify "${TARGET}^{commit}")"
    REF="$TARGET"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO" -c core.autocrlf=false archive --format=tar.gz -o "$WORK/source.tar.gz" "$SHA"
echo "CI on Cloud Build: $REF ${SHA:0:12}"
start=$(date +%s)
if submit "$WORK/source.tar.gz" "$ROOT/cloudbuild/test.yaml" "_REF=${REF//,/_}" > "$WORK/build.log" 2>&1; then
    status=PASS
else
    status=FAIL
fi
if [[ "$status" == FAIL || "${CI_CLOUD_VERBOSE:-0}" == 1 ]]; then tail -n 80 "$WORK/build.log"; fi
build="$(sed -n 's|.*/builds/\([0-9a-f-]*\)\].*|\1|p' "$WORK/build.log" | head -n 1)"
echo "$status: $REF ${SHA:0:12} build ${build:-?} ($(( ($(date +%s) - start) / 60 )) min wall)"
[[ "$status" == PASS ]]
