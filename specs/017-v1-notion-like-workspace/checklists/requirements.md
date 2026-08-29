# Specification Quality Checklist: Expérience V1 proche de Notion et convergence locale

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- « Proche de Notion » is resolved into observable interactions and measurable
  outcomes rather than left as a subjective adjective.
- Library, styling-system, licence and component-adoption choices belong in the
  technical plan and do not constrain this product specification.
- The specification deliberately includes the two known feature 003 gaps so
  V1 readiness cannot remain partial after the visual refactor.
- The personal-product scope deliberately limits accessibility requirements to
  practical keyboard, focus, labels, pointer and touch behavior; formal WCAG
  certification and specialized assistive-technology validation are out of
  scope unless the product direction is explicitly amended again.
- The 2026-08-27 refinement makes sidebar preferences, three-zone hierarchy
  drops, title fallback timing, compact sync placement, and the complete
  internal/external link lifecycle observable and independently testable.
- The follow-up refinement fixes the exact placement and visual contract of
  disclosure controls and switches, removes stale empty-page branches and
  accent rails, and makes `/lien`, page targets, Web targets, unlinking and the
  empty-line caret one measurable lifecycle without turning embeds into links.
- The 2026-08-28 correction supersedes the unified target picker: page
  references and Web bookmarks now have distinct compact keyboard flows, while
  emoji are canonical page/folder properties reused by every representation.
- The approved sidebar prototype is now versioned under `assets/` and is the
  normative interaction reference for sidebar collapse, branch disclosure,
  inline child creation and compact attachments. FR-086 and FR-091–FR-095 plus
  SC-035–SC-038 expose its geometry and intermediate motion as testable
  outcomes instead of relying on a prose-only approximation.
- The screenshot review of 2026-08-29 further fixes the open creation cluster
  as a visible 88 × 30 px enclosing surface around three 28 px controls, with
  one-pixel regular spacing and no exterior shadow. Three loose icons do not
  satisfy the requirement. The normative asset, FR-091 and SC-037 carry the
  same measurable correction.
- The 2026-08-29 viewport and creation refinement fixes scroll ownership,
  aligns the collapsed-sidebar control with the top chrome, unifies all
  page/folder creation paths around a focused empty title, replaces the
  editorial loading banner with a neutral skeleton, and makes deletion of a
  complete page-link line durable across delayed projection and synchronization.
