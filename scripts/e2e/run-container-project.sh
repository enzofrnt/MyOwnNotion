#!/usr/bin/env bash
set -euo pipefail

# Playwright keeps one browser process alive for the whole project. Linux
# WebKit can stop creating contexts after a long corpus even though the next
# fresh process runs the same journey immediately. Keep the strict functional
# expectations and fail-on-flaky policy, but bound a full WebKit process to one
# third of the corpus. Focused diagnostics stay in one process so `--grep` and
# an explicit caller-provided shard retain their expected meaning.
project=""
recycle_webkit=true
expects_project=false

for argument in "$@"; do
    if $expects_project; then
        project="${argument}"
        expects_project=false
        continue
    fi

    case "${argument}" in
        --project)
            expects_project=true
            ;;
        --project=*)
            project="${argument#--project=}"
            ;;
        --grep | --grep=* | -g | --grep-invert | --grep-invert=* | --last-failed | --list | --ui | --debug | --shard | --shard=*)
            recycle_webkit=false
            ;;
    esac
done

if $expects_project; then
    echo "--project requires an exact browser project" >&2
    exit 1
fi

if [[ "${project}" == webkit-* ]] && $recycle_webkit; then
    for shard in 1/3 2/3 3/3; do
        echo "Running ${project} in recycled browser shard ${shard}."
        bun run --bun playwright test --fail-on-flaky-tests "$@" "--shard=${shard}"
    done
    exit 0
fi

exec bun run --bun playwright test --fail-on-flaky-tests "$@"
