# Feature Specification: Tasks and Planning Views

**Feature Branch**: `codex/tasks`

**Created**: 2026-08-08

**Status**: Implemented

**Input**: User description: "Continuer la roadmap avec les tâches : cases à cocher, statut, échéance, priorité et vues de tâches, en conservant le fonctionnement hors ligne et les garanties de qualité existantes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture Tasks While Writing (Priority: P1)

As the workspace owner, I can turn an ordinary task-list item into a durable actionable task without leaving the page I am writing.

**Why this priority**: Fast capture inside notes is the smallest useful task workflow and supplies the source data for every planning view.

**Independent Test**: Create a task in a page, edit its title, toggle it complete with keyboard and pointer, save and reload, and verify that its stable identity and completion state are preserved.

**Acceptance Scenarios**:

1. **Given** an editable page, **When** the owner inserts a task item through the toolbar, slash command, or documented text shortcut, **Then** a readable unchecked task is created at the insertion point.
2. **Given** an existing task, **When** its text or nested content is edited, **Then** ordinary block editing continues without losing task identity or metadata.
3. **Given** an open task, **When** the owner activates its checkbox with a pointer or keyboard, **Then** the task becomes completed and the visible state is announced without moving or deleting its content.
4. **Given** a completed task, **When** the owner reopens it, **Then** it returns to an actionable state while retaining the same identity.
5. **Given** a saved task page, **When** it is reloaded, restored from a revision, renamed, or moved in the hierarchy, **Then** the task remains attached to the same page and retains its identity and metadata.

---

### User Story 2 - Plan with Status, Due Date, and Priority (Priority: P1)

As the workspace owner, I can describe when a task matters and how it is progressing so my notes become an actionable plan.

**Why this priority**: A checkbox alone cannot distinguish active work, deadlines, importance, and intentionally cancelled work.

**Independent Test**: Set a task to in progress, assign a due date and high priority, reload the page, then complete and reopen it while verifying each field and its visible meaning.

**Acceptance Scenarios**:

1. **Given** a selected task, **When** the owner opens its task details, **Then** current status, due date, and priority are shown in labelled keyboard-accessible controls.
2. **Given** task details, **When** the owner chooses todo, in-progress, completed, or cancelled status, **Then** the task and its checkbox expose a consistent state.
3. **Given** task details, **When** the owner assigns, changes, or clears a calendar date, **Then** the date is stored as a calendar day and does not shift because of time zone changes.
4. **Given** task details, **When** the owner assigns none, low, medium, or high priority, **Then** the selection is visible in the page and planning views without relying on color alone.
5. **Given** invalid or unsupported task metadata, **When** a document is loaded or saved, **Then** it is rejected safely and the last valid task document remains intact.

---

### User Story 3 - Review Tasks Across Pages (Priority: P1)

As the workspace owner, I can review tasks from every active page in focused list and board views so I know what is overdue, due now, upcoming, active, or finished.

**Why this priority**: Cross-page review turns isolated checkboxes into a usable personal task system.

**Independent Test**: Create tasks with different pages, statuses, dates, and priorities; verify the All, Today, Upcoming, Overdue, and Finished scopes in list and status-board views; filter and open a source task.

**Acceptance Scenarios**:

1. **Given** tasks across active pages, **When** the task workspace opens, **Then** every task appears exactly once with its title, source page, status, due date, and priority.
2. **Given** the task workspace, **When** the owner chooses Today, Upcoming, Overdue, Finished, or All, **Then** only tasks matching the documented calendar and completion rules appear and the result count is explicit.
3. **Given** a selected scope, **When** the owner filters by status, priority, or text and changes the deterministic sort, **Then** the visible result and count update without changing task data.
4. **Given** list view, **When** the owner switches to status board view, **Then** the same matching tasks are grouped by status and no task is added, lost, or duplicated.
5. **Given** a task result, **When** the owner activates it with a pointer or keyboard, **Then** its source page opens and focus moves to a meaningful task destination.
6. **Given** a task whose source page is trashed, restored, or purged, **When** planning views refresh, **Then** active views exclude trashed tasks, restoration returns them, and unavailable origins remain diagnosable rather than silently reassigned.

---

### User Story 4 - Manage Tasks Offline and Recover Conflicts (Priority: P1)

As the workspace owner, I can capture, update, review, and navigate already-loaded tasks while the server is unavailable, and my changes synchronize safely when connectivity returns.

**Why this priority**: Tasks are core user data and cannot become unreliable precisely when work happens without connectivity.

**Independent Test**: Load a task page and task workspace, disconnect the server, create and update tasks, reload offline, then reconnect and verify exactly one synchronized version; repeat with a competing server revision and recover the local document.

**Acceptance Scenarios**:

1. **Given** pages and task data already available locally, **When** the server is unavailable, **Then** task capture, metadata editing, scopes, filters, list/board views, and source navigation remain usable.
2. **Given** an offline task addition, update, completion, or removal, **When** local save succeeds, **Then** the page document, task projection, and pending change become durable together before success is shown.
3. **Given** pending task edits, **When** connectivity returns, **Then** they synchronize once without duplicate task results or lost metadata.
4. **Given** a competing accepted page revision, **When** an offline task document is rejected, **Then** the local document and all of its task data remain recoverable and the conflict is explicit rather than partially applied.

### Edge Cases

- A page contains no tasks, hundreds of tasks, nested task items, duplicate titles, or empty task text.
- A task is deleted, cut and pasted, duplicated, or moved within its page; stable identities must never become duplicated.
- A due date is today at a daylight-saving boundary, in a different device time zone, invalid, cleared, overdue, or assigned to a completed task.
- Checkbox state and explicit status disagree in legacy or externally supplied content.
- A page save succeeds locally but synchronization is interrupted before acknowledgement.
- A task source page is renamed, moved, trashed, restored, or purged while a planning view is open.
- Filters return no results, long titles wrap, board columns overflow, or the viewport is narrow.
- A workspace contains at least 5,000 tasks distributed across pages and statuses.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Existing task-list insertion paths MUST create actionable task items without interrupting ordinary block editing.
- **FR-002**: Every actionable task MUST retain a stable task identity, readable title, source page identity, document position, status, optional due date, and priority.
- **FR-003**: Task identities MUST remain unique within a document and MUST survive text edits, completion changes, reloads, revision restoration, page renames, and hierarchy moves.
- **FR-004**: The supported task statuses MUST be todo, in progress, completed, and cancelled; supported priorities MUST be none, low, medium, and high.
- **FR-005**: Checkbox state and task status MUST be consistent: checking completes a task, unchecking a completed task reopens it as todo, and cancelled tasks remain visually distinct from completed tasks.
- **FR-006**: Due dates MUST be optional calendar dates, editable and clearable without time-of-day or time-zone drift.
- **FR-007**: A selected task MUST expose labelled, keyboard- and pointer-operable controls for status, due date, and priority while preserving normal text editing.
- **FR-008**: Task state MUST be communicated through text and semantics and MUST NOT rely only on color, decoration, or board position.
- **FR-009**: Accepting a page-document edit MUST atomically align its task items with the canonical task projection; partial document-only or task-only acceptance is forbidden.
- **FR-010**: Adding, updating, completing, reopening, cancelling, moving, or removing tasks MUST update the page document and task projection consistently.
- **FR-011**: Legacy task items MUST remain readable; their checkbox determines todo or completed state until an accepted edit upgrades them, upgrades MUST NOT invent a due date or priority, and the task workspace MUST explain that a legacy page must be opened and saved before its tasks obtain durable identities and enter cross-page views.
- **FR-012**: Malformed, unsupported, self-contradictory, or duplicate task metadata MUST be rejected safely without altering the last valid document.
- **FR-013**: The application MUST provide a workspace-level task surface that reads from the durable local projection.
- **FR-014**: The task surface MUST provide All, Today, Upcoming, Overdue, and Finished scopes with explicit result counts and documented calendar semantics.
- **FR-015**: Active todo and in-progress tasks due on the current local calendar date belong to Today; future-dated active tasks belong to Upcoming; past-dated active tasks belong to Overdue; completed and cancelled tasks belong to Finished regardless of date.
- **FR-016**: The task surface MUST support text, status, and priority filters plus deterministic sorting by due date, priority, source page, and document order.
- **FR-017**: List and status-board views MUST represent the same filtered task set exactly once and MUST preserve the owner's current scope, filters, and sort while switching views.
- **FR-018**: Activating a task result MUST open its source page and expose a meaningful focus destination; active source-page renames and moves MUST NOT break navigation.
- **FR-019**: Tasks from trashed pages MUST be excluded from active planning scopes, MUST return after restoration, and MUST remain diagnosable if their source becomes unavailable.
- **FR-020**: Task capture, metadata editing, planning views, filters, sorting, and navigation MUST continue offline once their source data is locally available.
- **FR-021**: Offline task edits MUST atomically persist the page document, task projection, and pending-change record before local success is reported.
- **FR-022**: Reconciliation MUST be idempotent, MUST NOT duplicate task identities or planning results, and MUST retain recoverable local state when a competing revision is rejected.
- **FR-023**: Canonical export and revision snapshots MUST retain task identities and metadata in documented versioned structures.
- **FR-024**: Application logs MUST NOT contain task titles, filter text, page content, or private planning labels.
- **FR-025**: Task controls, filters, views, and results MUST support keyboard navigation, visible focus, assistive-technology labels, and supported responsive sizes without page-level horizontal overflow.
- **FR-026**: Review evidence MUST include desktop and mobile images for task capture, metadata editing, list scopes, and status-board journeys, available to reviewers with the change.
- **FR-027**: The production-like composition and its documentation MUST remain sufficient to build or retrieve application images and exercise task creation, planning views, offline-capable persistence, and restart recovery without undocumented setup.

### Key Entities

- **Task Item**: One actionable task embedded in a page document, with stable identity, title, document position, status, optional due date, and priority.
- **Task Projection**: The current queryable representation derived from accepted page task items and used by local and workspace planning views.
- **Task Scope**: A deterministic calendar or completion subset: All, Today, Upcoming, Overdue, or Finished.
- **Task View State**: The owner's current list/board mode, scope, filters, and sort; it changes presentation but not canonical task data.
- **Task Origin**: The stable source page and current lifecycle information used for navigation and diagnostics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A keyboard-only owner can create a task, assign status, due date, and priority, and return to editing in under 30 seconds.
- **SC-002**: Task identity and metadata survive save, reload, offline restart, page rename/move, export, and revision restoration in 100% of acceptance fixtures.
- **SC-003**: Fault-injection tests never observe an accepted page document and task projection out of agreement.
- **SC-004**: All, Today, Upcoming, Overdue, and Finished scopes classify every boundary-date, status, priority, lifecycle, and empty-result fixture exactly once.
- **SC-005**: List and board views expose identical filtered task sets and counts for 100% of deterministic fixtures.
- **SC-006**: A 5,000-task locally available workspace can open, filter, sort, and switch views within one second on the reference desktop environment.
- **SC-007**: Principal task capture, detail, list, board, navigation, and offline journeys complete without critical accessibility violations in supported desktop and mobile viewports.
- **SC-008**: Supported responsive viewports exhibit zero page-level horizontal overflow while editing task metadata or using every task view.
- **SC-009**: An offline create/update/reload/reconnect journey produces exactly one synchronized task identity and the expected metadata in every automated run.
- **SC-010**: Reviewers can inspect desktop and mobile visual evidence and reproduce task creation plus planning views using the documented production-like composition without undocumented steps.

## Assumptions

- The existing permanent single-owner workspace remains the security boundary; assignees, teams, permissions, comments, and shared task ownership require later specifications.
- Tasks originate in page task-list items. A separate task can be created from the task workspace only by creating or opening a source page in this release.
- Todo, in-progress, completed, and cancelled are fixed workflow states for this release; custom workflows belong with the later databases feature.
- Priority uses none, low, medium, and high. Dates are local calendar days with no time, reminder, recurrence, duration, or external calendar integration.
- Today is the current device's local calendar date. Upcoming means strictly after today; Overdue means strictly before today; completed and cancelled tasks are excluded from active date scopes.
- Nested task items remain ordinary independently actionable tasks in document order; dependency graphs and roll-up completion are excluded.
- View state is local presentation preference and is not synchronized as canonical knowledge content in this release.
- Legacy task items cannot satisfy stable cross-page identity before upgrade. They remain editable in their source page and enter planning views after the editor assigns version-4 identities and the page is saved; no background rewrite creates revisions without an owner edit.
- Existing document, revision, outbox, export, link, graph, container, and same-origin deployment foundations are extended rather than replaced.

## Scope Boundaries

### Included

- Stable task identities and task metadata inside page task-list items.
- Status, completion, calendar due date, and fixed priority editing.
- Workspace task list, status board, calendar scopes, filters, sorting, counts, and source navigation.
- Atomic canonical/local projection, offline synchronization, conflict recovery, export, responsive behavior, review images, and production-like validation.

### Excluded

- Assignees, collaboration, comments, notifications, reminders, recurrence, time-of-day scheduling, dependencies, estimates, timers, and external calendar synchronization.
- User-defined status or priority fields, custom task databases, saved shared views, formulas, automations, Kanban drag-and-drop, and gallery views.
- Creating free-floating tasks without a source page, public sharing, and exact visual compatibility with another task product.
