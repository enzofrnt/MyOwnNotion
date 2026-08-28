#!/usr/bin/env bash
set -euo pipefail

# `CDPATH=''` rather than `CDPATH=`: the two are identical to the shell, but
# ShellCheck reads the bare form as a mistyped `var= value` and raises SC1007,
# which the pinned gate treats as a failure (`--severity=style`). The assignment
# itself has to stay — a CDPATH set in the environment makes `cd` print the
# directory it landed in, which would end up inside `repo_root`.
repo_root="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
playwright_image="${MYOWNNOTION_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.1-noble}"
database_url="${DATABASE_URL:-postgres://myownnotion:myownnotion-dev@host.docker.internal:5432/myownnotion}"
deployment_key_file="${MYOWNNOTION_DEPLOYMENT_KEY_FILE:-${repo_root}/secrets/deployment-key}"
e2e_prebuilt_web="${MYOWNNOTION_E2E_PREBUILT_WEB:-0}"

# The repository is mounted at /work, so translate an isolated host-side key
# created by the matrix runner to the path seen by the container. Refuse keys
# outside that mount instead of silently starting with a missing secret.
case "${deployment_key_file}" in
    "${repo_root}"/*)
        container_deployment_key_file="/work/${deployment_key_file#"${repo_root}"/}"
        ;;
    *)
        echo "MYOWNNOTION_DEPLOYMENT_KEY_FILE must be inside ${repo_root}" >&2
        exit 1
        ;;
esac

# Bun accepts the conventional separator when forwarding script arguments.
# Remove it so Playwright receives the actual options (`--project`, `--grep`, …).
if [[ "${1:-}" == "--" ]]; then
    shift
fi

docker run --rm --ipc=host \
    --add-host=host.docker.internal:host-gateway \
    --volume "${repo_root}:/work" \
    --volume /work/node_modules \
    --workdir /work \
    --env CI=1 \
    --env DATABASE_URL="${database_url}" \
    --env MYOWNNOTION_BLOB_ROOT=/tmp/myownnotion-blobs \
    --env MYOWNNOTION_BACKUP_ROOT=/tmp/myownnotion-backups \
    --env MYOWNNOTION_DEPLOYMENT_KEY_FILE="${container_deployment_key_file}" \
    --env MYOWNNOTION_E2E_PREBUILT_WEB="${e2e_prebuilt_web}" \
    "${playwright_image}" \
    bash -lc 'if ! command -v unzip >/dev/null; then apt-get update -qq && apt-get install -y --no-install-recommends unzip >/dev/null && rm -rf /var/lib/apt/lists/*; fi && curl --fail --silent --show-error --location https://bun.sh/install | bash -s "bun-v1.4.0" >/dev/null && export PATH="${HOME}/.bun/bin:${PATH}" && test "$(bun --version)" = "1.4.0" && bun ci && if [[ "${MYOWNNOTION_E2E_PREBUILT_WEB}" != "1" ]]; then MYOWNNOTION_E2E_BUILD=1 bun run --filter @myownnotion/web build; fi && exec bun run --bun playwright test --fail-on-flaky-tests "$@"' \
    -- "$@"
