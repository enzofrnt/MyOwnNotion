# CLI contract

`bun run import:notion --source PATH [--id UUID] [--json] [--dry-run] [--apply]`

No apply flag means preview; dry-run takes precedence. Preview requires only the
source. Apply requires a stable explicit UUID, configured DATABASE_URL,
MYOWNNOTION_BLOB_ROOT, MYOWNNOTION_BACKUP_ROOT and
MYOWNNOTION_DEPLOYMENT_KEY_FILE, a ready installation
and installed migrations. It creates an isolated root, never merges by title.
Every new job is backed up with024 before mutation, including an empty target.
Resume retains that first verified receipt.

Text output is a count/code summary. Explicit JSON includes exhaustive source
outcomes and conversion mappings for owner review. Fixed failure codes contain
no source content. Exit0 succeeds,2 denotes invalid input,1 denotes apply/runtime
refusal. Resume repeats the same source/UUID command; changed source refuses.
