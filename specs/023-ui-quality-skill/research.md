# Research: UI workflow guidance

## Reuse the active visual system

**Decision**: Reference `apps/web/src/ui/tokens.css`, primitives, `AppIcon` and
`apps/web/src/global.css`; require entrypoint verification before styling.
**Rationale**: Those are the active component/token paths. A historical
`styles.css` also exists; its contents cannot prove the rendered application.
**Alternatives considered**: A new design system or duplicated token table would
create unnecessary drift and is outside the owner's request.

## Skill location and authority

**Decision**: Maintain one custom `.agents/skills/ui-quality/SKILL.md` and link
from shared guidance and active feature artifacts. Do not modify generated
`speckit-*` skills or templates.
**Rationale**: Agent Skills discovery plus ordinary Markdown makes the same
source available across tools. The owner explicitly requested this addition.
**Alternatives considered**: Duplicating the entire skill into `.cursor/` or each
spec conflicts with the single-source rule. A thin reference remains sufficient.

## Review rules rather than copied CSS assertions

**Decision**: Guidance combines concrete examples with actual rendered-state
inspection; feature-specific interaction tests belong in each feature's tasks.
**Rationale**: A source assertion cannot prove click stability, usable focus,
correct nesting or which stylesheet is loaded. Documentation itself requires
metadata/link/consistency checks, not new application test suites.
