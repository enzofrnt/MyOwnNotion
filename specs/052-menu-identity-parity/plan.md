# Plan: Identité des menus et parité

**Feature**: 052-menu-identity-parity

- Tokens : `--ui-menu-item-height`, `--ui-menu-item-hover-bg`,
  `--ui-menu-item-danger-hover-bg` dans `tokens.css`.
- Primitives : `.ui-menu__item` et menus BlockNote consomment ces tokens.
- Boutons de menu de base et réglages de propriété alignés sur le même survol.
- Clic droit poignée : interception `contextmenu` sur le déclencheur, ouverture du
  menu riche, sans ouvrir le menu de texte.
- Outil : `scripts/notion-parity/capture.mjs` (CLI recette + surface auto) et
  `compare.mjs` ; skill `.agents/skills/notion-parity/SKILL.md` ; guide
  `docs/design/notion-parity.md`.
- Preuve : captures, comparaison, tokens UI lab.
