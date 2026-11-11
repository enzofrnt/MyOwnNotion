# Tasks — parité des types de propriété

## Phase 0 — Fondation (bloquant)

- [x] T001 [P] Capturer le panneau Notion « Modifier la propriété » (menu + side panel) et relever structure/styles/états dans `evidence/`.
- [x] T002 Ajouter « Modifier la propriété » au menu de colonne et le panneau latéral réutilisable (Ariakit, clavier, Échap, focus).
- [x] T003 Brancher les configs existantes (date mode, relation cardinalité, options de choix, formule, agrégation) dans le panneau, sans changer les données.
- [ ] T004 Vérifier visuellement clair/sombre/320 px et consigner dans `validation.md`. (partiel : clair 1440, options + formule ; sombre/320 à faire)

## Phase 1 — Nombre et Dates

- [x] T010 Domaine nom : `NumberConfig` (format, décimales, affichage), validation, défauts, tests.
- [~] T011 Web nom : formulaire dans le panneau + formatage cellule + Barre/Anneau + tests. (fait : panneau, formats, décimales, bar/anneau ; preuve visuelle d’une valeur bar/anneau encore à faire)
- [~] T012 Domaine dates : formats, heure, plage ; dates auto en lecture seule ; défauts, tests. (fait : formats/heure/défauts/tests + formats des dates auto + plages)
- [~] T013 Web dates : formulaire + affichage date/heure/plage + tests. (fait : formulaire formats/heure, civil/instant, dates auto, éditeur de plage ; preuve date-range-editor.png)
- [ ] T014 Preuves visuelles nombre/dates + validation. (nombre : panneau clair ; bar/anneau avec valeur à capturer)

## Phase 2 — État et Identifiant

- [x] T020 Domaine état : groupes fixes, options multiples, default, couleurs, validation, tests.
- [x] T021 Web état : panneau (groupes/options/défaut), cellule, filtres/tris, tests. (preuve status-settings.png)
- [x] T022 Domaine identifiant : préfixe, numérotation stable, migration, tests.
- [~] T023 Web identifiant : config préfixe, affichage, URL si retenue. (préfixe + affichage ; URL non faite)
- [x] T024 Preuves visuelles état/identifiant. (status-settings.png, unique-id-settings.png)

## Phase 3 — Agrégation

- [x] T030 Domaine agrégation : relation cible, propriété cible, 24 fonctions, valeurs typées, tests.
- [x] T031 Web agrégation : config (relation/propriété/calcul), calcul, affichage, filtres/tris. (API + calcul local ; options cible depuis toutes les bases locales)
- [x] T032 Preuves visuelles. (rollup-settings.png)

## Phase 4 — Fichiers

- [x] T040 Upload/lien, multi-fichiers, aperçus, suppression, limites Notion (config), tests. (upload, liens externes, multi, aperçus, limites 5/20 Mo, tests)
- [~] T041 UI cellule + erreurs + preuves. (propriétés de page + liens + erreurs ; édition fichier en cellule de table non faite ; preuve : file-links.png)

## Phase 5 — Formule

- [ ] T050 Modèle d'expression/évaluation typée, propriétés, erreurs, tests.
- [x] T051 Éditeur UI (propriétés, palette/docs, aperçu, débogage, type), sans IA. (dialogue, propriétés, palette, aperçu par page, type, erreurs)
- [~] T052 Couverture des fonctions (palier 1 puis complet) + tests. (palier 1 étendu : texte, logique, nombres, dates ; couverture Notion complète non faite)
- [~] T053 Preuves visuelles. (formula-editor.png ; états sombres/320 à faire)

## Phase 6 — Lieu et Carte

- [ ] T060 Config clé Google, proxy Places, adapter, tests sans clé.
- [ ] T061 UI cellule (recherche/adresse/position), stockage, filtre/tri.
- [ ] T062 Vue Carte (Maps JS, pins, popup, 100 max) + preuves.
- [ ] T063 Message clair clé manquante + validation.

## Correction propriétaire — forme des menus uniquement

- [x] T080 Isoler un propriétaire CSS unique pour le menu, les flyouts et les panneaux de configuration portalisés ; ne pas ajouter/retirer d’actions.
- [x] T081 Uniformiser l’échelle optique légère et les survols ; positionner les flyouts selon leur taille réelle, avec survol, Échap et retour du focus.
- [x] T082 Vérifier la forme dans le contexte réel (clair/sombre, largeur étroite) ; les mesures automatiques seules ne valent pas validation visuelle. Suivre ui-quality + lessons.md et notion-parity.

## Reprise demandée — 2026-11-11

Les cases historiques ci-dessus décrivent le travail alors déclaré, pas une
preuve de parité actuelle : en particulier T030–T032 ne clôturent pas les
scénarios FR-015 ; T060–T063 ne reflètent pas toutes les finitions décrites dans
`validation.md`. Ne pas les recopier comme acquis. Le diagnostic est dans
`audit-reprise.md`. Aucune des tâches ci-dessous n'est achevée par ce cadrage.

### Fondation commune (avant développement)

- [~] T100 [P] Relever dans `specs/055-property-type-parity/audit-reprise.md` les parcours réels Notion et candidat avec recettes, captures ouvertes et matrice d'états ; conserver les limites d'accès sans données privées. (référence Notion capturée, candidat capturé clair/sombre/390 ; comparaison chiffrée et 320 px non faites)
- [x] T101 Définir dans `specs/055-property-type-parity/plan.md` les types, vides/erreurs/incomplétude, fonctions compatibles, règles dates/précision et contrat local/API, puis analyser migrations, export, restauration, sync et anciens clients. (décisions consignées dans plan.md § « Contrat de calcul arrêté »)
- [ ] T102 [P] Compléter dans `specs/055-property-type-parity/audit-reprise.md` l'inventaire des types et classer manques et exclusions ; ne pas implémenter Personne/Bouton/auteurs sans décision produit.

### US6 — Agrégation, prioritaire (après T100–T101)

Test indépendant : relation avec deux valeurs 10 et 20, somme 30 identique dans
la table, le volet et une formule ; filtre/tri corrects avant pagination, en
ligne et local ; moyenne vide ≠ compte des relations.

- [x] T103 [US6] Ajouter les tests de compatibilité relation/source/propriété/fonction et cas vides/supprimés dans `packages/domain/tests/databases/rollup.spec.ts` et `packages/domain/tests/databases/schema.spec.ts`. (rollup.spec.ts ; la compatibilité cible/fonction vit dans le calcul, le schéma ne voit pas la base liée)
- [x] T104 [US6] Corriger calcul et validation typés dans `packages/domain/src/databases/rollup.ts` et `packages/domain/src/databases/schema.ts`, selon le contrat T101. (résultat typé, vide ≠ non calculable, fonctions par type)
- [x] T105 [US6] Corriger sélection et invalidation en fonction de la vraie source cible dans `apps/web/src/features/databases/property-configuration.tsx` ; couvrir la dépendance entre sélecteurs. (résolu par 057 : la relation mémorise `targetSourceId` ; cibles limitées à la source, cible étrangère signalée, tests et parcours navigateur.)
- [x] T106 [US6] Unifier projection et calcul avant filtre/tri/pagination dans `apps/api/src/databases/database-query-service.ts` et `apps/web/src/features/databases/local-rollup.ts` ; tester intégration et contexte local incomplet. (résolu par 057 : sources indexées par `sourceId` côté API, SQL et local, entrée multi-appartenante, propriétaire inactif ; 3 057 tests unitaires et parcours navigateur verts.)
- [x] T107 [US6] Corriger le rendu et supprimer les faux comptes dans `apps/web/src/features/databases/database-value.ts` et `apps/web/src/features/databases/entry-panel.tsx` ; remplacer le test de fallback trompeur `apps/web/tests/database-rollup.spec.ts`. (displayRollupCell ; test de repli remplacé)
- [x] T108 [US6] Appliquer ui-quality, lessons et notion-parity et documenter captures et parcours Playwright réel dans `specs/055-property-type-parity/validation.md` et `tests/e2e/` : configuration, dépendances, erreur, clavier, thèmes et 320/390 px. (parcours maintenu `tests/e2e/database-relations-rollups.spec.ts` desktop+mobile, captures clair/sombre/390/320 dans `specs/057-database-relations-rollups/evidence/candidate/`.)

### US8 — Formule (après T100–T101 ; intégration rollup après T104–T107)

Test indépendant : choisir successivement deux entrées d'aperçu distinctes,
constater leurs résultats, puis saisir une expression invalide sans remplacer
l'expression valide ; vérifier cycle, propriété renommée et référence à somme.

- [~] T109 [US8] Établir dans `specs/055-property-type-parity/audit-reprise.md` une matrice des fonctions/types Notion, implémentés, manquants et volontairement exclus, avec cas concrets et sources. (catalogue vérifié par test ; exclusions listées dans validation.md, matrice Notion complète non rédigée)
- [x] T110 [US8] Ajouter tests de régression aperçu sélectionné, saisie invalide et conservation/reprise dans `apps/web/tests/` et corriger `apps/web/src/features/databases/formula-editor.tsx`. (formula-editor.spec.tsx)
- [x] T111 [US8] Tester puis corriger dépendances, types, limites de ressources, dates et erreurs dans `apps/web/src/features/databases/formula.ts` et `apps/web/tests/formula.spec.ts` ; partager le calcul approprié si T101 le décide. (moteur partagé dans le domaine, formula.spec.ts)
- [x] T112 [US8] Propager résultat d'agrégation et identifiant stable aux contextes table/volet/aperçu dans `apps/web/src/features/databases/database-value.ts`, `entry-panel.tsx` et `formula-editor.tsx`, avec tests croisés. (formulaContextOf commun aux trois surfaces)
- [x] T113 [US8] Implémenter les capacités de l'éditeur et les fonctions retenues par la matrice T109, sans IA, dans `apps/web/src/features/databases/formula-editor.tsx` et `apps/web/src/features/databases/formula.ts` ; ne pas annoncer de fonction non supportée. (95 entrées documentées, sans IA ; personnes et style exclus)
- [~] T114 [US8] Appliquer ui-quality, lessons et notion-parity et consigner captures et parcours Playwright dans `specs/055-property-type-parity/validation.md` et `tests/e2e/` : liste de fonctions, insertion, aperçu, erreur, clavier, thèmes et 320/390 px. (captures clair/sombre/390 et parcours réel scriptés ; pas de spec tests/e2e)

### US9 — Lieu et carte (après T100–T101)

Test indépendant : saisir deux recherches rapidement avec réponses inversées ;
seule la dernière est présentée, un lieu choisi survit au rechargement et reste
lisible hors ligne ; refus de géolocalisation et erreur carte offrent une reprise.

- [x] T115 [US9] Tester recherche, requêtes obsolètes, refus, absence de clé et erreurs dans `apps/web/tests/` et `apps/api/tests/` ; corriger `apps/web/src/features/databases/place-property-field.tsx`, `apps/web/src/services/places.ts` et `apps/api/src/routes/places.ts`. (POST, annulation, états ; google-places.spec.ts et place-property-field.spec.tsx)
- [x] T116 [US9] Définir puis implémenter géolocalisation autorisée, réessai et états de carte dans `apps/web/src/features/databases/place-property-field.tsx` et `apps/web/src/features/databases/map-view.tsx`, sans masquer indisponibilité ou données incomplètes. (position actuelle locale, réessai, états de carte ; refus vérifié par test seulement)
- [x] T117 [US9] Vérifier et corriger filtrage nom/adresse et tri, parité local/API dans `packages/domain/src/databases/query.ts` et tests de domaine/intégration correspondants. (filtre nom + adresse ; test de domaine)
- [~] T118 [US9] Documenter et tester les sorties vers Google, permissions et restrictions de clés sans exposer de secrets dans `specs/055-property-type-parity/validation.md` et les tests des routes concernées. (sorties vers Google décrites dans validation.md ; restrictions de clés à vérifier par le propriétaire dans Google)
- [~] T119 [US9] Appliquer ui-quality, lessons et notion-parity et consigner captures et parcours Playwright dans `specs/055-property-type-parity/validation.md` et `tests/e2e/` : recherche, carte, sélection, erreurs, clavier, thèmes et 320/390 px. (captures clair/sombre et parcours réel scriptés ; pas de spec tests/e2e, erreurs non capturées en réel)

### Validation finale

- [~] T120 Vérifier migration aller, sauvegarde/restauration, export/import, protocole et modifications hors ligne dans les tests pertinents `packages/` et `tests/` ; documenter les chemins non concernés dans `specs/055-property-type-parity/validation.md`. (aucune donnée stockée modifiée ; changements de contrat listés dans validation.md, pas de test dédié)
- [~] T121 Exécuter les contrôles sélectionnés selon `docs/development.md`, les parcours Playwright requis et la comparaison Notion/candidat ; corriger les écarts matériels et consigner commandes, résultats et limites dans `specs/055-property-type-parity/validation.md`. (suites unitaires et API ciblées exécutées ; e2e, build et checks:local non exécutés)
- [ ] T122 Réconcilier les statuts historiques T030–T063 et les preuves existantes dans `specs/055-property-type-parity/tasks.md` et `specs/055-property-type-parity/validation.md`, puis effectuer l'analyse de cohérence et convergence.

## Phase 7 — Convergence

- [ ] T070 `bun run checks:local` ou sélection impact, tests, tsc, biome, builds.
- [ ] T071 Mettre `validation.md`, erreurs E-055, preuves, limites.
