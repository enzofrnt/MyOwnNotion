# Research: Block Editor

## Tiptap 3 with React and StarterKit

**Decision**: Use Tiptap 3 through `@tiptap/react`, `@tiptap/pm`, and `@tiptap/starter-kit`, with the official task-list, Placeholder, and Suggestion extensions needed by the spec.

**Rationale**: The constitution names Tiptap as the initial candidate. Its official React integration supports Vite, its extension schema covers the required nodes, marks, input rules, and history, and it exposes JSON rather than forcing HTML persistence. StarterKit minimizes custom editor mechanics while leaving the canonical envelope owned by this project.

**Alternatives considered**: Lexical would contradict the documented initial candidate without a compensating requirement; Slate requires more custom schema and command work; hand-built `contenteditable` carries excessive selection, history, clipboard, accessibility, and input-rule risk.

## Versioned JSON document body

**Decision**: Store allow-listed Tiptap JSON in `myownnotion.document+json` version 2 and retain explicit compatibility for legacy version 1 empty objects.

**Rationale**: Tiptap documents are node trees and its official persistence path is JSON. A project-owned envelope prevents the editor library from becoming the public storage contract and gives future migrations an explicit boundary. Existing PostgreSQL JSONB and export paths already preserve the envelope losslessly.

**Alternatives considered**: HTML is weak for validation and migrations; keeping version 1 would mix arbitrary legacy objects with validated editor documents; relational rows per block are premature for the current atomic whole-document mutation model.

## Unknown-content safety

**Decision**: Validate v2 documents before editing and saving. Unknown nodes, marks, attributes, or malformed structure produce a visible read-only incompatibility state; the original body remains untouched.

**Rationale**: Editor schema normalization can otherwise drop unsupported content. Explicit rejection satisfies forward compatibility and data-loss constraints.

**Alternatives considered**: Silently stripping content violates FR-018; speculative generic editable nodes can still corrupt nested content.

## Local slash commands

**Decision**: Use the official Suggestion utility with `/`, start-of-line matching, synchronous local filtering, keyboard navigation, Escape dismissal, and managed popup positioning.

**Rationale**: The utility owns editor-range lifecycle and dismissal while all command data remains local and deterministic.

**Alternatives considered**: A global palette loses caret context; remote lookup breaks offline use; DOM key parsing outside the editor is fragile around composition and selection transactions.

## Sequenced local saves

**Decision**: Debounce editor updates briefly, serialize local mutations, and coalesce updates received while a save is running into the newest snapshot.

**Rationale**: Each replacement advances the causal revision. Concurrent saves from the same base would conflict or allow old UI state to obscure a newer edit. One in-flight mutation plus latest-value coalescing preserves order.

**Alternatives considered**: Concurrent transaction saves create stale-base conflicts; an explicit save button weakens offline durability; a long inactivity timeout makes saved-state feedback misleading.

## Database and deployment impact

**Decision**: Add no database migration or service. Rebuild the existing API and web images after dependency and code changes.

**Rationale**: The envelope and body already live in JSONB with revision snapshots, and all ports and security boundaries remain unchanged.

**Alternatives considered**: A new editor service has no current ownership or scaling requirement; block tables are premature before links, task aggregation, properties, or block-level sharing are specified.
