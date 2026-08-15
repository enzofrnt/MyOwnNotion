# Contract: what a kind means, and what it does not

**Requirements**: FR-001 to FR-003, FR-015, FR-016 | **Model**: [data-model.md](../data-model.md)

The durable statement of what pages and folders are, for anyone reading the
schema or the API without the specification beside them.

## The shared base

Every hierarchy item — page or folder — has a title, a stable identity, an
owner-chosen position among its siblings, and hierarchy children. Children may
be pages, folders or standalone files.

A folder is exactly this and nothing more. A page is this **plus** editorial
content, and with the content, attachments bound to it.

Read the other way round, which is the reading that matters: **a page can do
everything a folder can.** They are not two families. There is one item with an
optional capability, which is why converting between them is a change of
capability rather than a change of nature.

## Two relations that must never be merged

| | placement kind | parent | disclosure |
|---|---|---|---|
| Hierarchy child | `hierarchy` | page or folder | the tree, for both kinds |
| Content attachment | `attachment` | page only | the attachments control, pages only |

A file filed under a folder is a hierarchy child. A file bound to a page's text
is an attachment. Both are rows in `placements`; the `kind` column is what
separates them, and it always has.

**Merging them in the interface is a defect, not a simplification.** Show
attachments in the tree and files the owner filed under a page become
indistinguishable from files embedded in its text. Show hierarchy children in
the attachments list and a document the owner filed appears to have been
swallowed by a paragraph.

## What `kind` does not determine

It does not determine identity, position, parentage, or what an item may
contain in the hierarchy. Those belong to every item equally. A conversion
changes the capability and nothing else — and the schema now says so, because
the only thing `placements` denormalises about an item is whether it is a file,
which no conversion changes.

## Stability

`page` and `folder` are interchangeable over an item's life. `file` is not:
files are terminal, they carry no children and no content, and nothing converts
to or from one.

That exclusion is load-bearing rather than a limitation. The placements
denormalisation depends on `is_file` being immutable; if files were
convertible, the constraint would have to move again.
