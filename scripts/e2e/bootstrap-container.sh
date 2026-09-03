#!/usr/bin/env bash
set -euo pipefail

# A browser container is intentionally created from a pristine pinned image.
# Package mirrors and bun.sh can still have a short DNS or transport outage, so
# retry only those idempotent bootstrap operations. Application builds and tests
# remain single-attempt failures.
readonly max_attempts=4

retry_bootstrap() {
    local description="$1"
    shift
    local attempt=1
    local delay_seconds

    until "$@"; do
        if ((attempt >= max_attempts)); then
            echo "${description} failed after ${max_attempts} attempts" >&2
            return 1
        fi
        delay_seconds=$((attempt * 2))
        echo "${description} failed; retrying in ${delay_seconds}s (${attempt}/${max_attempts})" >&2
        sleep "${delay_seconds}"
        attempt=$((attempt + 1))
    done
}

install_unzip() {
    apt-get update -qq &&
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends unzip >/dev/null
}

install_bun() {
    curl --fail --silent --show-error --location https://bun.sh/install |
        bash -s "bun-v1.4.0" >/dev/null
}

export PATH="${HOME}/.bun/bin:${PATH}"
if ! command -v bun >/dev/null || [[ "$(bun --version)" != "1.4.0" ]]; then
    if ! command -v unzip >/dev/null; then
        retry_bootstrap "installing unzip" install_unzip || return 1
        rm -rf /var/lib/apt/lists/*
    fi
    retry_bootstrap "installing Bun 1.4.0" install_bun || return 1
fi

test "$(bun --version)" = "1.4.0" || return 1
retry_bootstrap "installing locked dependencies" bun ci || return 1
