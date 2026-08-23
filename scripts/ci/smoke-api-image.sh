#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"
if [[ -z "$image" ]]; then
	echo "usage: $0 <api-image>" >&2
	exit 2
fi

docker image inspect "$image" >/dev/null

loro_output="$({
	docker run --rm "$image" node --input-type=module -e \
		"import { LoroDoc } from 'loro-crdt'; new LoroDoc(); console.log('loro-runtime-ok')"
} 2>&1)" || {
	echo "The packaged API cannot load its external Loro runtime dependency:" >&2
	echo "$loro_output" >&2
	exit 1
}
if [[ "$loro_output" != "loro-runtime-ok" ]]; then
	echo "Unexpected Loro runtime probe output: $loro_output" >&2
	exit 1
fi

set +e
migration_output="$(docker run --rm "$image" node dist/migrate.mjs 2>&1)"
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
		"$image" node dist/server.mjs 2>&1
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

echo "Packaged API runtime smoke passed (Loro, migration entrypoint, server entrypoint)."
