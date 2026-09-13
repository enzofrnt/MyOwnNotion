# Research and decisions

Verified against primary sources on2026-09-05:

- [Notion export guide](https://www.notion.com/help/export-your-content): native
  Markdown/CSV ZIP includes page/subpage documents and separately exported
  files. Export completeness depends on export options and access. No claim
  that all presentation/history settings are included.
- [Obsidian Bases syntax](https://github.com/obsidianmd/obsidian-help/blob/master/en/Bases/Bases%20syntax.md)
  and [internal links](https://help.obsidian.md/links): YAML Bases describe
  filters, presentation and note properties; wikilinks resolve within a vault.
  Import supports an explicit membership-filter subset, never executes code.
- [Yauzl](https://github.com/thejoshwolfe/yauzl): central-directory ZIP inspection,
  lazy entries and declared/actual size validation enable bounded archive reads.
- [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown)
  and [csv-parse](https://csv.js.org/parse/): maintained parsers avoid inventing
  Markdown/CSV grammar; application conversion remains separate.

No ZIP or CSV is assumed to exist in the real candidate folder. Only aggregates
and synthetic examples are maintained here. Missing views, previews, automation,
permissions and prior revisions cannot be inferred from an export.
