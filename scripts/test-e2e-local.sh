#!/usr/bin/env bash
set -euo pipefail

# Local equivalent of the CI Playwright matrix. Playwright's patched Firefox
# currently hangs before opening a page on the macOS development runtime, so
# macOS runs Chromium/WebKit on the host and Firefox in the pinned Linux image.
# The suites stay sequential because every journey resets the same database.
host_database_url="${TEST_DATABASE_URL:-postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion}"

docker compose up -d --wait postgres
DATABASE_URL="${host_database_url}" pnpm db:migrate

if [[ "$(uname -s)" == "Darwin" ]]; then
    DATABASE_URL="${host_database_url}" pnpm exec playwright test --fail-on-flaky-tests \
        --project=chromium-desktop \
        --project=webkit-desktop \
        --project=chromium-mobile \
        --project=webkit-mobile
    DATABASE_URL="postgres://myownnotion:myownnotion-dev@host.docker.internal:5432/myownnotion" \
        pnpm test:e2e:firefox-container -- --project=firefox-desktop
else
    DATABASE_URL="${host_database_url}" pnpm test:e2e
fi
