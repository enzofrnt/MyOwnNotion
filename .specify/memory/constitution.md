# Knowledge Workspace Constitution

## Core Principles

### I. User Ownership and Local Resilience

Users MUST retain meaningful control of their knowledge. Core reading and editing flows MUST remain available without a network connection once data is present locally. Data MUST be exportable in documented, durable formats. Cloud services may enhance synchronization and sharing, but MUST NOT be the only path to a user's content.

### II. One Spec, Any Agent

Every feature MUST have one canonical directory under `specs/`. Its `spec.md`, `plan.md`, and `tasks.md` are shared by all agents and MUST NOT be copied into Codex-, Cursor-, or chat-specific documents. Product intent belongs in the specification, technical decisions belong in the plan, and implementation progress belongs in the task list.

### III. Incremental, Verifiable Delivery

Features MUST be divided into independently useful user stories that can be implemented and verified incrementally. Changed behavior MUST have automated tests at the appropriate level. A task is complete only when its acceptance criteria pass, relevant checks pass, and the shared task list reflects reality.

### IV. Privacy and Security by Default

Private content MUST remain private unless a user deliberately shares it. Permission checks, input validation, secret handling, attachment access, public-link behavior, and data migrations MUST be designed explicitly. Sensitive content MUST NOT be logged. Threats introduced by collaboration, plugins, imports, or remote access MUST be addressed in the relevant feature plan.

### V. Simple, Modular Architecture

The system MUST start with the smallest architecture that satisfies the approved specification. Domain boundaries such as editing, knowledge graph, databases, storage, and external integrations SHOULD remain explicit, but services and abstractions MUST NOT be introduced without a current requirement. Irreversible coupling and vendor lock-in require written justification in the plan.

### VI. Accessible and Predictable Experience

Keyboard use, readable focus states, semantic structure, and assistive-technology support MUST be acceptance concerns for interactive features. Editing, navigation, saving, and synchronization states MUST be understandable and must avoid silent data loss. Performance targets MUST be measurable from a user's perspective.

## Product and Technical Constraints

- The first usable release prioritizes workspaces, hierarchical pages, block editing, links, backlinks, search, and reliable persistence.
- Advanced databases, canvas, public sharing, plugins, MCP, Notion import, and real-time collaboration MUST be delivered as separate specs rather than folded into the core feature.
- Tiptap is the initial editor candidate, but the selected editor architecture MUST preserve a documented internal content model and export path.
- Self-hosting and container-based deployment are product goals; each infrastructure dependency MUST have a documented local-development path.
- Offline and synchronization behavior MUST be specified explicitly. No feature may imply conflict-free multi-device synchronization without acceptance criteria for conflicts and recovery.

## Development Workflow and Quality Gates

1. Create or update `spec.md` and resolve material ambiguity before planning.
2. Create `plan.md`, documenting architecture, data ownership, security, migration, testing, and operational impact.
3. Generate `tasks.md`; tasks MUST map back to user stories or supporting foundations.
4. Run cross-artifact analysis before implementation and resolve high-impact inconsistencies.
5. Implement in task order, keeping the checklist current and preserving independently testable increments.
6. Run relevant formatting, static checks, tests, and build verification before completion.
7. Run convergence after implementation; append and complete remaining tasks until code and artifacts agree.

Any deliberate exception MUST be recorded in the active feature's plan with its scope, reason, risk, and removal or review condition.

## Governance

This constitution overrides conflicting workflow notes and agent-specific guidance. Amendments require an explicit change to this file, a version update, and a review of affected specs and templates. Semantic versioning applies: MAJOR for incompatible governance changes, MINOR for new or materially expanded principles, and PATCH for clarifications. Every feature plan and implementation review MUST check constitution compliance.

**Version**: 1.0.0 | **Ratified**: 2026-08-07 | **Last Amended**: 2026-08-07
