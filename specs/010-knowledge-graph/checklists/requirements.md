# Specification Quality Checklist: Graphe de connaissances V1

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-31
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Demo Database and Clean-Redeploy Contract

- [x] The demo database is disposable, explicitly local-only and refused by normal or production startup paths
- [x] One fake owner and the public password `knowledge-graph-demo` are documented and verified after generation
- [x] The deterministic corpus contains 240 elements and 480 canonical relation occurrences with no orphan endpoint
- [x] The corpus covers 8 branches, 40 structured tasks, a real attachment, 8 isolates, multiple components, duplicates, cycles, reciprocal and cross-branch relations, a future valid relation type and a trashed element
- [x] Status, priority and due-date values are verified so every structured Knowledge Graph filter has coherent data
- [x] Demo content uses canonical mutations and the normal encryption boundaries rather than a parallel test-only data model
- [x] The server reset clears the disposable database, files and backups together only after explicit destructive intent
- [x] The browser reset separately clears the session, cookies, IndexedDB, localStorage, caches, service worker and installed PWA before reconnecting
- [x] Interrupted or repeated generation restarts from the full reset and never declares a partial corpus ready
- [x] Automated proof covers 10 complete reset/generation cycles and 100 remote, ambiguous or non-disposable target refusals

## Content Graph and Pointer Contract

- [x] Internal links visibly present in page content are the primary graph source and backlinks are derived from them
- [x] Hierarchy and attachments are optional structural layers disabled by default, not implicit knowledge relations
- [x] Plain-text mentions and similarity do not silently create canonical V1 edges
- [x] The demo corpus requires readable, coherent content with at least 360 document-link occurrences across at least 160 pages
- [x] The demo topology deliberately differs from its folder tree and covers thematic hubs, bridges, cycles and cross-branch links
- [x] Pointer acceptance covers background drag, cursor-anchored wheel zoom, hover neighborhood, selection and canonical opening

## Notes

- Validation completed on 2026-08-31 after checking the specification against
  the constitution, product canvas, roadmap, delivered page-link foundation
  and the historical graph prototype.
- Revalidated on 2026-08-31 after adding the release-validation story: the
  browser/server reset boundary, local-only demo safety, minimum dataset,
  required graph cases, repeatability and measurable refusal criteria are all
  explicit without prescribing an implementation.
- Revalidated on 2026-09-01 against the implemented seed, reset procedure,
  manifest contract and convergence proofs. Every requested demo-database
  property is mapped above to an executable task or verification.
- Revalidated on 2026-09-01 after product review exposed that the implemented
  default still privileged the folder tree and that the demo corpus used
  generated relations instead of meaningful page content. The corrected
  content-graph and pointer contracts above invalidate readiness until the
  plan, tasks, implementation and full gate converge again.
