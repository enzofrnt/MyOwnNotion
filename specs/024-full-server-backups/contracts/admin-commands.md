# Full-backup administrative contract

The existing Bun admin CLI adds these commands before its current-schema context
initialization. Connection strings and key bytes are never command arguments.
Use mounted deployment-key files and environment-backed database configuration.

- `backup full run [--json]`: complete locally verified artifact, then configured
  remote transfer/verification; output backup identity and stage outcomes.
- `backup full list [--json]`: actual full artifacts and durable outcomes, explicit
  source version and unknown values; excludes partial files from valid backups.
- `backup full inspect --file PATH [--json]`: authenticate and describe one artifact
  without the live database catalogue.
- `backup full verify --file PATH [--json]`: verify every component, bounded streaming.
- `restore full test --file PATH [--json]`: real isolated restoration, reports
  actual database/file verification and keeps the live installation unchanged.
- `restore full apply --file PATH --target-directory PATH [--dry-run | --yes] [--json]`:
  uses explicit `MYOWNNOTION_RESTORE_DATABASE_URL`, refuses active/nonempty target,
  performs complete preflight; `--yes` authorizes writing the empty target only.
  Success describes data recovery and any required security reactivation truthfully.

- `restore full activate --target-directory PATH --yes [--json]`: after a complete
  restore, authenticate its completion marker, invalidate historical sessions
  and require fresh owner authentication on every retained device identity.
  Previously revoked devices remain revoked. Only then remove the startup
  barrier; this does not activate any device or grant a session.

Follow existing `EXIT_CODES`: argument errors, refusal, integrity failure,
unexpected failure and success remain distinct. Help works without a database
connection. Results contain safe stage codes and provenance, not SQL/stderr,
private paths in logs, session identifiers or source content.

Historical complete-backup reads use the current deployment key followed by
explicit `MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES` secret paths (bounded JSON,
private external files). No new command or secret-valued argument is added.
`backup full run` writes only under the current key; list/inspect/verify and
`restore full test` support configured history. `restore full apply` and
`activate` still require `MYOWNNOTION_DEPLOYMENT_KEY_FILE` explicitly selecting
the archive/activation key; configuring history does not authorize fallback.
The restored application additionally needs its SQL root-key wrapping version.
