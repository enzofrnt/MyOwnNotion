# Validate the UI quality skill

From the repository root:

```bash
SPECIFY_FEATURE_DIRECTORY=specs/023-ui-quality-skill .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
git diff --check
```

1. Validate the skill's YAML frontmatter and naming with the available
   `skill-creator` validator; it must report a valid skill.
2. Follow every new link from AGENTS, development guidance and active UI artifacts.
   All must reach the same maintained skill.
3. Review rules against a form with loading/error states, a compact toolbar and
   a 16 px outer-radius surface inset by 4 px. Guidance must yield stable controls,
   grouped spacing and a 12 px inner radius where contours follow each other.
4. Check coverage of keyboard, narrow layout, long text and both themes.
5. Record proof and actual limits in `validation.md`; do not claim existing
   screens were redesigned or passed a new visual campaign.

No application suite is required for this guidance-only increment once its
complete diff excludes inherited desktop changes. Follow `docs/development.md`.
