# Vérification locale — 031

2 octobre 2026 ; branche `codex/031-css-system`, base Slopo `b782a106`.
Guide : [ui-system.md](../../docs/design/ui-system.md). Revue avec ui-quality et
lessons.md (L-001…018), sans ajout de leçon non validée par le propriétaire.

## Périmètre et méthode

Inventaire de toutes les feuilles applicatives, comparaison des règles puis des
styles calculés dans Chrome. Composants réels sur fixtures locales : titres,
table, Kanban, navigation, rangées de réglages, contrôles et overlays partagés.
Deux thèmes, 1280 et 320 px, texte long et états interactifs. Aucune donnée du
workspace, requête métier ou mutation du stockage du propriétaire.

Les captures de [references/](references/README.md) viennent du propriétaire ;
elles guident les décisions, les captures suivantes montrent notre réalisation.
Les fichiers image sont des JPEG `.jpg`, sauf les références PNG du propriétaire.

## US1 — Propriétaires et cascade

- Avant : **14 feuilles / 11 447 lignes**, `global.css` 4 043 lignes et
  `workspace.css` 2 873 lignes. Après : **27 feuilles / 11 806 lignes** ;
  `global.css` est un manifeste de 27 lignes, sans règle de feature.
- Extraction mécanique initiale : **1 486 règles**, aucune règle/déclaration
  ajoutée ou supprimée par déplacement (multiset sélecteur + conditions + valeurs).
- Après extraction, **0 différence de styles calculés** : 69 éléments ×
  quatre thèmes/largeurs = **276 éléments**, 17 propriétés comparées chacun.
- Bases, shell et sécurité possèdent chacun leur feuille ; seuls quatre doublons
  de déclarations déjà écrasées ont été retirés des règles de sécurité réunies.
- 573 consommations d’aliases CSS remplacées par leur cible canonique exacte.
  Aliases publics conservés pour les consommateurs existants. Aucune couleur
  littérale de thème ne reste hors de `tokens.css`. Les 13 variables non définies
  statiquement proviennent des composants/Ariakit/Shiki ; liste et inventaire
  dans [inventory.json](assets/inventory.json), explication dans le guide.

| Comparaison de référence | Avant | Après |
| --- | --- | --- |
| Clair 1280 | [capture](assets/reference-before-light-1280.jpg) | [capture](assets/reference-after-light-1280.jpg) |
| Clair 320 | [capture](assets/reference-before-light-320.jpg) | [capture](assets/reference-after-light-320.jpg) |
| Sombre 1280 | [capture](assets/reference-before-dark-1280.jpg) | [capture](assets/reference-after-dark-1280.jpg) |
| Sombre 320 | [capture](assets/reference-before-dark-320.jpg) | [capture](assets/reference-after-dark-320.jpg) |

## US2 — Préservation et différences intentionnelles

La comparaison après standardisation, avant l’ajout du sélecteur de couleurs,
des mêmes éléments comporte **180 différences** :
112 concernent uniquement géométrie/alignement des boutons et de leur libellé ;
68 concernent couleurs/bordures/outlines. Aucune autre géométrie n’a changé dans
ces échantillons. [Différences détaillées](assets/measures-differences.json).
Cette mesure n’inclut pas les compositions ajoutées ensuite, revues ci-dessous.

| Décision | Preuve et résultat |
| --- | --- |
| Icône + libellé horizontaux dans Button | Le libellé flex avec gap 8 px corrige la pile verticale historique ; overrides de navigation/recherche conservés |
| Accents plus saturés | Bleu repos RGB 68/129/216, hover sombre 85/146/230, texte blanc ; dimensions identiques au survol, 151,97 × 44 px pour l’exemple : [mesures](assets/final-control-states.json) |
| Palette des options préservée | [54 définitions comparées, toutes inchangées](assets/property-palette.json) |
| Focus clavier discret | Tab place le focus sur « Action secondaire » : contour neutre 1 px, shadow none ; [capture](assets/lab-focus-dark-320.jpg) et mesures des contrôles |
| Suppression sobre | Vrai ConfirmDialog, texte/bordure RGB 213/108/94 sur fond transparent : [320 px](assets/lab-confirm-dark-320.jpg) |
| Menu normal puis rouge à l’interaction | [Repos](assets/lab-menu-rest-dark-320.jpg), [survol](assets/lab-menu-hover-dark-320.jpg), [mesures](assets/menu-states.json) ; aucun changement de dimensions |
| Informations et vide neutres | Tous les Status communs transparents avec texte principal : [mesures](assets/quiet-states.json), [état vide](assets/lab-empty-light-320.jpg) |
| Placeholder de table stable | Cadre 128 px, bouton 99,39 × 32 px, section suivante au même emplacement dans les états contenu/attente/restauré : [mesures](assets/loading-geometry.json), [clair mobile](assets/lab-loading-320.jpg), [sombre mobile](assets/lab-loading-dark-320.jpg), [desktop](assets/lab-loading-dark-1280.jpg). Annonce busy conservée |
| Kanban contenu dans sa surface | Le parent libérait son overflow : [avant](assets/lab-board-before-1280.jpg). Exclusion du scrollport, contexte relatif pour labels masqués et piste de carte bornée : [desktop](assets/lab-board-dark-1280.jpg), [mobile](assets/lab-board-dark-320.jpg), [mesures](assets/board-mobile.json). À 320 px, document 320, scrollport 254 pour contenu 1124 ; cartes 249,20 px et titre long à la ligne |
| Erreur native près de la saisie | Textarea vide conservé, aria-invalid et description associés : [capture](assets/lab-error-dark-320.jpg) |

La revue à zoom équivalent utilise **640 px CSS / DPR 2**, correspondant à
l’espace CSS d’une fenêtre 1280 px à 200 % : document 640 px, actions et fermeture
accessibles, [capture](assets/lab-confirm-200-equivalent.jpg). Ce n’est pas une
mesure du zoom natif de tous les navigateurs. Préférence d’animations réduites
émulée : placeholders statiques, spinner partagé sans animation (corrigé dans
la primitive car la règle universelle historique perdait à la spécificité).

## US3 — Recettes et interactions réelles

Le guide indique toutes les feuilles, le chargement effectif, les API exportées,
les exclusions de compatibilité native et les exceptions de géométrie. Il est
relié depuis AGENTS, le skill maintenu, développement et le contrat 017.
Les compositions du lab utilisent les vrais composants avec état en mémoire.
Menus, popover, dialogue et tiroir sont interactifs sans prop `overlay` ; le mode
explicite reste déterministe. Ouverture clavier, Escape et retour au déclencheur
vérifiés dans le navigateur : [observations](assets/keyboard.json). Le vrai
ConfirmDialog supplémentaire propose annulation, suppression locale et reprise.

Le sélecteur de couleurs ajouté à la demande du propriétaire conserve les neuf
échantillons existants. Neuf boutons de 44 × 44 px utilisent leur fond `-soft`,
un contour et un point de même couleur. Dans les quatre thèmes/largeurs,
le centre du point coïncide avec celui du bouton (écart mesuré 0 px), sans
débordement de page. Choix Rouge par Entrée, nom affiché et un seul choix actif.
[Mesures](assets/color-picker.json), [sombre desktop](assets/color-picker-dark-1280.jpg),
[sombre mobile](assets/color-picker-dark-320.jpg),
[clair desktop](assets/color-picker-light-1280.jpg),
[clair mobile](assets/color-picker-light-320.jpg). Aucune nouvelle couleur créée.

| Lab complet | Capture |
| --- | --- |
| Sombre desktop | [1280 px](assets/lab-dark-1280.jpg) |
| Sombre mobile | [320 px](assets/lab-dark-320.jpg) |
| Clair desktop | [1280 px](assets/lab-light-1280.jpg) |
| Clair mobile | [320 px](assets/lab-light-320.jpg) |

## Contrôles exécutés

| Contrôle | Résultat |
| --- | --- |
| Vitest Web complet, maxWorkers=1, avant ajout du sélecteur | **117 fichiers / 770 tests réussis** |
| Reprise ciblée ui-lab + ui-primitives après ajout du sélecteur | **24 tests réussis** ; choix local de couleur, overlays, annulation/suppression locale, attente/restauration, aucune requête ni écriture propriétaire |
| `bun run typecheck` | Réussi, tous les workspaces + projet racine |
| `bun run toolchain:check` | Réussi, Bun 1.4.2 épinglé |
| `bun run --filter @myownnotion/web build` | Réussi, 23 outputs, 16 assets précachés |
| Biome sur les 33 sources/tests/styles modifiés | Réussi, **0 erreur**, 91 warnings (81 de spécificité, 10 `!important` historiques). Pas de suppressions ; ordre conservé pour préserver la cascade |
| `git diff --check` | Réussi |

Le diagnostic étendu à tout `apps/web/src` retrouve **six erreurs préexistantes**
dans des fichiers inchangés depuis la base de ce travail : format de
`blocknote-conversion.ts`, `editor-menus/slash-menu.tsx`, `page-outline.tsx` ;
imports de `blocknote-schema.ts` et `page-editor.tsx` ; interaction statique dans
`custom-blocks/embedded-database-block.tsx`. Aucun de ces fichiers n’est modifié
par 031. Ce contrôle étendu n’est donc pas annoncé vert.

## Limites et prochaine validation

- Revue locale Chrome de composants réels sur fixtures ; les pages privées,
  tous les écrans d’auth/sécurité et les node views BlockNote complets n’ont pas
  été parcourus de bout en bout. Le déplacement mécanique est contrôlé ; il ne
  remplace pas une revue exhaustive de tous leurs scénarios.
- Le placeholder commun fournit une forme neutre. Le maintien exact de hauteur
  d’un contenu variable exige un cadre adapté par sa feature ; la preuve de
  stabilité ci-dessus porte sur la table du lab, pas sur tout chargement possible.
- **E2E différés à la demande explicite du propriétaire**. Aucun push, merge,
  publication ni validation de release. `checks:local` complet, dont E2E et
  résolution des diagnostics existants, reste requis avant un futur push.
- Instance de revue maintenue sur `http://localhost:5177/__ui-lab` ; fixtures
  temporaires de mesure retirées. Revue du propriétaire à suivre.

## Convergence Spec Kit

FR-001…009, les neuf critères d’acceptation et les trois stories contrôlés contre
code, plan et contrats. Les décisions d’architecture respectent les huit
principes constitutionnels dans ce périmètre local ; exception E2E et absence de
release explicites ci-dessus. Aucune tâche d’implémentation ni divergence UI
matérielle restante dans le périmètre 031. Les limites de revue exhaustive et
les diagnostics préexistants restent visibles, sans créer de phase de
convergence vide. Commit CSS à conserver séparé du commit Slopo.
