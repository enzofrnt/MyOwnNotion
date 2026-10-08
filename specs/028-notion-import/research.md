# Research and decisions — API replacement, 2026-10-04

The supplied architecture note is reference material. The owner requested
read-only Notion access and a fully isolated development target. The prior
export/Obsidian-folder research is superseded.

- [Obsidian guide](https://help.obsidian.md/import/notion) and
  [Importer source](https://github.com/obsidianmd/obsidian-importer): use direct
  API traversal and stable identities, but map databases to MyOwnNotion's native
  source/property/view model rather than Markdown note collections.
- [Versioning](https://developers.notion.com/reference/versioning): live reads
  confirmed `2026-03-11`. Keep the version explicit and avoid an SDK with another
  retry layer.
- [Request limits](https://developers.notion.com/reference/request-limits):
  share a credential-scoped scheduler and honor Retry-After with bounded retries.
- [Database retrieval](https://developers.notion.com/reference/retrieve-database)
  distinguishes owners from data sources. Import sources separately under one
  owner; select source-specific protected schema reads in the application.
- [Page property retrieval](https://developers.notion.com/reference/retrieve-a-page-property)
  paginates properties independently from rows. Collect title, rich text and
  relations; skip people pagination because the owner excludes those fields.
- [Views](https://developers.notion.com/reference/view) and
  [view listing](https://developers.notion.com/reference/list-views): live listing
  and retrieval succeed. Translate simple compatible layouts, filters and sorts;
  name/report fallback views and preserve the original configuration.

Native property/block capabilities were checked in the domain validators and
canonical database mutation pipeline. People and authorship fields are ignored;
covers are permanently excluded by the owner's follow-up. Missing formula/rollup
types, date ranges and advanced views are reported gaps; no unrequested app-wide
feature extension is included. Media bytes are fetched without Notion auth,
bounded, encrypted on application, and saved for offline resume.
