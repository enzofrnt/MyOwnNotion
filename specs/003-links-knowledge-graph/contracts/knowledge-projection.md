# Contract: Knowledge Relationship Projection

## Document-to-relationship invariant

For every accepted version-3 page document, the active canonical relationships with:

- `sourceItemId` equal to the page identity, and
- `relationType` equal to `link:references`

must correspond one-to-one with valid `wikiLink.attrs.occurrenceId` values in the document. Each row uses the mark's target identity. Acceptance fails atomically when that invariant cannot be established.

## Verified snapshot response

The existing current-snapshot response continues to contain:

```text
workspaceId
schemaVersion
cursor
digest
items[]
relationships[]
```

Clients must hydrate both `items[]` and `relationships[]` in the same local transaction. The digest continues to cover both arrays.

## Incremental change response

Each change envelope may additionally contain:

```text
changedRelationships[]
relationshipSourceItemIds[]
```

- `relationshipSourceItemIds` identifies sources whose complete active derived wiki-link set is represented.
- `changedRelationships` contains the complete active `link:references` rows for those sources after the mutation.
- An empty `changedRelationships` array with a listed source means that source now has no active wiki links.
- Clients replace derived wiki-link rows for only the listed sources, leaving unrelated sources and relationship types unchanged.
- Reapplying the same envelope is idempotent.

## Failure contract

Malformed marks or endpoints use existing safe problem-document responses. At minimum, callers can distinguish:

- invalid or unsupported document structure;
- invalid identifier;
- duplicate occurrence identity;
- self-link rejection;
- missing, unavailable, or non-page target;
- causal document conflict.

No failure response includes page text, the typed search query, or private graph labels.
