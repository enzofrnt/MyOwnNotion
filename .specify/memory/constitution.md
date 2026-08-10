<!--
Sync Impact Report
- Version change: 1.1.1 -> 1.2.0
- Modified principles:
  - II. One Spec, Any Agent -> added the product-canvas authority and
    cross-feature traceability rule
  - III. Incremental, Verifiable Delivery -> made the local-check, branch-CI,
    pull-request sequence explicit
  - IV. Privacy and Security by Default -> added mandatory application-level
    encryption at rest, external key custody, encrypted local storage, and an
    offline recovery kit
  - VII. Reproducible Toolchains and Enforced Quality -> added Compose/registry
    validation and release publication gates
- Added principles:
  - VIII. Canonical Product Direction
- Modified sections:
  - Product and Technical Constraints -> made the official Compose, local HTTP,
    external reverse-proxy, secret, and GHCR distribution contract normative
  - Development Workflow and Quality Gates -> aligned the seven-step workflow
    with branch CI before pull-request creation and release verification
  - Governance -> added product-canvas change-control and review requirements
- Removed sections: none
- Follow-up TODOs:
  - Existing feature 001 predates the product canvas and must be checked for
    alignment before its two remaining convergence tasks are closed
- Rationale: MINOR. This amendment adds a new governing product-direction
  principle and materially expands security and release obligations. Existing
  feature behavior is not removed, but future specs and delivery gates gain new
  mandatory constraints.
-->
# Knowledge Workspace Constitution

## Core Principles

### I. User Ownership and Local Resilience

Users MUST retain meaningful control of their knowledge. Core reading and editing flows MUST remain available without a network connection once data is present locally. Data MUST be exportable in documented, durable formats. Cloud services may enhance synchronization and sharing, but MUST NOT be the only path to a user's content.

Throughout this constitution, "user" means the single owner of one installation. Plural wording refers to owners of separate installations, never to multiple accounts inside one workspace.

### II. One Spec, Any Agent

Every feature MUST have one canonical directory under `specs/`. Its `spec.md`, `plan.md`, and `tasks.md` are shared by all agents and MUST NOT be copied into Codex-, Cursor-, or chat-specific documents. Product intent belongs in the specification, technical decisions belong in the plan, and implementation progress belongs in the task list.

Every feature specification MUST identify the relevant product direction from
`docs/product/product-canvas.md`. A feature MAY refine that direction with
testable acceptance criteria, but it MUST NOT silently contradict a
cross-feature invariant or release boundary. When product direction changes,
the product canvas and every directly affected active feature artifact MUST be
updated in the same change.

### III. Incremental, Verifiable Delivery

Features MUST be divided into independently useful user stories that can be implemented and verified incrementally. Changed behavior MUST have automated tests at the appropriate level. Domain and backend behavior MUST be covered by focused unit, property, integration, or contract tests as appropriate. Every changed user-visible interactive flow MUST have a Playwright journey covering the relevant responsive viewport and browser behavior. A task is complete only when its acceptance criteria pass, relevant checks pass, and the shared task list reflects reality. A numeric coverage target MUST NOT be treated as a substitute for testing required behavior and failure paths.

Every change MUST follow this delivery sequence: implementation on a dedicated
branch, required local checks passing, branch push, branch CI passing, pull
request creation, pull-request CI passing, review, and merge. An emergency
exception MUST be documented with its scope, risk, approver, and immediate
follow-up verification.

### IV. Privacy and Security by Default

Private content MUST remain private unless a user deliberately shares it. Permission checks, input validation, secret handling, attachment access, public-link behavior, and data migrations MUST be designed explicitly. Sensitive content MUST NOT be logged. Threats introduced by collaboration, plugins, imports, or remote access MUST be addressed in the relevant feature plan.

Private content, sensitive indexes, files, and local offline data MUST be
encrypted by the application at rest. Server key-encryption material MUST be
kept external to the encrypted data and supplied through a deployment secret;
it MUST NOT be committed, embedded in images, or written to logs. Backups MUST
be encrypted before leaving the server. The owner MUST receive an encrypted,
offline-storable recovery kit, and key rotation, loss, and restoration paths
MUST be specified and tested before encrypted data is considered production
ready. Host or volume encryption is an additional defense and MUST NOT replace
application-level encryption.

### V. Simple, Modular Architecture

The system MUST start with the smallest architecture that satisfies the approved specification. Domain boundaries such as editing, knowledge graph, databases, storage, and external integrations SHOULD remain explicit, but services and abstractions MUST NOT be introduced without a current requirement. Irreversible coupling and vendor lock-in require written justification in the plan.

### VI. Accessible and Predictable Experience

Keyboard use, readable focus states, semantic structure, and assistive-technology support MUST be acceptance concerns for interactive features. Editing, navigation, saving, and synchronization states MUST be understandable and must avoid silent data loss. Performance targets MUST be measurable from a user's perspective.

### VII. Reproducible Toolchains and Enforced Quality

Node.js dependencies and repository scripts MUST use pnpm exclusively, with the pnpm release pinned in the root package metadata and `pnpm-lock.yaml` committed. npm, Yarn, and Bun lockfiles or install workflows MUST NOT be introduced. If first-party Python is introduced, its interpreter version MUST be pinned and uv MUST exclusively manage environments, dependencies, locking, and command execution; ad hoc pip, virtualenv, Poetry, Pipenv, or Conda project workflows are forbidden. Every other first-party language introduced later MUST likewise use a pinned, reproducible toolchain and committed dependency lock where its ecosystem supports one.

Every maintained first-party language MUST have a current formatter, linter or equivalent static analyzer, and automated tests appropriate to its role. Continuous integration MUST check formatting without modifying files, lint/static analysis, types where applicable, tests, migrations where applicable, and production builds. Protected branches MUST reject pull-request merges while any required quality check fails or is missing. Generated or AI-authored code is held to the same gates as human-authored code.

Continuous integration MUST also validate the official Compose configuration,
its documented environment-variable contract, a real stack startup, and
container-image security when those artifacts exist. A successful push to
`main` MUST publish commit-addressable Compose images to GitHub Container
Registry. A successful release tag MUST publish versioned images and release
artifacts. Failed, skipped, missing, cancelled, or stale required checks MUST
prevent merge or publication.

### VIII. Canonical Product Direction

`docs/product/product-canvas.md` is the canonical product reference for the
application as a whole: its vision, actors, permanent boundaries, release
scope, cross-cutting quality attributes, and delivery trajectory. It is the
product charter, not a substitute for feature specifications. The constitution
remains the highest authority; the product canvas governs cross-feature product
intent; each active `spec.md` turns the relevant slice into independently
testable behavior.

Roadmaps, plans, tasks, architecture notes, and implementation MUST remain
traceable to those sources. A new feature MUST state its product-canvas scope,
dependencies, and exclusions. If implementation evidence exposes a necessary
change in product direction, agents MUST amend the canvas deliberately rather
than letting documentation drift behind the code.

## Product and Technical Constraints

- The product is permanently single-user: one installation has exactly one owner and exactly one canonical workspace. There are no additional accounts, no user management, no roles, and no permission model between people. Multiple authorized *devices* belonging to that one owner, and anonymous read-only access to deliberately shared content, are in scope; multi-user accounts, teams, and real-time co-editing are out of scope permanently. Any feature that would introduce a second identity with its own content requires a MAJOR amendment to this constitution before it is specified.
- The first usable release prioritizes workspaces, hierarchical pages, block editing, links, backlinks, search, and reliable persistence.
- Advanced databases, canvas, public sharing, plugins, MCP, Notion import, and real-time collaboration MUST be delivered as separate specs rather than folded into the core feature.
- Tiptap is the initial editor candidate, but the selected editor architecture MUST preserve a documented internal content model and export path.
- Self-hosting and container-based deployment are product goals; each infrastructure dependency MUST have a documented local-development path.
- Offline and synchronization behavior MUST be specified explicitly. No feature may imply conflict-free multi-device synchronization without acceptance criteria for conflicts and recovery.
- Maintained application and test source MUST use TypeScript rather than handwritten JavaScript unless a later constitution amendment explicitly changes this language policy.
- The official server deployment MUST use `compose.yaml`, publish only local
  HTTP by default, and support operation behind an administrator-managed
  reverse proxy that provides HTTPS and public routing.
- The repository MUST provide a complete, secret-free `.env.example`; real
  deployment secrets MUST remain outside version control and MUST use mounted
  deployment secrets when supported.
- Compose images released from `main` or a version tag MUST be available from
  GitHub Container Registry and selectable by an explicit, documentable image
  version. Production installations MUST be able to pin an immutable image.

## Development Workflow and Quality Gates

1. Create or update `spec.md` and resolve material ambiguity before planning.
2. Create `plan.md`, documenting architecture, data ownership, security, migration, testing, and operational impact.
3. Generate `tasks.md`; tasks MUST map back to user stories or supporting foundations.
4. Run cross-artifact analysis before implementation and resolve high-impact inconsistencies.
5. Implement in task order, keeping the checklist current and preserving independently testable increments.
6. Run formatting checks, lint/static analysis, type checks, relevant automated tests, migration checks, Compose validation, and production builds locally before pushing.
7. Push the feature branch and wait for its required CI checks to pass before opening a pull request.
8. Open a pull request and require the same or stricter checks on the exact proposed merge commit. A pull request MUST NOT merge until every required check passes and review is complete.
9. Run convergence after implementation; append and complete remaining tasks until code and artifacts agree.
10. On `main` and release tags, publish only after the complete release gate succeeds, then verify that images and artifacts are addressable by commit or version.

Any deliberate exception MUST be recorded in the active feature's plan with its scope, reason, risk, and removal or review condition.

## Governance

This constitution overrides conflicting product documents, workflow notes, and agent-specific guidance. Amendments require an explicit change to this file, a version update, and a review of the product canvas, affected specs, and templates. Semantic versioning applies: MAJOR for incompatible governance changes, MINOR for new or materially expanded principles, and PATCH for clarifications. Every feature plan and implementation review MUST check constitution compliance.

Changes to `docs/product/product-canvas.md` require a review of the constitution,
roadmap, active feature specs, and release boundaries. Changes to a permanent
product invariant MUST amend the constitution in the same change. Feature-level
detail MUST remain in the relevant feature directory rather than being copied
into the constitution.

**Version**: 1.2.0 | **Ratified**: 2026-08-07 | **Last Amended**: 2026-08-10
