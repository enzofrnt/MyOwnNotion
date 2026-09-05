#!/usr/bin/env bash
set -euo pipefail

# Only client utilities are installed; this never starts a PostgreSQL service.
repo_root="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source /etc/os-release
case "${ID}:${VERSION_ID}" in
debian:13)
    pg_suite=trixie-pgdg
    pg_package=18.6-1.pgdg13+2
    ;;
ubuntu:24.04)
    pg_suite=noble-pgdg
    pg_package=18.6-1.pgdg24.04+2
    ;;
*)
    printf 'Unsupported PostgreSQL client installation platform.\n' >&2
    exit 1
    ;;
esac

install -m 0644 "${repo_root}/docker/postgresql-pgdg.asc" /usr/share/keyrings/myownnotion-postgresql.asc
cat >/etc/apt/sources.list.d/myownnotion-postgresql.sources <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${pg_suite}
Components: main
Signed-By: /usr/share/keyrings/myownnotion-postgresql.asc
EOF
apt-get update
apt-get install -y --no-install-recommends "postgresql-client-18=${pg_package}" "libpq5=${pg_package}"
/usr/lib/postgresql/18/bin/pg_dump --version
/usr/lib/postgresql/18/bin/pg_restore --version
rm -rf /var/lib/apt/lists/*
