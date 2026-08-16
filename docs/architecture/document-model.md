# The document model

What a page's content is, on disk, and how to get it out.

This exists because FR-005 requires the model to be *documented* and not merely
to exist: an export path nobody can read is not an export path. If you are
writing a tool that reads a MyOwnNotion export, or wondering what happens to
your notes if this project stops being maintained, this page is the answer.

The normative source is
[`packages/domain/src/document/`](../../packages/domain/src/document/) and
[the feature contract](../../specs/003-core-workspace-experience/contracts/document-format.md);
where they disagree with this page, they win and this page is the bug.

## The shape

A page's content is JSON, stored as the `body` of a page document:

```jsonc
{
  "format": "myownnotion.document+json",
  "formatVersion": 2,
  "body": {
    "blocks": [
      { "id": "…", "type": "heading", "level": 1, "content": [{ "text": "Trip notes" }] },
      {
        "id": "…",
        "type": "bulletedListItem",
        "content": [{ "text": "the map", "marks": [{ "type": "link", "href": "https://example.org" }] }],
        "children": [{ "id": "…", "type": "checkbox", "checked": false, "content": [{ "text": "Print it" }] }]
      }
    ]
  }
}
```

Eight block types: `paragraph`, `heading` (levels 1–3), `bulletedListItem`,
`numberedListItem`, `checkbox`, `quote`, `code`, `divider`. Five inline marks:
`bold`, `italic`, `strikethrough`, `code`, `link`.

Order in the array *is* document order. Lists nest through `children` rather
than through a container node — there is no "list" object, only items that may
have children.

## Three properties worth knowing

**The format is ours, not the editor's.** The application uses Tiptap to edit,
but Tiptap's own JSON is never what gets stored. Everything passes through a
conversion boundary. This is why the format does not change when the editor is
upgraded, and why replacing the editor would not require migrating a single
stored document.

**A block type this client does not recognise is preserved exactly.** Not
dropped, not normalised — the bytes that came in are the bytes that go back
out. That is what makes it safe to add block types later without coordinating
an upgrade across an owner's devices: an older client opens a newer document,
shows the unknown block as unrenderable, and writes it back untouched.

**Reading is never a write.** Opening a page does not rewrite it, including
when the client would prefer a different version. A `formatVersion: 1` body —
written before this model existed — is displayed as it was stored and upgraded
only when the owner actually edits it.

## Getting it out

`exportMarkdown(document)` in
[`packages/domain/src/document/export-markdown.ts`](../../packages/domain/src/document/export-markdown.ts)
is pure, dependency-free, and total — it never throws, on any valid document.

| Block | Markdown |
|-------|----------|
| `paragraph` | the text |
| `heading` | `#`, `##`, `###` |
| `bulletedListItem` | `- `, children indented |
| `numberedListItem` | `1. `, renumbered per level |
| `checkbox` | `- [ ] ` / `- [x] ` |
| `quote` | `> ` |
| `code` | fenced, with the language when known |
| `divider` | `---` |
| unknown | a fenced JSON block labelled with the type |

Marks become `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](href)`.

**Export is lossy by design and never silently lossy.** Markdown has no idiom
for a block type it has never heard of, so unknown blocks are emitted as
labelled JSON rather than skipped. An owner who exports gets everything they
had, including the parts Markdown cannot express.

Export is one-way. It is not an import format, and round-tripping through
Markdown is not a guarantee this model makes — the JSON above is the durable
form.

## Where the content lives

On the server, sealed: since feature 002 the body is stored as an encrypted
envelope and the server holds no key. That has a consequence worth stating
plainly — **the server cannot migrate documents**, because it cannot read them.
Any change to the model happens on a client, at a moment the owner chose.
