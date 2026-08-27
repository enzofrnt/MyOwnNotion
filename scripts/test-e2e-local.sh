#!/usr/bin/env bash
set -euo pipefail

# Local equivalent of the CI Playwright matrix.
#
# The work is in scripts/e2e/run-local-matrix.ts, which runs every browser
# project at once, each on its own database, ports and blob root. This wrapper
# only makes sure PostgreSQL is up first — the runner creates its own databases
# on that server and drops them afterwards, so nothing here migrates the
# development database.
#
# `CDPATH=''` rather than `CDPATH=`: identical to the shell, but ShellCheck reads
# the bare form as a mistyped `var= value` and raises SC1007, which the pinned
# gate treats as a failure.
repo_root="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

docker compose up -d --wait postgres

exec bun scripts/e2e/run-local-matrix.ts "$@"
