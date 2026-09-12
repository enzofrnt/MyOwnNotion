# Complete archive format, version 1

Binary prefix: ASCII `MYOWNNOTION-FULL-1\n`, then an unsigned big-endian 32-bit
length of the encrypted JSON manifest, then that manifest. The encrypted
manifest is bounded at 64 MiB; excess is an explicit refusal, never a partial
inventory. Components follow in manifest order, with no trailing data allowed.

Each encrypted component, including the manifest, is nonce (12 bytes), GCM tag
(16 bytes), then ciphertext. Ciphertext length equals plaintext length.
AES-256-GCM uses the externally held 32-byte deployment wrapping material;
nonces are freshly random. Manifest AAD is
`myownnotion.full-backup.manifest.v1`. Component AAD is
`myownnotion.full-backup.component.v1:` followed by the JSON encoding of
`[backupId, componentIndex, relativePath]`. Inventory authentication and AAD bind
identity, ordering and path; missing, substituted or duplicate components fail.

The first component is exactly `database.dump`, a PostgreSQL custom-format dump.
Blob paths are `<first-two-digest-characters>/<64-hex-digest>`; upload paths are
`uploads/<uuid>`. Every component has an exact byte length and plaintext SHA-256
inside the encrypted manifest. The archive does not include the usable external
key, original absolute storage paths, unrelated databases or cluster roles.

Writers stage encrypted components only, then write the complete artifact to an
exclusive temporary file and atomically publish it after full verification.
Readers authenticate the manifest and every component before giving any data to
pg_restore or writing target files. Restore uses an owned immutable copy of the
encrypted input so a mutable external source cannot change between verification
and restore. No plaintext SQL/dump is staged on disk.
