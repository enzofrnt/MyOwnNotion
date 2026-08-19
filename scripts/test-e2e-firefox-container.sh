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

# pnpm includes the conventional separator when forwarding script arguments.
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
    "${playwright_image}" \
    bash -lc 'corepack enable pnpm && pnpm install --frozen-lockfile && exec pnpm exec playwright test --fail-on-flaky-tests "$@"' \
    -- "$@"
