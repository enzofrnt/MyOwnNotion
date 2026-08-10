# Agent instructions

This repository uses GitHub Spec Kit for specification-driven development. These instructions apply to every coding agent, including OpenAI Codex and Cursor.

## Single source of truth

Use this precedence order when sources disagree:

1. `.specify/memory/constitution.md` — non-negotiable project principles.
2. `docs/product/product-canvas.md` — canonical cross-feature product direction,
   permanent boundaries, release scope, and delivery trajectory.
3. `specs/<feature>/spec.md` — required behavior and scope for one feature.
4. `specs/<feature>/plan.md` — approved technical approach.
5. `specs/<feature>/tasks.md` — implementation sequence and progress.
6. Supporting documents under the same feature directory, then other `docs/`.
7. Existing implementation.

Feature specifications refine the product canvas into testable behavior. They
must not silently contradict it. When product direction changes, update the
canvas and every directly affected active feature artifact in the same change.

Never copy feature requirements into agent-specific files. `.agents/` and `.cursor/` contain only generated workflow skills or thin pointers to the shared artifacts.

## Required workflow

For a new feature, use Spec Kit in this order:

1. Specify the user need and acceptance criteria.
2. Clarify material ambiguities when needed.
3. Create the technical plan.
4. Generate the task list.
5. Analyze consistency between the artifacts.
6. Implement tasks in order and keep `tasks.md` current.
7. Converge until the implementation and specification agree.

Do not begin feature implementation before `spec.md`, `plan.md`, and `tasks.md` exist. Small maintenance changes may use a short spec only when behavior or architecture changes; purely mechanical chores may be handled directly.

## Working conventions

- Read the constitution and the active feature artifacts before editing code.
- Read `docs/product/product-canvas.md` before specifying or planning a feature,
  and record the relevant canvas sections in that feature's artifacts.
- Keep product requirements technology-agnostic in `spec.md`; put technical choices in `plan.md`.
- Keep each feature in exactly one `specs/<feature>/` directory.
- Record decisions and clarifications in the active feature artifacts so another agent can continue without relying on chat history.
- Treat user data, offline behavior, synchronization, permissions, and migrations as explicit design concerns.
- Add tests for changed behavior and run the relevant checks before marking tasks complete.
- Prefer small, reversible changes. Do not silently expand feature scope.
- Do not hand-edit generated files under `.agents/skills/`, `.cursor/skills/`, or shared `.specify/` templates unless intentionally customizing Spec Kit. Refresh them with the Specify CLI instead.

## Agent commands

- Codex uses project skills such as `$speckit-specify`, `$speckit-plan`, `$speckit-tasks`, and `$speckit-implement`.
- Cursor and Claude Code use the corresponding project skills such as `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, and `/speckit-implement`.

All command families read and write the same constitution and feature directories.

## Optional output-style tooling

[i-have-adhd](https://github.com/ayghri/i-have-adhd) is an optional skill that shapes agent replies to lead with the action, number steps, and cut preamble/recaps. It is opt-in only — nothing changes until it is invoked.

- Claude Code: `claude plugin marketplace add ayghri/i-have-adhd && claude plugin install i-have-adhd@i-have-adhd`, then type `/i-have-adhd`.
- Codex: `codex plugin marketplace add ayghri/i-have-adhd --ref main && codex plugin add i-have-adhd@i-have-adhd`, then type `$i-have-adhd`.
- Cursor and other Agent Skills harnesses: `npx skills add ayghri/i-have-adhd -a cursor -y`, then type `/i-have-adhd`.

See the repo's `INSTALL.md` for other harnesses and always-on options.
