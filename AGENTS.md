# Agent instructions

This repository uses GitHub Spec Kit for specification-driven development. These instructions apply to every coding agent, including OpenAI Codex and Cursor.

## Single source of truth

Use this precedence order when sources disagree:

1. `.specify/memory/constitution.md` — non-negotiable project principles.
2. `specs/<feature>/spec.md` — required behavior and scope.
3. `specs/<feature>/plan.md` — approved technical approach.
4. `specs/<feature>/tasks.md` — implementation sequence and progress.
5. Supporting documents under the same feature directory, then `docs/`.
6. Existing implementation.

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
- Keep product requirements technology-agnostic in `spec.md`; put technical choices in `plan.md`.
- Keep each feature in exactly one `specs/<feature>/` directory.
- Record decisions and clarifications in the active feature artifacts so another agent can continue without relying on chat history.
- Treat user data, offline behavior, synchronization, permissions, and migrations as explicit design concerns.
- Add tests for changed behavior and run the relevant checks before marking tasks complete.
- Prefer small, reversible changes. Do not silently expand feature scope.
- Do not hand-edit generated files under `.agents/skills/`, `.cursor/skills/`, or shared `.specify/` templates unless intentionally customizing Spec Kit. Refresh them with the Specify CLI instead.

## Agent commands

- Codex uses project skills such as `$speckit-specify`, `$speckit-plan`, `$speckit-tasks`, and `$speckit-implement`.
- Cursor uses the corresponding project skills such as `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, and `/speckit-implement`.

Both command families read and write the same constitution and feature directories.
