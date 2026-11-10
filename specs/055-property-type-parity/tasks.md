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

## Phase 7 — Convergence

- [ ] T070 `bun run checks:local` ou sélection impact, tests, tsc, biome, builds.
- [ ] T071 Mettre `validation.md`, erreurs E-055, preuves, limites.
