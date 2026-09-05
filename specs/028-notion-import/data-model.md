# Import state

`ImportSnapshot` holds normalized relative paths, empty directories, immutable
file bytes and digests. `ImportPlan` binds adapter version, import UUID and
snapshot digest to canonical IDs, hierarchy, file placements, links, properties
and database membership. Every source entry has a report outcome.

Protected records use versioned encrypted payloads:

- `import.job`: keyed by import UUID, snapshot/plan digests, root identity,
  safety-backup reference and completion.
- `import.provenance`: exhaustive report, original-to-canonical mapping,
  conversion outcomes and unavailable settings.
- `import.step`: one deterministic accepted operation identifier, committed
  in the same transaction as its canonical change.
- `import.head`: last imported editorial revision or independent database
  definition revision, used to reject newer owner changes during resume.

Separate operation records avoid a growing checkpoint rewritten after every
step. Original material is preserved as encrypted canonical files under the
import root; normal complete and portable archives retain it. SQL contains no
import-specific plaintext source paths, note text, labels or secret values.
