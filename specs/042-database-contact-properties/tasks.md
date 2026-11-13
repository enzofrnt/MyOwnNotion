# Tasks: Propriétés URL, e-mail et téléphone

**Feature**: 042-database-contact-properties
**Plan**: [plan.md](plan.md) | **Spec**: [spec.md](spec.md)

## Phase 1 — Domaine

- [x] T001 Ajouter `url`, `email`, `phone` à `DATABASE_PROPERTY_TYPES` et à
  l'union `DatabaseProperty` (config vide) dans `packages/domain/src/databases/types.ts`.
- [x] T002 Ajouter `normalizeUrl`, `normalizeEmail`, `normalizePhone` et les
  branches de `normalizePropertyValue` dans `values.ts` ; validation seulement
  en intention `write`.
- [x] T003 Étendre `isPropertyValueCompatible` pour accepter `kind: "text"`.
- [x] T004 Ajouter les trois types à l'ensemble `sourceType` de
  `export/canonical-export.ts`.
- [x] T005 Indexer les valeurs des trois types dans `search/document-text.ts`.
- [x] T006 Tests domaine : valeurs valides, refus, trim, bornes, lecture
  tolérante, compatibilité (`packages/domain/tests/databases/values.spec.ts`).

## Phase 2 — Contrats et import

- [x] T007 Ajouter les littéraux aux schémas TypeBox de
  `packages/contracts/src/content-api.ts`.
- [x] T008 Mapper `url`/`email`/`phone` dans
  `apps/api/src/imports/notion/properties.ts` (type et valeur), conserver le
  fallback texte et l'avis d'import.
- [x] T009 Test d'import : type conservé, valeur conservée, valeur invalide
  signalée.

## Phase 3 — Interface web

- [x] T010 Étendre `property-editor.tsx` (brouillon → propriété) et
  `property-configuration.tsx` (menu de type, `ENTRY_PROPERTY_TYPES`).
- [x] T011 Étendre `value-editor.tsx` (validation, message, placeholder) et
  `database-copy.ts` (libellés, exemples, erreurs).
- [x] T012 Étendre `filter-editor.tsx` (opérateurs `contains`) et
  `property-icon.tsx` (icônes distinctes) et `database-value.ts` (affichage).
- [x] T013 Tests web : menu de type, validation, conservation du brouillon,
  affichage vide.
- [x] T014 Appliquer `ui-quality` et produire les preuves visuelles dans
  `validation.md` (lab, états vide/erreur/long/320 px).

## Phase 4 — Vérification

- [x] T015 `bun run typecheck`, tests ciblés domaine/web, lint/format.
- [x] T016 Mettre à jour `validation.md` avec les commandes, résultats et
  limites ; cocher les tâches.

## Dependencies

T002 dépend de T001. T007 et T008 dépendent de T001. T010–T012 dépendent de
T001 et T002. T015 dépend de tout le reste. T014 peut démarrer dès T012.

## Out of scope

Ouverture du lien au clic, propriétés personne/fichiers/formule, plages de dates,
statuts Notion.
