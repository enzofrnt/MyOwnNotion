# CLI contract — API replacement

```text
bun run import:notion --discover [--json]
bun run import:notion (--root UUID ... | --all) [--id UUID] [--json] [--dry-run] [--apply]
bun run import:notion --resume --id UUID [--json] [--dry-run]
```

The old `--source` adapter and token arguments are rejected. Credentials come
only from `NOTION_TOKEN` or a private `NOTION_TOKEN_FILE`. Discovery and preview
need no local target; preview makes no canonical write or source-content cache.
`--dry-run` overrides `--apply`. Notion requests are read-only.

Apply requires an explicit stable UUID, `DATABASE_URL`, `MYOWNNOTION_BLOB_ROOT`,
`MYOWNNOTION_BACKUP_ROOT`, `MYOWNNOTION_DEPLOYMENT_KEY_FILE`, a ready installation,
installed migrations and verified full safety backup. Objects live under a new
import root, never merge by title. Resume retains the original backup and reads
the encrypted saved plan, without source credentials or network collection.

Ordinary output contains aggregate counts and fixed codes. Explicit JSON is an
owner-only detailed report containing source identities, conversion notices and
target mappings; source paths on failures appear only with JSON. Progress on
stderr contains counts only. Exit 0 succeeds, 2 means invalid CLI arguments,
and 1 means source, configuration or application refusal.

Ctrl+C cancels collection or stops between canonical operations. Completed
operations and their checkpoints commit together. Replaying a completed job
does not replace later owner edits.

## Exclusion explicite de base

--exclude-database UUID_NOTION est répétable avec --root ou --all pour aperçu
et application. Les IDs doivent désigner des bases collectées ; un ID absent
est refusé avant application. Base, sources, membres, descendants et médias
associés sont omis de la projection. La sélection exclue est enregistrée dans
le plan protégé pour reprise. L'option est refusée avec --discover/--resume,
qui ne définissent pas une nouvelle sélection. Pas d'exclusion globale par nom.
