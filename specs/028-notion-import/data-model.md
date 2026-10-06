# Import state — Notion API

`NotionCollection` contains selected root identities, complete pages, database
owners, distinct data sources, block trees, views, media bytes and collection
notices. It stays in memory during preview. Original JSON is kept inside the
encrypted recovery snapshot, outside the visible item tree. People, created-by
and last-edited-by properties do not produce native properties or values;
cover slots produce neither downloads nor attachments, including historical
cached collections. Limits constrain objects, recursion, response size, media size
and total snapshot bytes.

`ImportPlan` version 2 binds a stable import UUID and fingerprint to the
snapshot digest, canonical identities, hierarchy, source schemas, source-specific
entry values, deferred relations, documents, files and explicit conversion
notices. Identities depend on source UUIDs rather than titles. Repeated media
slots can share a canonical asset. Every database owner has zero or more sources;
each entry belongs to exactly one imported source under that owner.

Protected records use versioned encrypted payloads:

- `import.job`: import UUID, fingerprints, root identity, verified backup and
  completion state.
- `import.snapshot`: serialized complete plan and immutable bytes, used for
  restart without Notion access or expiring media URLs.
- `import.provenance`: report, source-to-target mappings and conversion notices.
- `import.step`: deterministic accepted operation, committed in the same
  transaction as its canonical mutation.
- `import.head`: last imported item/definition revision, including independent
  source heads, used to refuse conflicting owner edits during partial resume.

Imported media use ProtectedFileService; originals use protected snapshot
records. Full backups retain both. SQL contains no plaintext source
content, private labels or integration credentials.

## Extension034 de conversion

Plan.excludedDatabaseIds mémorise les IDs source de bases explicitement exclues.
La résolution de block_id utilise la page propriétaire du bloc collecté, sans
modifier la sémantique database_id/data_source_id. Les types equation,
tableOfContents et mark equation.expression/equationId sont définis dans034.
Les snapshots historiques restent lisibles et ne sont pas réécrits par la
réparation canonique de l'instance de test.
