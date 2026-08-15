# Contract: `myownnotion.document+json` version 2

**Feature**: [../spec.md](../spec.md) | **Model**: [../data-model.md](../data-model.md)

This is the durable, on-disk contract for a page's content. It is the artifact
FR-005 requires and the one an export tool, a future client, or the owner
themselves would read. [data-model.md](../data-model.md) defines the entities;
this file states what is guaranteed about them across versions and across
clients.

## Wire shape

```jsonc
{
  "format": "myownnotion.document+json",
  "formatVersion": 2,
  "body": {
    "blocks": [
      {
        "id": "01924f8e-7c1a-7000-8000-000000000001",
        "type": "heading",
        "level": 1,
        "content": [{ "text": "Trip notes" }]
      },
      {
        "id": "01924f8e-7c1a-7000-8000-000000000002",
        "type": "bulletedListItem",
        "content": [
          { "text": "See " },
          { "text": "the map", "marks": [{ "type": "link", "href": "https://example.org/map" }] }
        ],
        "children": [
          {
            "id": "01924f8e-7c1a-7000-8000-000000000003",
            "type": "checkbox",
            "checked": false,
            "content": [{ "text": "Print it" }]
          }
        ]
      }
    ]
  }
}
```

The TypeBox schema in `@myownnotion/contracts` is the executable form of this
document; where the two disagree, the schema is authoritative and this file is
the bug.

## Compatibility guarantees

**A client MUST NOT drop content it does not understand.** An unrecognised
block type is written back exactly as it was read. This is the single
guarantee that makes it safe to add block types later without coordinating a
version rollout across an owner's devices, and it is verified byte-for-byte by
SC-009 rather than asserted here.

**A client MUST NOT rewrite a document it merely opened.** A stored document
changes only as the result of an edit the owner made. Reading is not a write,
including when the reader would prefer a different version.

**`formatVersion` is the only version signal.** A reader dispatches on it and
nothing else. A reader that does not know a version MUST treat the whole body
as opaque and preserve it, applying the same rule as for an unknown block one
level up.

**Version 1 remains readable forever.** There is no cut-off release after which
a v1 body stops being understood, because the server cannot migrate them — it
cannot read them — and an owner may hold an unedited page for years.

## Export path (FR-005)

`exportMarkdown(document): string`, in `packages/domain/src/document/`, pure
and dependency-free.

| Block | Markdown |
|-------|----------|
| `paragraph` | the text |
| `heading` | `#`, `##`, `###` by level |
| `bulletedListItem` | `- `, children indented two spaces |
| `numberedListItem` | `1. `, renumbered per level |
| `checkbox` | `- [ ] ` / `- [x] ` |
| `quote` | `> ` |
| `code` | fenced, with the language when known |
| `divider` | `---` |
| unknown | a fenced block labelled with the unknown type, containing its JSON |

Marks map to `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](href)`.

Export is **lossy by design and never silently lossy**: an unknown block
exports as its JSON so that the export contains everything the document
contained, even when Markdown has no idiom for it. Export is one-way; it is not
an import format, and round-tripping through Markdown is not a guarantee this
contract makes.

## What this contract does not cover

Block identity is not addressable from outside the document — there is no route
that fetches or mutates a single block. Documents are read and written whole, by
the existing feature 001 item routes, which is why this feature adds no server
endpoint at all.
