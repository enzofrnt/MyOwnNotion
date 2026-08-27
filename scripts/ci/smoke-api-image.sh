#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"
if [[ -z "$image" ]]; then
    echo "usage: $0 <api-image>" >&2
    exit 2
fi

docker image inspect "$image" >/dev/null

bun_output="$(docker run --rm "$image" bun --version 2>&1)" || {
    echo "The packaged API cannot start Bun:" >&2
    echo "$bun_output" >&2
    exit 1
}
if [[ "$bun_output" != "1.4.0" ]]; then
    echo "Unexpected Bun runtime version: $bun_output" >&2
    exit 1
fi

# The official Bun image exposes `node` as a compatibility alias to Bun. That
# alias is acceptable; a separate Node.js binary is not.
node_runtime="$(
    docker run --rm "$image" sh -c '
        node_path="$(command -v node || true)"
        if [ -z "$node_path" ]; then
            printf absent
            exit 0
        fi
        if [ "$(readlink -f "$node_path")" = "$(readlink -f "$(command -v bun)")" ]; then
            printf bun-alias
            exit 0
        fi
        printf "standalone:%s" "$node_path"
    '
)" || {
    echo "Could not inspect the packaged JavaScript runtime identity." >&2
    exit 1
}
if [[ "$node_runtime" != "absent" && "$node_runtime" != "bun-alias" ]]; then
    echo "The packaged API contains a standalone Node.js runtime: $node_runtime" >&2
    exit 1
fi

set +e
migration_output="$(docker run --rm "$image" bun dist/migrate.js 2>&1)"
migration_status=$?
set -e

if ((migration_status != 1)); then
    echo "The migration entrypoint should reject its deliberately missing DATABASE_URL with exit 1; got $migration_status." >&2
    echo "$migration_output" >&2
    exit 1
fi
if [[ "$migration_output" == *"ERR_AMBIGUOUS_MODULE_SYNTAX"* ]]; then
    echo "The migration bundle embedded an incompatible CommonJS/Wasm module." >&2
    echo "$migration_output" >&2
    exit 1
fi
if [[ "$migration_output" != *'"errorCode":"database_url_missing"'* ]]; then
    echo "The migration entrypoint did not reach its own configuration guard." >&2
    echo "$migration_output" >&2
    exit 1
fi

set +e
server_output="$(
    docker run --rm \
        -e DATABASE_URL=postgres://myownnotion:smoke@127.0.0.1:1/myownnotion \
        -e MYOWNNOTION_PUBLIC_ORIGIN=https://localhost \
        "$image" bun dist/server.js 2>&1
)"
server_status=$?
set -e

if ((server_status != 1)); then
    echo "The server entrypoint should reject the deliberately unreachable database with exit 1; got $server_status." >&2
    echo "$server_output" >&2
    exit 1
fi
if [[ "$server_output" == *"ERR_AMBIGUOUS_MODULE_SYNTAX"* ]]; then
    echo "The server bundle embedded an incompatible CommonJS/Wasm module." >&2
    echo "$server_output" >&2
    exit 1
fi
if [[ "$server_output" != *"ECONNREFUSED"* ]]; then
    echo "The server entrypoint did not load far enough to attempt its database connection." >&2
    echo "$server_output" >&2
    exit 1
fi

echo "Packaged API runtime smoke passed (Bun 1.4.0, no standalone Node.js runtime, migration entrypoint, server entrypoint)."
