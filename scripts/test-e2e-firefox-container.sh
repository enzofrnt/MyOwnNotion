#!/usr/bin/env bash
set -euo pipefail

# Generic pinned Playwright Linux runtime for browser projects that are not
# reliable in Playwright's native macOS runtime. The historical filename is
# retained because the public Firefox command remains a supported alias.

# `CDPATH=''` rather than `CDPATH=`: the two are identical to the shell, but
# ShellCheck reads the bare form as a mistyped `var= value` and raises SC1007,
# which the pinned gate treats as a failure (`--severity=style`). The assignment
# itself has to stay — a CDPATH set in the environment makes `cd` print the
# directory it landed in, which would end up inside `repo_root`.
repo_root="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
playwright_image="${MYOWNNOTION_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.1-noble}"
database_url="${DATABASE_URL:-postgres://myownnotion:myownnotion-dev@host.docker.internal:5432/myownnotion}"
deployment_key_file="${MYOWNNOTION_DEPLOYMENT_KEY_FILE:-${repo_root}/secrets/deployment-key}"
container_web_dist="/tmp/myownnotion-e2e-web-dist"

# Refuse a key outside the checkout, then append only that exact file to the
# streamed archive. A Docker Desktop bind mount can retain the same stale file
# handle as the source tree, while the archive gives the API an immutable copy.
case "${deployment_key_file}" in
    "${repo_root}"/*)
        deployment_key_name="$(basename -- "${deployment_key_file}")"
        ;;
    *)
        echo "MYOWNNOTION_DEPLOYMENT_KEY_FILE must be inside ${repo_root}" >&2
        exit 1
        ;;
esac
if [[ ! -f "${deployment_key_file}" ]]; then
    echo "MYOWNNOTION_DEPLOYMENT_KEY_FILE must name an existing file" >&2
    exit 1
fi
case "${deployment_key_name}" in
    *[!A-Za-z0-9._-]* | "" | "." | "..")
        echo "MYOWNNOTION_DEPLOYMENT_KEY_FILE must have a portable basename" >&2
        exit 1
        ;;
esac
if [[ -e "${repo_root}/${deployment_key_name}" ]]; then
    echo "MYOWNNOTION_DEPLOYMENT_KEY_FILE basename collides with a repository root entry" >&2
    exit 1
fi
container_deployment_key_file="/work/${deployment_key_name}"

# Bun accepts the conventional separator when forwarding script arguments.
# Remove it so Playwright receives the actual options (`--project`, `--grep`, …).
if [[ "${1:-}" == "--" ]]; then
    shift
fi

# Docker Desktop can retain stale file handles when a host build replaces a
# directory, and a bind-mounted Vite preview then returns index.html for assets
# that `ls` can still name but `fstat` cannot open. Stream one immutable source
# snapshot into the container instead. Local credentials, dependencies, build
# output and test artefacts never enter that snapshot.
mkdir -p "${repo_root}/test-results"
COPYFILE_DISABLE=1 tar --no-xattrs -C "${repo_root}" -cf - \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    --exclude='./secrets' \
    --exclude='./node_modules' \
    --exclude='*/node_modules' \
    --exclude='*/dist' \
    --exclude='./coverage' \
    --exclude='./test-results' \
    --exclude='./playwright-report' \
    --exclude='./blob-report' \
    --exclude='./.e2e-logs' \
    --exclude='./.dev-blobs*' \
    --exclude='./.dev-backups*' \
    . \
    -C "$(dirname -- "${deployment_key_file}")" "${deployment_key_name}" |
    docker run --rm -i --ipc=host \
        --add-host=host.docker.internal:host-gateway \
        --volume "${repo_root}/test-results:/work/test-results" \
        --workdir /work \
        --env CI=1 \
        --env DATABASE_URL="${database_url}" \
        --env MYOWNNOTION_API_PORT=3001 \
        --env MYOWNNOTION_WEB_PORT=5173 \
        --env MYOWNNOTION_WEB_HOST=localhost \
        --env MYOWNNOTION_PUBLIC_ORIGIN=http://localhost:5173 \
        --env MYOWNNOTION_BLOB_ROOT=/tmp/myownnotion-blobs \
        --env MYOWNNOTION_BACKUP_ROOT=/tmp/myownnotion-backups \
        --env MYOWNNOTION_DEPLOYMENT_KEY_FILE="${container_deployment_key_file}" \
        --env MYOWNNOTION_E2E_WEB_OUTDIR="${container_web_dist}" \
        --env MYOWNNOTION_WEB_DIST_DIR="${container_web_dist}" \
        "${playwright_image}" \
        bash -lc 'tar -xf - -C /work && chmod 0400 "${MYOWNNOTION_DEPLOYMENT_KEY_FILE}" && test "$(bun --version)" = "1.4.0" && test -d node_modules && MYOWNNOTION_E2E_BUILD=1 bun run --filter @myownnotion/web build && exec bash scripts/e2e/run-container-project.sh "$@"' \
        -- "$@"
