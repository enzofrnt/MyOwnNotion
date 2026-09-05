# Validate complete backups

Use an isolated PostgreSQL 18 instance with matching client tools, a disposable
blob directory, backup directory and test deployment key. Never point these
commands at the owner's working installation.

```bash
SPECIFY_FEATURE_DIRECTORY=specs/024-full-server-backups .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
bun run --bun vitest run --project api-contract apps/api/tests/full-backup.integration.spec.ts
bun run checks:local
```

The existing `api-contract` project owns API unit and integration files.

1. Seed all content families, security envelopes, history, page operations,
   files and an extra table unknown to repositories. Capture expected identities,
   sequence state and byte hashes.
2. Run `backup full run`; inspect/verify the resulting file without the catalogue.
   Restore into an empty target, compare all records and file hashes, and prove
   explicit security reactivation is required before recovered service health.
3. Corrupt/truncate a copy and use wrong keys/unsafe/nonempty targets. Each must
   fail before writes. Interrupt creation and restore; partials remain invalid.
4. Start a pending update from a schema older than 0006 while backup fails.
   Source tables, data and migration inventory must remain byte/logically unchanged.
5. Verify daily scheduling, same-day retry, missed-deadline boot catch-up, DST,
   concurrent callers and retention preserving the latest verified copy.
6. Fail remote transfer after local verification. The local file remains usable
   and the UI/CLI report distinct complete/local/remote/portable status.
7. Verify pg_dump/pg_restore and real full recovery inside the built production
   image for both architectures; run relevant image security and Compose checks.

Record actual proof and limitations in validation.md; a completed unit helper
is not proof that the live migration or nightly runtime calls it.
