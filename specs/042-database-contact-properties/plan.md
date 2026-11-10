# Implementation Plan: Propriétés URL, e-mail et téléphone

**Branch**: `042-database-contact-properties` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

## Summary

Ajouter trois types de propriétés à config vide (`url`, `email`, `phone`) en
réutilisant la valeur texte existante. La validation vit dans le domaine ; les
contrats, l'éditeur web, l'import Notion et l'export canonique sont étendus. Aucune
migration, aucun nouveau sous-système de stockage.

## Technical Context

- **Langage** : TypeScript strict, Bun 1.4.2, React 19.
- **Domaine** : `packages/domain/src/databases` (pur, sans DOM).
- **Contrats** : `packages/contracts/src/content-api.ts` (TypeBox).
- **Web** : `apps/web/src/features/databases` (React + primitives existantes).
- **Import** : `apps/api/src/imports/notion/properties.ts`.
- **Tests** : Vitest (domaine, web), Playwright e2e pour le parcours de base.
- **Migration** : aucune. Les définitions et valeurs sont des révisions JSON.
- **UI quality** : charger `.agents/skills/ui-quality/SKILL.md` et `lessons.md`
  avant le code UI ; consigner les preuves visuelles dans `validation.md`.

## Key Decisions

1. **Valeur texte partagée.** Les trois types stockent `{ kind: "text", value }`
   au lieu d'introduire trois nouveaux `kind`. Cela conserve un seul chemin de
   comparaison pour les filtres, les tris et l'affichage, et évite de modifier
   `query.ts`, `displayDatabaseValue` ou les schémas de valeurs.
2. **Validation à l'écriture, tolérance à la lecture.** `normalizePropertyValue`
   valide quand `intent === "write"` ; en `"decode"`, une valeur héritée non
   conforme reste lisible (principe 4.2 du canevas : pas de perte silencieuse).
3. **Compatibilité de valeur.** `isPropertyValueCompatible` accepte une valeur
   texte pour ces trois types.
4. **Filtres texte.** `contains`/`not-contains` rejoignent la liste des opérateurs
   disponibles ; l'opérande reste `{ kind: "text" }`.
5. **Import.** Les types Notion `url`, `email`, `phone` deviennent les types
   correspondants ; une valeur invalide produit un avis d'import et n'est pas
   écrite (l'archive originale reste disponible). Le fallback
   `import.property-static-text` est conservé pour les types encore inconnus.
6. **Recherche.** Les valeurs des trois types sont extraites comme du texte dans
   `document-text.ts` ; l'index n'a pas besoin de nouveau champ.

## Validation Rules

| Type | Normalisation | Refus |
| --- | --- | --- |
| URL | `trim`, 1..2048, schéma `http` ou `https`, `new URL` valide | vide après trim, autre schéma, chaîne non parsable |
| E-mail | `trim`, 1..254, une `@`, partie locale non vide, domaine avec point | sans `@`, domaine sans point, espaces |
| Téléphone | `trim`, 1..40, `+` initial autorisé, chiffres, espaces, `-`, `.`, `(`, `)` ; au moins 3 chiffres | lettre, moins de 3 chiffres, plus de 40 |

Un champ vidé supprime la valeur (comme le texte). Les messages vivent dans
`DATABASE_COPY.value` et `DATABASE_COPY.property`.

## Files Touched

- `packages/domain/src/databases/types.ts` — union et liste des types.
- `packages/domain/src/databases/values.ts` — normaliseurs et branches.
- `packages/domain/src/export/canonical-export.ts` — ensemble `sourceType`.
- `packages/domain/src/search/document-text.ts` — indexation texte.
- `packages/contracts/src/content-api.ts` — union TypeBox.
- `packages/domain/tests/databases/values.spec.ts` — cas valides/invalides.
- `apps/web/src/features/databases/property-editor.tsx` — brouillon → propriété.
- `apps/web/src/features/databases/property-configuration.tsx` — menu de type.
- `apps/web/src/features/databases/value-editor.tsx` — validation et saisie.
- `apps/web/src/features/databases/filter-editor.tsx` — opérateurs.
- `apps/web/src/features/databases/property-icon.tsx` — icônes.
- `apps/web/src/features/databases/database-copy.ts` — libellés et messages.
- `apps/web/src/features/databases/database-value.ts` — affichage.
- `apps/api/src/imports/notion/properties.ts` — types et valeurs.
- `apps/web/tests/database-editor.spec.tsx` — création et validation UI.

## Test Plan

- **Domaine** : valeurs valides pour chaque type, refus des formats invalides,
  trim, bornes, valeur héritée invalide en lecture, compatibilité texte.
- **Contrats** : la définition avec les trois types passe le schéma.
- **Web** : le menu de type propose les trois entrées ; le champ refuse une
  valeur invalide et conserve la saisie ; l'affichage vide reste `—`.
- **Import** : `convertProperty` produit `url`/`email`/`phone` et
  `convertValue` conserve le texte.
- **E2E** : une base de test crée les trois propriétés, saisit une valeur valide
  et la retrouve après rechargement (extension du spec de vues).
- **Non-régression** : `bun run test:unit` sur les projets domain et web.

## UI States and Evidence

- Vide, erreur, chargement, valeur longue, 320 px : décrits dans la spec.
- Preuves : capture de `/__ui-lab` avec les trois colonnes, thème clair et
  sombre si disponibles ; capture du panneau de type.
- Aucune revendication de conformité pixel avec Notion ; la fidélité visuelle
  est traitée dans la passe de chrome (feature suivante).

## Risks

| Risque | Mitigation |
| --- | --- |
| Valeur héritée invalide après changement de type | lecture tolérante, aucun écrasement ; test dédié |
| Filtre `contains` incohérent entre éditeur et requête | même liste dans `filter-editor.tsx` et `query.ts` ; test |
| Import qui perd la valeur | avis explicite + conservation en texte ; test `convertValue` |
| Terminologie française instable | libellés centralisés et testés par le menu |

## Constitution Check

Aucun secret, aucun stockage local non chiffré, aucune nouvelle dépendance. Le
domaine reste pur ; l'import ne modifie pas la source Notion. La feature ne
change ni le protocole de synchronisation ni le format de sauvegarde.
