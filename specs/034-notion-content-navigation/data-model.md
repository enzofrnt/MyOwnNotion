# Data model

- equation: type, UUID id, string expression ; opération set-block-property.
- tableOfContents: type, UUID id ; projection des titres, jamais liste stockée.
- InlineV3: text = fallback lisible (LF/tab en espaces ; U+FFFC si vide), mark
  equation avec UUID equationId et string expression contenant la source exacte.
  Les spans ordinaires interdisent les contrôles LF/tab ; le mark accepte cette
  source avec les mêmes bornes que le code. Expansion none, identité stable pour
  empêcher la fusion de deux formules adjacentes.
- Projection BlockNote: bloc equation et inline inlineEquation ; noms distincts
  nécessaires au registre commun Tiptap. marksJson transporte les annotations
  supplémentaires entre la projection et les marks canoniques, sans HTML stocké.
- PageHeading: id, level1–4, texte ; état dérivé de la page active.
- List row: DatabaseViewRow existant avec icon/itemKind/holdsContent et valeurs.
- Unknown keys/types conservés ; aucun changement SQL. Export source LaTeX.
