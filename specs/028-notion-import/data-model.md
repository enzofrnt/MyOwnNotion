# Import state

`ImportSnapshot` holds normalized relative paths, immutable bytes and digests.
`ImportPlan` binds adapter version, import UUID and snapshot digest to canonical
IDs, page hierarchy, file placements, resolved links, properties and database
membership. Every source entry has a report outcome.

`import.job` is a protected record keyed by import UUID with versioned encrypted
payload: snapshot/plan digests, root identity, canonical mappings, completed
operation identifiers and safety-backup reference. Checkpoint writes commit
inside the accepted mutation transaction. Original material is also preserved
as canonical encrypted files, which are already covered by full and portable
archives. No import-specific plaintext payload or secret is stored in SQL.
