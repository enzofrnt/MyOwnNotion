# Validation guide: storage privacy and coherence

Use a dedicated worktree and disposable PostgreSQL 18/filesystem fixtures. Install
with `bun ci`, expose PostgreSQL 18 client tools on PATH and follow
[development.md](../../docs/development.md). Never use the owner's running stack
or original dirty checkout for recovery/migration fixtures.

1. Run secured direct/resumable attachment tests and inspect logical SQL dumps and
   application-managed files for unique names/content sentinels. Restart and
   compare whole-file/range reads, metadata, history and synchronized references.
2. Run chunk corruption/substitution/tail deletion/key-loss tests. All affected
   chunks refuse before returning plaintext; no successful upload/backup marker
   is produced for incomplete data.
3. Run historical migration at every declared durable interruption point, with
   current/history-only/shared files, partial uploads and orphan legacy content.
   Verify pre-update full backup refusal performs zero migration writes. Resume,
   verify exact identities/bytes and no remaining active readable source.
4. Exercise wrapping/data-key rotation, interrupted rewrite and generation
   revocation with completed and partial files. Restore portable and full copies
   and open attachments through the real protected application path.
5. Run the isolated 2 GiB streaming/range workload, record baseline/peak server
   RSS and ensure additional file-processing memory stays below 256 MiB. Exclude
   unrelated test concurrency from this measurement.
6. Verify administrative import refuses an occupied target and atomically adopts
   an empty one without trust. Retain 024 full-restore active-device invalidation.
7. Run the maintained browser matrix for pointer cancellation, keyboard submit,
   composition and dirty-form projection refresh. Inspect real caret/layout in
   each theme, and retain native single-instance/offline regression evidence.
8. Complete the audit evidence inventory, Spec Kit analysis/convergence and
   `bun run checks:local` on the exact delivery commit. Read current gate inventory
   before each push; run required image scan evidence, all PR CI, merge and all
   main CI. Record honest remaining limitations in validation.md.

Focused test commands are added to the task/validation artifacts when the named
tests exist. The full gate is never replaced by this guide or a partial suite.
