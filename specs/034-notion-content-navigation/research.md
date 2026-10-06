# Research decisions

- KaTeX local et sans confiance : lecture offline, erreurs locales avec source
  intacte. Alternative MathJax asynchrone inutile ici. Sources primaires :
  https://katex.org/docs/options et https://katex.org/docs/api.
- equation.expression propriété ; inline mark equation avec ID stable : garde
  le modèle de spans et les frontières. Alternative union inline implique une
  migration du moteur de texte. HTML opaque perd édition et sécurité.
- TOC dérivé, sans titres persistés : évite la copie périmée.
- Outline discoverable et host scoped : les éditeurs keep-alive restent montés,
  tandis que les IDs BlockNote vivent sur bn-block-outer.
- Notion parent block_id vers page propriétaire : forêts collectées suffisantes.
  Exclusion explicite de base et membres, sans filtre universel de titre.
- Deux agents de recherche mobilisés selon speckit-plan phase0. Le cache chiffré
  a été inspecté sans publication des identités ni contenus privés.

- La source inline reste dans mark.expression ; le texte lisible normalise LF/tab,
  interdits dans les spans ordinaires. Les identités distinctes évitent la fusion.
  BlockNote utilise inlineEquation pour éviter une collision Tiptap avec le bloc
  equation. L'export conserve les sauts de ligne internes à la source ; seuls les
  séparateurs de blocs vides consécutifs sont réduits.
- Validation navigateur : une marge de48px entre alignement du lien (48px) et
  seuil actif (96px) tient compte du recalage du chrome et des blocs à l'activation. Un seuil
  trop serré laissait le repère sur le titre précédent pour un écart de1,75px.
