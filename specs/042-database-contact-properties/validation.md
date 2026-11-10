# Validation: Propriétés URL, e-mail et téléphone

**Feature**: 042-database-contact-properties
**Date**: 2026-11-04

## Résultat

Les trois types sont livrés de bout en bout : domaine, contrats, éditeur web,
filtres, recherche, export et import Notion. Aucune migration. Les tests
existants des bases restent verts.

## Exigences

| Exigence | Preuve |
| --- | --- |
| FR-001 types exposés | `packages/domain/src/databases/types.ts` ; test « trims and accepts valid contact values » |
| FR-002 config vide | union `DatabaseProperty` + schéma TypeBox ; `bun run tsc` |
| FR-003 validation | `values.ts` (`normalizeUrl/Email/Phone`) ; test « refuses malformed contact values » |
| FR-004 bornes | mêmes fonctions ; cas `+1`, `a@b`, `ftp://` refusés |
| FR-005 lecture tolérante | test « keeps a legacy value readable » |
| FR-006 filtres texte | `filter-editor.tsx`, `query.ts` (`contains`) ; aucun test dédié de requête, voir limite |
| FR-007 import | `apps/api/tests/notion-api.spec.ts` (2 tests) |
| FR-008 fallback conservé | test d'import : `import.property-static-text` absent pour les types connus ; valeur invalide signalée et non écrite |
| FR-009 recherche | `search/document-text.ts` ; suite domaine complète verte |
| FR-010 export | `canonical-export.ts` ; suite domaine complète verte |
| FR-011 changement de type | lecture tolérante + `propertyWithType` ; test de lecture héritée |

## Vérifications exécutées

```sh
bunx vitest run --project domain            # 71 fichiers, 1132 tests
bunx vitest run --project contracts         # 5 fichiers, 33 tests
bunx vitest run --project api-contract tests/notion-api.spec.ts   # 18 tests
bunx vitest run --project web               # 155 fichiers, 1042 tests
bun run --filter @myownnotion/api typecheck # aucune erreur
bun run tsc -p tsconfig.json --noEmit       # aucune erreur
bun run --filter @myownnotion/web build     # 43 sorties, 88 assets précachés
bunx biome check <fichiers modifiés>        # aucune erreur après formatage
```

## Preuves visuelles

Captures de `/__ui-lab` (données synthétiques, vrais composants) :
[clair 1440](evidence/table-contact-light-1440.png),
[sombre 1440](evidence/table-contact-dark-1440.png),
[étroit 390](evidence/table-contact-narrow-390.png).

- Colonnes « Lien » (URL), « Contact » (e-mail) et « Téléphone » avec icônes
  distinctes et valeurs lisibles dans les deux thèmes.
- Valeur longue tronquée dans la cellule, sans élargir la page.
- À 390 et 320 px, `document.scrollWidth === window.innerWidth` : aucun
  débordement horizontal de la page ; le tableau garde son défilement local.

## Limites connues

- Parcours réel exécuté le 2026-11-04 sur l'instance Docker
  (`https://localhost:8443`) : propriétés URL, e-mail et téléphone créées depuis
  le panneau, valeurs saisies dans la table, relues après rechargement.
  Capture : [table réelle](evidence/table-contact-live-1440.png).
- Le menu de type n'a pas de capture propre : il n'existe pas de surface
  `/__ui-lab` pour l'éditeur de propriété ; les tests web vérifient les
  libellés et la validation.
- Ouvrir le lien, le client mail ou le composeur téléphonique au clic reste
  hors périmètre (spec) ; la valeur est lisible et copiable.
- Les filtres `contains` sur les nouveaux types sont couverts par la liste
  partagée éditeur/requête et la compilation ; un test de requête dédié reste
  souhaitable dans la passe de chrome.
- Les filtres de vue Notion portant sur une URL, un e-mail ou un téléphone sont
  désormais importés comme opérandes texte (y compris `contains` partiel), mais
  aucun test d'import de vue ne les couvre encore.

## Revue UI

`ui-quality` chargé ; états vide, erreur, valeur longue et largeur étroite
couverts. La surface reste alignée sur les primitives existantes, sans nouveau
style de bouton ni couleur brute. La fidélité pixel à Notion (barre d'outils,
pilules d'onglets, chips) appartient à la passe suivante.
