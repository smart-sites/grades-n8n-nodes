# shellcheck shell=bash
# Shared helpers of bin/cloud-release.sh and bin/ci-cloud.sh (sourced, not run).
#
# gcloud: GCLOUD overrides; on Windows the bundled-python entrypoint is used because gcloud.cmd mangles arguments
# with spaces. Output lines are stripped of CR; stdin is closed so an expired re-auth fails instead of hanging.
PROJECT="${GCP_PROJECT:-grades-prod}"
STAGING="${CLOUDBUILD_STAGING:-gs://grades-prod-cloudbuild/source}"

gcloud_cmd() {
    if [[ -n "${GCLOUD:-}" ]]; then
        "$GCLOUD" "$@"
        return
    fi
    local sdk="${LOCALAPPDATA:-}/Google/Cloud SDK/google-cloud-sdk"
    if [[ -n "${LOCALAPPDATA:-}" && -x "$sdk/platform/bundledpython/python.exe" ]]; then
        "$sdk/platform/bundledpython/python.exe" "$sdk/lib/gcloud.py" "$@"
    else
        gcloud "$@"
    fi
}

g() { gcloud_cmd "$@" --project="$PROJECT" < /dev/null 2>&1 | tr -d '\r'; }

# native_path <path>: a path gcloud (a Windows program under Git Bash) can open.
native_path() {
    if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}

# archive_ref <ref> <out.tar.gz>: `git archive` of a ref with LF line endings (a clean checkout, no ignored files).
archive_ref() {
    git -c core.autocrlf=false archive --format=tar.gz -o "$2" "$1"
}

# submit <source> <config> <substitutions> [extra gcloud args...]: runs the build, streams its log, returns its exit status.
submit() {
    local src="$1" cfg="$2" subs="$3"
    shift 3
    gcloud_cmd builds submit "$(native_path "$src")" --config="$(native_path "$cfg")" \
        --substitutions="$subs" --gcs-source-staging-dir="$STAGING" --region=global \
        --project="$PROJECT" "$@" < /dev/null 2>&1 | tr -d '\r'
    return "${PIPESTATUS[0]}"
}
