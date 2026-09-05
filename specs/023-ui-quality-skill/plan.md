# Implementation Plan: Shared UI quality skill

**Branch**: `codex/pre-v1-data-quality` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary

Deliver a maintained `.agents/skills/ui-quality/SKILL.md` with actionable design
and review guidance. Link it from `AGENTS.md`, `docs/development.md`, the canvas
workflow and active UI feature plans/tasks. No generated Spec Kit skill or
shared template is edited. Canvas traceability: sections 39, 43.4–43.6 and 44.

## Technical Context

**Language/Version**: Markdown with Agent Skills YAML frontmatter.
**Primary Dependencies**: Existing UI tokens, primitives and icon vocabulary as
references only; no added runtime dependency.
**Storage**: Versioned prose only; no user data or migration.
**Testing**: Skill metadata validation, link inspection, Spec Kit prerequisite
and cross-artifact review, `git diff --check`.
**Target Platform**: Repository contributors using Agent Skills or direct Markdown.
**Project Type**: Internal development workflow.
**Constraints**: Canonical requirements remain under `specs/`; custom guidance
must survive ordinary Spec Kit refresh without editing generated commands.
**Scale/Scope**: One skill and thin references; no automatic repository-wide redesign.

## Constitution Check

Pre-research and post-design: PASS. Principles II/VIII preserve one source of
product truth; III uses reviewable documentation acceptance, IV introduces no
private data processing, V adds no runtime abstraction, VI preserves practical
keyboard behavior without adding formal certification, VII follows the current
documentation-only gate for this incremental change after desktop is merged.
No constitution exception is needed. The owner's explicit custom-skill request
permits this maintained workflow skill; AGENTS will distinguish it from generated
Spec Kit skills rather than contradict its current generated-only wording.

## Project Structure

- `.agents/skills/ui-quality/SKILL.md`: sole maintained skill source.
- `AGENTS.md`, `docs/development.md`: thin discovery/workflow references.
- `docs/product/product-canvas.md`: contributor workflow reference, no duplicated rules.
- `specs/009-databases-structured-tasks/plan.md` and `tasks.md`: next database UI work.
- `specs/014-desktop-clients/plan.md` and `tasks.md`: continuing desktop UI work.
- `specs/017-v1-notion-like-workspace/plan.md` and `tasks.md`: active workspace UI work.
- `specs/023-ui-quality-skill/`: spec, plan, tasks, research, data model and validation guide.

## Delivery and validation

Implement US1 first, then US2. Check actual paths/tokens before describing them.
Review an existing form, toolbar and nested-surface example against the rules;
this verifies useful guidance and makes no claim that those screens are fixed.
The skill has no public runtime interface, so no API contract is introduced.
Run documented prose checks and skill validation. Deliver after desktop's merge;
classify the complete diff at that time rather than treating inherited desktop
code as documentation-only.
