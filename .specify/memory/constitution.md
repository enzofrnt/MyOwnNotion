<!--
Sync Impact Report
- Version change: 1.1.0 -> 1.2.0
- Modified principles:
  - III. Incremental, Verifiable Delivery -> task completion now requires green required CI on the open pull request
  - VII. Reproducible Toolchains and Enforced Quality -> clarified that CI evidence binds task completion, not only merge
- Modified sections:
  - Development Workflow and Quality Gates -> steps 5–6 require verifying pull-request CI before marking tasks complete
- Added sections: none
- Removed sections: none
- Follow-up TODOs: none
-->
# Knowledge Workspace Constitution

## Core Principles

### I. User Ownership and Local Resilience

Users MUST retain meaningful control of their knowledge. Core reading and editing flows MUST remain available without a network connection once data is present locally. Data MUST be exportable in documented, durable formats. Cloud services may enhance synchronization and sharing, but MUST NOT be the only path to a user's content.

### II. One Spec, Any Agent

Every feature MUST have one canonical directory under `specs/`. Its `spec.md`, `plan.md`, and `tasks.md` are shared by all agents and MUST NOT be copied into Codex-, Cursor-, or chat-specific documents. Product intent belongs in the specification, technical decisions belong in the plan, and implementation progress belongs in the task list.

### III. Incremental, Verifiable Delivery

Features MUST be divided into independently useful user stories that can be implemented and verified incrementally. Changed behavior MUST have automated tests at the appropriate level. Domain and backend behavior MUST be covered by focused unit, property, integration, or contract tests as appropriate. Every changed user-visible interactive flow MUST have a Playwright journey covering the relevant responsive viewport and browser behavior.

A task MUST NOT be marked complete until its acceptance criteria pass, the shared task list reflects reality, and the open pull request for that work shows every required continuous-integration check green on commits that include the task. Local suite results MAY guide development but MUST NOT replace pull-request CI as the completion gate. A numeric coverage target MUST NOT be treated as a substitute for testing required behavior and failure paths.

### IV. Privacy and Security by Default

Private content MUST remain private unless a user deliberately shares it. Permission checks, input validation, secret handling, attachment access, public-link behavior, and data migrations MUST be designed explicitly. Sensitive content MUST NOT be logged. Threats introduced by collaboration, plugins, imports, or remote access MUST be addressed in the relevant feature plan.

### V. Simple, Modular Architecture

The system MUST start with the smallest architecture that satisfies the approved specification. Domain boundaries such as editing, knowledge graph, databases, storage, and external integrations SHOULD remain explicit, but services and abstractions MUST NOT be introduced without a current requirement. Irreversible coupling and vendor lock-in require written justification in the plan.

### VI. Accessible and Predictable Experience

Keyboard use, readable focus states, semantic structure, and assistive-technology support MUST be acceptance concerns for interactive features. Editing, navigation, saving, and synchronization states MUST be understandable and must avoid silent data loss. Performance targets MUST be measurable from a user's perspective.

### VII. Reproducible Toolchains and Enforced Quality

Node.js dependencies and repository scripts MUST use pnpm exclusively, with the pnpm release pinned in the root package metadata and `pnpm-lock.yaml` committed. npm, Yarn, and Bun lockfiles or install workflows MUST NOT be introduced. If first-party Python is introduced, its interpreter version MUST be pinned and uv MUST exclusively manage environments, dependencies, locking, and command execution; ad hoc pip, virtualenv, Poetry, Pipenv, or Conda project workflows are forbidden. Every other first-party language introduced later MUST likewise use a pinned, reproducible toolchain and committed dependency lock where its ecosystem supports one.

Every maintained first-party language MUST have a current formatter, linter or equivalent static analyzer, and automated tests appropriate to its role. Continuous integration MUST check formatting without modifying files, lint/static analysis, types where applicable, tests, migrations where applicable, and production builds. Protected branches MUST reject pull-request merges while any required quality check fails or is missing. Agents and humans MUST treat those same required pull-request checks as the gate for finishing implementation tasks, not only for merging. Generated or AI-authored code is held to the same gates as human-authored code.

## Product and Technical Constraints

- The first usable release prioritizes workspaces, hierarchical pages, block editing, links, backlinks, search, and reliable persistence.
- Advanced databases, canvas, public sharing, plugins, MCP, Notion import, and real-time collaboration MUST be delivered as separate specs rather than folded into the core feature.
- Tiptap is the initial editor candidate, but the selected editor architecture MUST preserve a documented internal content model and export path.
- Self-hosting and container-based deployment are product goals; each infrastructure dependency MUST have a documented local-development path.
- Offline and synchronization behavior MUST be specified explicitly. No feature may imply conflict-free multi-device synchronization without acceptance criteria for conflicts and recovery.
- Maintained application and test source MUST use TypeScript rather than handwritten JavaScript unless a later constitution amendment explicitly changes this language policy.

## Development Workflow and Quality Gates

1. Create or update `spec.md` and resolve material ambiguity before planning.
2. Create `plan.md`, documenting architecture, data ownership, security, migration, testing, and operational impact.
3. Generate `tasks.md`; tasks MUST map back to user stories or supporting foundations.
4. Run cross-artifact analysis before implementation and resolve high-impact inconsistencies.
5. Implement in task order, keeping the checklist current and preserving independently testable increments. After each task's commits are on the feature pull request, verify the required CI checks for that pull request before marking the task complete.
6. Run formatting checks, lint/static analysis, type checks, relevant automated tests, migration checks, and production builds before completion. A pull request MUST NOT merge, and its implementation tasks MUST NOT be closed as done, until the same required CI checks pass on the pull request.
7. Run convergence after implementation; append and complete remaining tasks until code and artifacts agree, still subject to the pull-request CI completion gate above.

Any deliberate exception MUST be recorded in the active feature's plan with its scope, reason, risk, and removal or review condition.

## Governance

This constitution overrides conflicting workflow notes and agent-specific guidance. Amendments require an explicit change to this file, a version update, and a review of affected specs and templates. Semantic versioning applies: MAJOR for incompatible governance changes, MINOR for new or materially expanded principles, and PATCH for clarifications. Every feature plan and implementation review MUST check constitution compliance.

**Version**: 1.2.0 | **Ratified**: 2026-08-07 | **Last Amended**: 2026-08-08
