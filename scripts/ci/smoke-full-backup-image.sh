#!/usr/bin/env bash
set -euo pipefail

full_image="${1:?usage: smoke-full-backup-image.sh <api-image>}"
full_run="mon-full-image-$$-$(date +%s)"
full_network="${full_run}-network"
full_volume="${full_run}-files"
full_postgres="${full_run}-postgres"

cleanup() {
    docker rm -f "$full_postgres" >/dev/null 2>&1 || true
    docker volume rm "$full_volume" >/dev/null 2>&1 || true
    docker network rm "$full_network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$full_network" >/dev/null
docker volume create "$full_volume" >/dev/null
docker run -d --name "$full_postgres" --network "$full_network" \
    -e POSTGRES_PASSWORD=full-image-fixture postgres:18 >/dev/null
for full_attempt in {1..30}; do
    if docker exec "$full_postgres" pg_isready -U postgres >/dev/null 2>&1; then
        break
    fi
    if [[ "$full_attempt" == 30 ]]; then
        echo 'The disposable PostgreSQL image did not become ready.' >&2
        exit 1
    fi
    sleep 1
done
docker exec "$full_postgres" psql -U postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE full_source' >/dev/null
docker exec "$full_postgres" psql -U postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE full_target' >/dev/null
docker run --rm --user root -v "${full_volume}:/recovery" "$full_image" sh -c \
    'mkdir -p /recovery/blobs /recovery/backups; chown -R bun:bun /recovery'

full_blob_sha="$(docker run --rm -v "${full_volume}:/recovery" "$full_image" bun --eval '
    import { createHash, randomBytes } from "node:crypto";
    import { mkdir, writeFile } from "node:fs/promises";
    const content = Buffer.from("complete-image-fixture");
    const digest = createHash("sha256").update(content).digest("hex");
    await mkdir(`/recovery/blobs/${digest.slice(0, 2)}`, { recursive: true });
    await mkdir("/recovery/blobs/uploads", { recursive: true });
    await writeFile(`/recovery/blobs/${digest.slice(0, 2)}/${digest}`, content);
    await writeFile("/recovery/blobs/uploads/018f2b7c-0000-7000-8000-000000000123", "head-uncommitted-tail");
    await writeFile("/recovery/key", randomBytes(32).toString("base64"), { mode: 0o600 });
    console.log(digest);
')"
if [[ ! "$full_blob_sha" =~ ^[0-9a-f]{64}$ ]]; then
    echo 'The packaged fixture did not produce a valid content address.' >&2
    exit 1
fi
docker exec "$full_postgres" psql -U postgres -d full_source -v ON_ERROR_STOP=1 -c "
    CREATE TABLE historical_fixture(id serial PRIMARY KEY, private_value text);
    INSERT INTO historical_fixture(private_value) VALUES ('unknown-historical-value');
    CREATE TABLE file_contents(storage_key text);
    INSERT INTO file_contents VALUES ('$full_blob_sha');
    CREATE TABLE uploads(id uuid PRIMARY KEY, received_length bigint);
    INSERT INTO uploads VALUES ('018f2b7c-0000-7000-8000-000000000123', 4);
" >/dev/null

full_admin() {
    docker run --rm --network "$full_network" -v "${full_volume}:/recovery" \
        -e "DATABASE_URL=postgres://postgres:full-image-fixture@${full_postgres}:5432/full_source" \
        -e "MYOWNNOTION_RESTORE_DATABASE_URL=postgres://postgres:full-image-fixture@${full_postgres}:5432/full_target" \
        -e MYOWNNOTION_DEPLOYMENT_KEY_FILE=/recovery/key \
        -e MYOWNNOTION_BLOB_ROOT=/recovery/blobs \
        -e MYOWNNOTION_BACKUP_ROOT=/recovery/backups \
        "$full_image" bun dist/admin/admin-cli.js "$@"
}
full_receipt="$(full_admin backup full run --json)"
full_backup_id="$(printf '%s' "$full_receipt" | bun --eval '
    const result = JSON.parse(await Bun.stdin.text());
    if (!result.ok || !/^[0-9a-f-]{36}$/.test(result.data?.backupId)) process.exit(1);
    console.log(result.data.backupId);
')"
full_archive="/recovery/backups/full/${full_backup_id}.monfull"
full_admin backup full verify --file "$full_archive" --json >/dev/null
full_admin restore full test --file "$full_archive" --json >/dev/null
full_admin restore full apply --file "$full_archive" --target-directory /recovery/restored --yes --json >/dev/null
full_admin restore full activate --target-directory /recovery/restored --yes --json >/dev/null

full_restored="$(docker exec "$full_postgres" psql -U postgres -d full_target -Atc 'SELECT private_value FROM historical_fixture')"
[[ "$full_restored" == unknown-historical-value ]]
full_sequence="$(docker exec "$full_postgres" psql -U postgres -d full_target -Atc "SELECT nextval(pg_get_serial_sequence('historical_fixture', 'id'))")"
[[ "$full_sequence" == 2 ]]
docker run --rm -v "${full_volume}:/recovery" -e "FULL_BLOB_SHA=$full_blob_sha" \
    "$full_image" bun --eval '
        const hash = process.env.FULL_BLOB_SHA;
        if (await Bun.file(`/recovery/restored/${hash.slice(0, 2)}/${hash}`).text() !== "complete-image-fixture") process.exit(1);
        if (await Bun.file("/recovery/restored/uploads/018f2b7c-0000-7000-8000-000000000123").text() !== "head") process.exit(1);
        if (await Bun.file("/recovery/restored/.full-restore-state").exists()) process.exit(1);
    '
echo 'Packaged full backup and restore passed (historical SQL, sequence, blobs, committed upload prefix, rehearsal, activation).'
