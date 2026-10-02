# Vérification — Uniformité Web

## Instance et séparation des travaux

- Socle CSS : `e07f0ca3`, après audit Slopo `b782a106` ; passe suivante sur
  `codex/032-ui-uniformity`.
- Stack reconstruite `myownnotion-ui-dev`, quatre services sains ; API en
  watch, Vite HMR, sources `apps/` montées depuis ce checkout.
- Ancienne stack arrêtée sans suppression de volumes. Sa démo échouait au
  contrôle d’intégrité de migration ; le contrôle est conservé. Nouveau
  workspace synthétique : 240 éléments, 243 relations, 40 tâches dans une base.
- Application : http://localhost:8080/notes ; laboratoire :
  http://localhost:8080/__ui-lab ; mot de passe public `knowledge-graph-demo`.
  Connexion via « Utiliser le mot de passe » réussie dans le navigateur local.
- HTTPS https://localhost:8443 reste disponible avec la CA locale précédente.
  Le fichier Compose de partage de CA sous `work/` est local et ignoré.

## Analyse des artefacts avant corrections

FR-001/002 → T001/004/005 ; FR-003 → T003/009/014/015 ;
FR-004/005 → T006/007/008/009/011/012 ; FR-006 → T008/010/012 ;
FR-007 → T012/014/015 ; FR-008 → T016/017/018.
Les huit exigences sont couvertes ; pas de contradiction matérielle entre
spec, plan et tâches. Les E2E/gates de publication sont explicitement différés
par Enzo, sans déclaration de conformité release ni push.

## Inventaire et revue

Chaque ligne est une famille de composants, pas une promesse de revue de toutes
les combinaisons possibles d’états. Les préfixes désignent les captures sous
`assets/`, avec suffixes `light/dark` et `1280/320`, sauf limite explicite.
Les états sensibles restent des exemples locaux ou une revue de leurs sources.

| Famille / propriétaire | Observation initiale | Résultat / preuve |
| --- | --- | --- |
| Primitives, compatibilité, laboratoire | Deux définitions de select ; contrôles historiques peints séparément | Corrigé : alias de select unique, typo/rayon/hover natifs alignés ; `lab`, `lab-dark-full.jpg`, `kanban-after` ; `lab-before.jpg` conservé |
| Authentification / `auth.css` | Large formulaire et carte imbriquée ; géométrie boutons spécifique | Corrigé : formulaire 28 rem, sections transparentes, champs/actions communs ; `login`, `login-error` ; `login-before.jpg` |
| Première installation / `auth.css` | Styles auth partagés ; parcours sensible | Corrigé via styles partagés ; vraie `BootstrapPage` sur fixture locale : `setup` ; installation non exécutée |
| Connexion desktop / `auth.css` | Gouttières absentes à 320 px | Corrigé : même largeur/gouttières que la connexion ; vraie page sans bridge : `connection` ; profil natif non modifié |
| Workspace, dossiers, onglets / `workspace.css` | Accueil et navigation sobres | Cohérent : densités et onglets conservés ; `folder`, `page`, `database` ; accueil initial `workspace-before-1280.jpg` |
| Navigation / `navigation.css` | Densité secondaire, actions compactes nécessaires | Exception justifiée : cibles optiques de l’arbre conservées ; `folder`, `page`, `navigation-drawer-*-320.jpg` |
| Pages, éditeur, tableaux / `editor*.css` | Exceptions BlockNote et scroll de données | Exception justifiée : gouttière de chrome BlockNote et colonne de lecture conservées ; `page` ; tableaux éditoriaux non modifiés dans cette passe, références 031 conservées |
| Bases, vues et propriétés / `database.css` | Palette de contenu cohérente ; carte Kanban avec bouton imbriqué et actions textuelles tronquées | Table/paramètres conservés : `database`, `database-settings` ; Kanban corrigé : titre ghost, select compact et flèches nommées sur une ligne, `kanban-after` ; `kanban` représente l’état antérieur |
| Recherche / `search.css` | Select sans classe explicite ; titres longs chevauchant le type à 320 px | Corrigé : select partagé, titre flexible et chemins multilignes ; `search` avec résultats réels ; focus/Échap revus |
| Graphe / `knowledge-graph.css` | Canvas et contrôles dédiés | Exception justifiée : géométrie canvas/pan/zoom conservée ; `graph`, `graph-filters` ; panneau défilant localement |
| Fichiers, attachements / `files.css` | Liste de stockage réutilisait le chrome de navigation | Corrigé : liste de stockage dédiée, select explicite ; `storage` aux deux largeurs ; aperçu non pris en charge cohérent sur desktop, `file-dark-1280.jpg` ; aperçu mobile non attesté |
| Réglages / `settings.css` | Cartes imbriquées, titre appareil doublé, bouton étiré ; détails techniques serrés | Corrigé : sections plates, titre unique, boutons à largeur utile, espacement identité/historique ; `storage`, `page-details`, `trash` |
| Sécurité / `settings-security.css`, `mcp-access-panel.css` | Boutons 28 px / 12 px ; variantes primary/danger écrasées | Corrigé : variantes rétablies, cibles 32 px / tactile 44 px ; `security` ; captures antérieures `security-before*` |
| Sauvegardes / `backup.css` | Sections et détails, focus de summary spécifique | Cohérent ; focus summary neutre aligné ; `backups` ; aucune sauvegarde/restauration déclenchée |
| Corbeille / `settings.css` | Rangées carte de récupération | Corrigé : rangées plates, action identifiable ; `trash` sur entrée synthétique récupérable, sans restauration |
| Sauvegarde locale, synchronisation, conflits, historique / `workspace.css`, `save-state.css`, `reconciliation.css` | Informations techniques secondaires ; états métier rares | Cohérent sur état synchronisé (`page`) et formulaire d’historique (`page-details`) ; overlays/états communs (`confirmation`, laboratoire). Parcours conflit/réconciliation non exercés ; indicateurs `save-state` hérités non montés par le workspace courant, conservés hors refonte |

## Exceptions conservées

- L’arbre, les titres éditables, la grille et le chrome d’éditeur gardent leurs
  cibles optiques de domaine. Ne pas leur appliquer la hauteur d’un formulaire.
- Une sélection de cellule / destination de déplacement utilise l’accent bleu ;
  elle communique une sélection de données, distincte du focus clavier neutre.
- Tableaux, kanban et canvas peuvent défiler localement ; leur largeur ne doit
  pas agrandir le document.
- Bootstrap garde une largeur supérieure au login pour ses instructions.
- Les réglages Sécurité règlent la densité, jamais la peinture primary/danger.
  Les panneaux historiques ne sont aplatis que dans le document de réglages.

## Contrôles et limites

### Preuves visuelles et interactions

- Captures des deux thèmes et largeurs sous `assets/`. Mesures du viewport et
  du document dans [viewport-metrics.json](assets/viewport-metrics.json) :
  80 observations retenues, aucune largeur de document supérieure au viewport.
  Les familles sont des échantillons représentatifs, pas une matrice exhaustive
  de tous les types de propriétés ou toutes les erreurs métier.
- Comparaison visuelle : contrôles partagés, gouttières, titres, aide,
  séparations, texte long, erreurs, disabled/busy et palette des propriétés.
  `kanban-after` montre le vrai `BoardView`, y compris colonnes vides et titre
  long ; `login-error` montre le vrai formulaire en erreur, sans requête.
- Recherche réelle « produit » : texte saisi, résultats longs, type et chemin
  séparés ; Échap ferme, retour au bouton Rechercher à largeur stable. Après
  passage en mobile, le déclencheur masqué est remplacé par l’accès à la sidebar.
- Confirmation mémoire : focus initial sur Annuler, fermeture par Échap et
  retour à « Supprimer l’exemple » observés ; `confirmation` montre l’action
  rouge sur fond neutre à 320/1280. Menus/popovers/tiroirs communs conservent
  les interactions vérifiées dans la suite `ui-lab` et les références 031.
- Réduction du mouvement activée lors des matrices. Un viewport CSS 640×450,
  facteur de pixel 2 (1280×900 physique), vérifie le reflow du login à une
  densité équivalente au zoom 200 % : `login-zoom-equivalent-200.jpg`.
  Le zoom natif de chaque navigateur n’est pas attesté.
- Émulation tactile : repères des cartes Kanban et select compact vérifiés
  avec `pointer: coarse`, minimum 44 px ; `kanban-coarse-dark-320.jpg` et
  [touch-metrics.json](assets/touch-metrics.json). Les anciennes règles de
  hauteur du formulaire Sécurité ont été retirées pour laisser ces cibles
  communes s’appliquer.
- Dimensions et thème forcés remis à leur valeur normale après la revue.

### Contrôles exécutés

- Bun 1.4.2 ; typage Web réussi ; build Web final réussi (23 outputs,
  16 assets précachés).
- Vitest Web ciblé : 51 tests dans 7 fichiers, puis 44 tests dans 6 fichiers
  (recouvrement `ui-lab`/`ui-lab-auth`, soit 81 tests distincts dans 11 fichiers).
  Nouvelle vérification après les derniers changements : 24 tests dans
  `ui-lab`, `ui-lab-auth`, `database-board`, `database-page-interaction` ;
  `app-routing` également vérifié après l’espacement des détails de page.
- Contrats workspace `compose-dev` / `bun-toolchain` : 16 tests réussis.
- Biome ciblé sur les fichiers TS/TSX modifiés réussi ; `git diff --check`
  réussi. Biome sur les feuilles CSS modifiées réussit avec avertissements de
  spécificité et `!important` hérités ou liés à la cascade conservée. Les erreurs
  de lint global préexistantes à 031 ne constituent pas
  une validation du lint global ; il n’est pas annoncé comme réussi ici.
- Image dev reconstruite ; migration du nouveau workspace terminée ; services
  sains et sources montées. Aucune migration ou règle d’intégrité modifiée.

### Limites de cette livraison

Aucune campagne E2E, aucun `checks:local` complet et aucun push. Les gates de
publication restent requis avant push. Aucun parcours de rotation, révocation,
restauration, suppression, export ou cérémonie passkey exécuté pour une capture.
Les effets des previews d’authentification s’arrêtent avant réseau/stockage ; le
renderer desktop est observé dans le navigateur, sans refonte du client natif.
Les données ajoutées par le propriétaire après la création de la démo sont
conservées. Certaines aides de stockage héritées du client-core restent en
anglais ; leur traduction est hors de cette passe CSS.

## Bilan des exigences

FR-001/002 et SC-001 : commits antérieurs, nouvelle instance observable.
FR-003/004/005/006 et SC-002/004 : inventaire explicite, corrections dans leurs
propriétaires, vrais composants en exemple, exceptions et états non exercés
documentés. FR-007 et SC-003/005 : deux thèmes, largeur 320, scroll local,
clavier et contrôles ciblés. FR-008 : preuves, limites et guide maintenus.
La convergence porte sur cette harmonisation Web représentative ; elle ne
déclare ni parité exhaustive Notion, ni validation release de tous les parcours.
Revue Spec Kit finale : huit FR, cinq SC, huit scénarios d’acceptation, décisions
du plan et huit principes de constitution contrôlés ; aucun écart matériel
restant dans ce périmètre. Les 18 tâches sont réalisées ; aucune tâche de
convergence supplémentaire nécessaire.
