# Leçons UI/UX MyOwnNotion

Journal append-only. Les agents **lisent ce fichier** avec `SKILL.md` avant
toute conception, implémentation ou revue UI/UX. N’écrire une leçon qu’après
validation explicite du propriétaire (correction vue ensemble).

## Comment capitaliser

1. Constater un défaut sur une surface réelle (navigateur local ou preuve visuelle).
2. Corriger avec le propriétaire.
3. Extraire une règle réutilisable (pas un cas isolé).
4. Ajouter une entrée `L-NNN` ici.
5. Si la règle est stable et générale, la remonter aussi dans `SKILL.md`.

## Format

```markdown
### L-NNN — titre court
- Statut : validée | candidate
- Surface : chemin ou composant
- Anti-pattern : ce que l’agent a fait / ferait
- Règle : ce qu’il doit faire à la place
- Preuve : token, primitive ou écran de référence
```

## Entrées

### L-001 — Outils de sidebar : même rangée visuelle
- Statut : validée
- Surface : `apps/web/src/features/navigation/sidebar.tsx` (`Rechercher`, `Graphe`)
- Anti-pattern : ajouter un bouton d’outil sans les styles de rangée (`width: 100%`,
  `justify-content: flex-start`, `.ui-button__label` en flex horizontal). Résultat :
  icône au-dessus du texte, contenu centré, outil orphelin sans rôle clair.
- Règle : tout outil de la navigation (recherche, graphe, futurs) partage le même
  pattern de rangée que `workspace-navigation__search`. Un nouvel outil s’ajoute
  aux sélecteurs CSS communs, pas comme un bouton « libre ».
- Preuve : `.workspace-navigation__search` / `__graph` dans `navigation.css`.

### L-002 — Actions de ligne d’arbre : révélation puis chrome
- Statut : validée
- Surface : `.navigation-item-actions` (trombone, `+`, menu)
- Anti-pattern : pastilles remplies dès le survol de la ligne ; ou icônes invisibles
  sur une ligne non sélectionnée ; ou `color-mix` avec la couleur du texte (voile
  blanc en thème sombre).
- Règle :
  1. Survol / focus-within de la **ligne** → icônes visibles, même traitement
     sélectionnée ou non, **sans** fond bouton.
  2. Survol / focus du **contrôle** (ou état ouvert) → pastille `surface-raised`.
  3. Fermer le `+` et blurrer le focus quand le pointeur quitte la `.tree-row`,
     sinon `:focus-within` garde les actions affichées.
- Preuve : bloc `@media (pointer: fine)` + `pointerleave` dans
  `navigation-inline-create.tsx`.

### L-003 — Contraste des surfaces imbriquées au hover
- Statut : validée
- Surface : `.navigation-inline-create[data-open="true"]` sur une ligne hover
- Anti-pattern : donner au panneau ouvert le même token que le fond de ligne
  (`surface-hover` / `surface-subtle`) → plus aucune séparation visuelle.
- Règle : une surface ouverte ou un chrome de contrôle doit utiliser un cran
  distinct du fond de la rangée (ex. panneau `surface-raised`, choix
  `surface-active`). Vérifier **ligne non sélectionnée + hover**, pas seulement
  la sélection.
- Preuve : fond `__surface` ouvert = `var(--ui-color-surface-raised)`.

### L-004 — La sidebar est secondaire au contenu
- Statut : validée
- Surface : `.workspace-navigation` / `.workspace-sidebar-panel`
- Anti-pattern : typo sidebar en `text-sm` gras, séparateur plein
  `1px solid var(--color-border)`, rangées ~38 px — la nav rivalise avec la page.
- Règle : la page est la surface principale. Sidebar = texte `text-xs` muted,
  graisse légère, rangées compactes, séparateur hairline
  (`color-mix` ~40 % du border). Seule la ligne sélectionnée remonte en texte
  plein. Référence d’intention : densité discrète type Obsidian, pas un second
  éditeur.
- Preuve : variables `--tree-row-min-height`, border-right mixé, `font-size` nav.

### L-005 — Compacter une rangée = redimensionner ses contrôles
- Statut : validée
- Surface : actions dans `.tree-row`
- Anti-pattern : baisser `min-height` de la ligne tout en laissant les boutons à
  `--ui-target-compact` (32 px dans 30 px) → contrôles collés haut/bas.
- Règle : toute réduction de hauteur de rangée définit une taille d’action liée
  (`--tree-action-size` < hauteur de ligne, avec respiration). Mettre à jour
  menu, pièces jointes, inline-create et overrides square ensemble. Le panneau
  **ouvert** du `+` : les chips doivent laisser voir l’icône entière, y compris
  le `+` tourné en `×` (diagonale ≈ côté×√2) — padding 0, taille de chip
  suffisante, gouttières explicites ; hauteur de surface =
  `button + 2×gutter` encore ≤ hauteur de rangée. Ne pas coller la chip ouverte
  sur `--tree-action-size` si cela écrase les icônes.
  Le tactile (`pointer: coarse`) peut rester à la cible confortable.
- Preuve : open `--inline-create-button: 1.25rem`, icônes `0.75rem`, gutter `3px`.

### L-006 — Itérer sur le rendu réel, pas sur une théorie de chrome
- Statut : validée
- Surface : atelier UI/UX avec le propriétaire
- Anti-pattern : enchaîner des « pastilles intelligentes » (mix texte, fonds
  partout) sans revoir le navigateur ; déclarer OK sans validation visuelle.
- Règle : proposer → faire valider → corriger sur l’instance locale → capitaliser
  ici. Un fix qui résout la lisibilité mais casse le rythme (blanc, gaps, chrome
  trop tôt) est un échec jusqu’à la passe suivante.
- Preuve : ce journal ; boucle atelier dans `SKILL.md`.

### L-007 — Panneaux imbriqués dans l’arbre suivent la densité sidebar
- Statut : validée
- Surface : `.workspace-attachment-panel` sous une rangée d’arbre
- Anti-pattern : compacter l’arbre puis laisser le panneau pièces jointes avec
  header 32 px, gros paddings et état vide haut → bloc disproportionné.
- Règle : tout panneau déroulé sous une rangée réutilise `--tree-action-size` /
  `--tree-row-min-height`, typo `text-xs` muted, paddings serrés, séparateur
  hairline. L’état vide ne réserve pas une grande min-height cosmétique.
- Preuve : styles `.workspace-attachment-panel*` dans `navigation.css`.

### L-008 — Sidebar malléable au pixel ; arbre sans plafond d’indentation
- Statut : validée
- Surface : `ResponsiveSidebar` + `.workspace-navigation .tree ul`
- Anti-pattern : largeur bloquée sur une petite plage (ex. 240–360) perçue comme
  des crans ; indentation visuelle arrêtée au 4ᵉ niveau (`ul ul ul`).
- Règle : le drag met à jour la largeur au pixel (pas de grille de positions).
  Plage 200–720 px, encore plafonnée pour laisser ~420 px à la page. Chaque
  niveau de sous-page/dossier décale à droite ; élargir la sidebar pour lire
  les branches profondes.
- Preuve : `MAX_SIDEBAR_WIDTH` / `effectiveSidebarWidth` ; plus de règle
  `.tree ul ul ul` qui annule le décalage.

### L-009 — Une surface, un seul propriétaire CSS
- Statut : validée
- Surface : page Réglages › Sécurité (`security-settings.tsx` et panneaux)
- Anti-pattern : restyler une surface en ajoutant une nouvelle feuille
  (`settings-security.css`) et des blocs dans `settings.css` **sans retirer**
  les règles historiques de `global.css` (`.security-settings form`,
  `.security-settings li`, `.security-settings button`…). Trois couches se
  sont battues à la cascade : `flex-direction: column` hérité + `flex: 1 1 14rem`
  neuf ont donné un champ mot de passe de 224 px de haut, un libellé centré et
  des listes MCP/rotation transformées en cartes.
- Règle : avant de restyler, `rg` toutes les règles qui touchent la surface
  (classe racine, classes de panneaux, `ul/li/form/button` descendants) et
  décider d'un **seul** propriétaire. Supprimer ou re-scoper le reste dans la
  même passe ; les sélecteurs génériques (`.x li`, `.x form`, `.x button`)
  sont interdits sur une surface composée de plusieurs panneaux. Laisser un
  commentaire de propriété à l'endroit où les anciennes règles vivaient.
- Preuve : bloc « Sécurité et appareils » en fin de `settings.css` +
  `settings-security.css` ; `global.css` ne contient plus `.security-settings`.

### L-010 — Un fix CSS se vérifie sur l'écran, pas sur la maquette mentale
- Statut : validée
- Surface : même atelier (Connexion cassée livrée comme « mieux organisée »)
- Anti-pattern : livrer une refonte visuelle en s'appuyant sur `tsc` + tests
  jsdom et un raisonnement sur les règles écrites, sans ouvrir la page.
  jsdom ne calcule pas la cascade ; les tests passaient sur un rendu cassé.
- Règle : toute passe qui touche du CSS se termine par une capture de la
  surface réelle (stack locale : mot de passe propriétaire ou fixture démo).
  Si l'accès manque, le dire explicitement et **ne pas** annoncer le résultat
  comme vérifié. Inspecter au besoin `getComputedStyle` de l'élément fautif
  (display / flex / width / height) pour localiser la règle gagnante.
- Preuve : captures `/settings/security` avant/après dans cet atelier.

### L-011 — Un panneau flottant avec contrôles continus a une largeur fixe
- Statut : validée
- Surface : popover « i » du graphe (`.knowledge-graph__status-panel`, sliders)
- Anti-pattern : popover en largeur intrinsèque (`min/max-width`) contenant
  des sliders et des valeurs numériques. La valeur « 0.5 » → « 0.55 » et le
  texte de couverture changeaient la largeur ; ancré à droite, le panneau se
  déplaçait sous le pointeur pendant le drag → curseur qui « ne suit pas »,
  panneau qui « change de taille aléatoirement ».
- Règle : un overlay qui héberge range/slider, stepper ou texte qui change
  pendant l'interaction reçoit `width` fixe (`min(Xrem, 100vw - marge)`), et
  ses colonnes de valeur une `min-width` en `ch` avec `tabular-nums`. Rien de
  ce qui est sous le pointeur ne doit dépendre de la longueur du contenu.
- Preuve : `.knowledge-graph__status-panel { width: min(20rem, …) }`,
  `.knowledge-graph-forces__value { min-width: 4ch }`.

### L-012 — Chrome éditeur : état hors du DOM ProseMirror
- Statut : validée
- Surface : tableaux BlockNote (`custom-blocks/table.tsx`, `table-ui-state.ts`)
- Anti-pattern : poser des `data-*` / classes de survol sur `.bn-block` ou muter
  le DOM d’un nœud ProseMirror hors de notre node-view. Le `DOMObserver`
  re-rend → remount React → boucle CPU/RAM (observé ~11 Go).
- Règle : hover, layout, brouillon de resize et tout état UI partagé vivent dans
  un store externe (`useSyncExternalStore`). Les pistes de colonnes passent par
  un `<style>` **dans** le node-view, ciblé par l’`data-id` déjà posé par
  BlockNote. Un seul `:has()` direct sur le bloc tableau ; jamais de `:has()`
  par cellule. Menus dans le node-view : `popover` natif (top layer), pas de
  portal Ariakit.
- Preuve : `docs/design/affine-table-ui.md` § Architecture ; `table-ui-state.ts`.

### L-013 — Poignées révélées = forme nue ; chrome au survol du contrôle
- Statut : validée
- Surface : `⋯` ligne/colonne (`.editor-table-handle`) — même logique que `L-002`
- Anti-pattern : pastille remplie dès que la ligne/colonne est survolée
  (`data-active`) → chrome trop tôt, bruit visuel sur toute la grille.
- Règle :
  1. Survol de la **ligne/colonne** → poignée visible, **sans** fond (juste les
     points / l’icône).
  2. Survol / focus / menu ouvert / drag de la **poignée** → pastille
     (`surface-active`) et contraste texte.
- Preuve : `.editor-table-handle` transparent par défaut ; fond seulement sur
  `:hover` / `[aria-expanded]` / `[data-dragging]`.

### L-014 — Séparateur / rail : hit-area pleine, mise en avant sur tout l’axe
- Statut : validée
- Surface : rails `+` et resize de colonnes (`.editor-table-rail`, `.editor-table-resize`)
- Anti-pattern : (1) lier le hover fort du rail à la dernière cellule
  (`data-active` sur le rail) → faux survol bleu quand on parcourt le tableau ;
  (2) n’allumer que le trait de la cellule sous le pointeur au resize → la
  colonne n’est pas lue comme un axe.
- Règle : la zone cliquable peut couvrir toute la gouttière, mais le chrome fort
  (`:hover` / accent) ne s’allume que quand le pointeur est **sur** le contrôle.
  Pour un séparateur d’axe (colonne), un état partagé highlight **toutes** les
  cellules de cet axe sur toute la hauteur (pas seulement la case survolée).
- Preuve : rails sans `data-active` de cellule ; `setTableColumnResizeHover` +
  `data-highlight` sur chaque `.editor-table-resize` de la colonne.

### L-015 — Tableau large : scrollport aligné au texte, au-dessus du fond
- Statut : validée
- Surface : `.bn-block-outer:has(> .bn-block > .node-table)` dans `editor-table.css`
- Anti-pattern : `width: 100%` qui casse la grille ; ou breakout sans padding →
  au `scrollLeft = 0` le tableau part sous le canvas / hors de l’alignement du
  paragraphe ; ou `overflow` qui clippe sous le fond pointillé.
- Règle : le scroll horizontal vit sur un scrollport pleine largeur du main
  (`100cqi` + gouttière), avec `padding-inline-start` égal à la gouttière pour
  que le repos aligne la grille au texte de lecture. `z-index` au-dessus du
  fond canvas. Cellules transparentes (pas de carte opaque qui « coupe » le fond).
- Preuve : `--editor-table-gutter-start` + `padding-inline-start` ;
  `docs/design/affine-table-ui.md`.

### L-016 — Coins de menu : overflow + radius sur la surface peinte
- Statut : validée
- Surface : `.ui-menu` / `.ui-popover` (`primitives.css`) ; menus tableau natifs
- Anti-pattern : `border-radius` seulement sur le positioner / wrapper, contenu
  opaque aux coins → coins « carrés » visibles sous le rayon.
- Règle : `overflow: hidden` (ou clip) **et** `border-radius` sur l’élément qui
  peint le fond du menu. Vérifier coins haut-gauche/droit à l’échelle réelle.
- Preuve : règles `.ui-menu` / `.ui-popover` ; `.editor-table-menu`.

### L-017 — Drag de chrome : preview locale, une seule persistance au pointerup
- Statut : validée
- Surface : resize de colonnes (et même esprit pour drag `⋯` ligne/colonne)
- Anti-pattern : écrire `columnsJson` / une commande opérationnelle à chaque
  `pointermove` → thrash CRDT, undo saturé, flash de layout.
- Règle : pendant le geste, un brouillon UI (store externe ou style scoped) met
  à jour le rendu ; au `pointerup` / `pointercancel` (ou Échap pour annuler),
  **une** mutation persistée. Pendant le drag, le curseur et le highlight
  restent cohérents même si le pointeur quitte la hit-area (pointer capture).
- Preuve : `setTableColumnWidthDraft` puis `resizeColumn` au finish ;
  `set-table-column-width` côté page-state.

### L-018 — Le tiroir mobile possède son propre état d’ouverture
- Statut : validée
- Surface : `ResponsiveSidebar`, arbre de navigation et passage bureau → 320 px
- Anti-pattern : masquer l’arbre du tiroir avec l’état de la barre latérale de
  bureau, ou tester un ancien rail encore visible pendant le redimensionnement.
- Règle : la visibilité de l’arbre suit aussi l’ouverture du tiroir mobile ;
  stabiliser l’écoute du redimensionnement et attendre le mode mobile avant
  d’agir sur l’arbre. Une ligne très profonde garde son menu contextuel au
  clavier sans réafficher un bouton compacté hors du tiroir.
- Preuve : `tests/e2e/workspace-tabs-folder.spec.ts`, répété sur Chromium et
  WebKit mobiles à 320 px ; `specs/022-page-tabs-folder-view/validation.md`.

### L-019 — Virtualisation : observer le vrai défilement et conserver son étendue
- Statut : validée
- Surface : tableaux dans un flux de page, widgets bornés et onglets masqués.
- Anti-pattern : observer le conteneur horizontal non borné alors que son
  ancêtre possède le défilement vertical ; laisser les retraits de rangées
  réduire provisoirement la hauteur et ramener WebKit en haut.
- Règle : mesurer le scrollport réel et l’origine du contenu dans celui-ci,
  conserver l’étendue calculée pendant les remplacements DOM et ignorer les
  surfaces masquées. Un widget qui apparaît ne déplace pas l’ancre de la page.
- Preuve : `use-table-viewport.ts`, tests de géométrie/lifecycle et retour après
  1 001 lignes avec DOM borné, focus et visibilité intégrale sur les cinq profils ;
  `specs/033-app-ui-review/verification.md`, T055 et captures clair/sombre.

### L-020 — Retour du focus : une intention survit aux actualisations
- Statut : validée
- Surface : retour d’entrée, projections asynchrones et saisie suivante.
- Anti-pattern : recréer une tentative de retour après chaque passage loading
  puis ready ; elle oublie que le propriétaire a commencé un nouveau brouillon
  et le ferme en reprenant le focus.
- Règle : conserver le cycle d’une demande et ses cibles pendant les reprises,
  terminer une seule fois dès qu’un autre contrôle prend volontairement le
  focus, et distinguer une nouvelle demande explicitement réémise. Tester aussi
  une saisie commencée avant la première disponibilité de la cible.
- Preuve : test unitaire rouge/vert et créations consécutives répétées sur les
  cinq profils ; `specs/033-app-ui-review/verification.md`, T057.


### L-021 — Une couleur d'accent ne garantit pas le contraste d'un texte
- Statut : validée
- Surface : avis conditionnels, résumés fermés et panneaux ouverts.
- Anti-pattern : placer le rouge d'accent sur un fond teinté en supposant que
  la paire reste lisible dans les deux thèmes ; n'auditer que l'état ouvert.
- Règle : choisir les rôles sémantiques de texte et de surface ensemble,
  vérifier les états fermé/ouvert avec une vraie condition métier, aux deux
  thèmes et dans le runtime natif. Un canvas neutre peut conserver l'accent
  et sa bordure sans modifier la palette ni masquer l'avertissement.
- Preuve : audit rouge/vert, cinq profils navigateur, audit Electron clair/sombre
  et captures réelles ; `specs/033-app-ui-review/verification.md`, T059.

### L-022 — Réserver la cible réelle d'un contrôle dans l'en-tête mobile
- Statut : validée
- Surface : ouverture du tiroir, accueil et en-têtes compacts.
- Anti-pattern : réserver seulement la taille dessinée de l'icône, ou calculer
  le gutter mobile avec l'état de la sidebar desktop ; le bouton recouvre le texte.
- Règle : conserver l'espace de la zone cliquable effective et son espacement
  dans chaque état mobile, même derrière le tiroir. Contrôler à 320 px que
  les boîtes du bouton et des textes ne se recouvrent pas, puis l'ouverture,
  la fermeture et le retour du focus ; ne pas réduire la cible pour faire tenir.
- Preuve : géométrie rouge/verte, cinq profils, références et onglets mobiles,
  captures clair/sombre ; `specs/033-app-ui-review/verification.md`, T060.


### L-023 — Une preview de dépôt partage une destination réelle avec l'action
- Statut : validée
- Surface : glisser de blocs, bords de lecture et éditeurs conservés dans des onglets.
- Anti-pattern : déduire toute la destination d'une position de caret fournie
  par le moteur ; un trait bleu peut alors désigner le bloc suivant ou une
  limite de groupe que l'action ne sait pas résoudre.
- Règle : privilégier la géométrie du bloc survolé de l'éditeur actif, normaliser
  ses limites vers une destination atomique valide et partager cette position
  entre preview et dépôt. Refuser une preview sans action possible. Contrôler
  l'alignement vertical, l'absence d'écriture avant dépôt, la persistance et
  l'annulation avec des gestes natifs, y compris à largeur étroite.
- Preuve : diagnostic de caret différent du pointeur, tests unitaires rouge/vert,
  30 parcours sur cinq profils puis dix parcours sombres à 320 px, captures
  réelles ; `specs/033-app-ui-review/verification.md`, T061.

### L-024 — Un contrôle sur une surface teintée reprend son contexte
- Statut : validée
- Surface : sélecteur inline dans une carte teintée.
- Anti-pattern : utiliser un fond sunken neutre très sombre qui forme une
  rupture noire au milieu de la carte, puis un choix actif d'une autre palette.
- Règle : laisser voir le support et dériver le relief actif de sa teinte et
  des rôles du thème. Garder un contour fin, vérifier actif/survol/focus en
  clair et sombre dans le contexte réel, plutôt que sur un fond isolé.
- Preuve : proposition réelle `specs/038-database-card-flow/validation.md`,
  section sélecteur Page/Dossier ; retour propriétaire « C'est beaucoup mieux ».

### L-025 — Une surface vide conserve une étendue de défilement réelle
- Statut : validée
- Surface : en-têtes détachés pilotés par le défilement horizontal du corps.
- Anti-pattern : supposer que la largeur CSS d'une table vide à hauteur nulle
  suffit à créer l'étendue défilante, ou ajouter une fausse ligne pour la créer.
- Règle : garder une géométrie non nulle minimale et ignorée par l'accessibilité
  quand le corps est vide. Vérifier les commandes hors écran au pointeur et au
  clavier, puis le passage au premier contenu, dans les moteurs requis ; une
  hauteur déclarée sur une table vide n'est pas interprétée identiquement partout.
- Preuve : reproduction réelle à 320 px et parcours de composition/synchronisation
  sur cinq profils ; `specs/038-database-card-flow/validation.md`, FR023.


### L-026 — Dériver les surfaces d’une teinte, séparer repère et texte
- Statut : validée par revue manuelle
- Surface : couleurs de contenu, Kanban, badges et sélecteurs partagés.
- Anti-pattern : réutiliser le texte clair d’un badge comme contour de carte,
  puis le même accent mesuré en sombre comme texte sur fond clair.
- Règle : mesurer les rôles de la référence, centraliser une teinte et des
  coefficients communs par thème, distinguer support/carte/badge/contour et
  repère/texte lisible. Le survol dérive le fond sans changer sa teinte ni
  sa géométrie. Vérifier les consommateurs secondaires de la même palette.
- Preuve : mesures réelles Notion, captures clair/sombre, survol avec boîtes
  identiques, focus et 320 px dans `specs/041-content-color-system/validation.md`.
  E2E explicitement différés ; cette leçon ne vaut pas validation multi-moteur.

### L-018 — Menus : une seule identité de survol et d'action destructive
- Statut : validée (demande explicite du propriétaire, 2026-11-05)
- Surface : `.ui-menu__item`, `.bn-menu-item`, menus de base et de navigation
- Anti-pattern : fond de survol opaque différent par menu ; action destructive
  rouge en permanence ou sans fond ; hauteurs/rayons/gaps divergents.
- Règle : hauteur `--ui-menu-item-height`, rayon 6 px, gap 8 px ; survol en
  **voile translucide** `--ui-menu-item-hover-bg` (fonctionne clair/sombre) ;
  action destructive neutre au repos, texte `--ui-color-danger-text` et voile
  `--ui-menu-item-danger-hover-bg` au survol/focus. Une seule source CSS.
- Preuve : `/__ui-lab` section « Menus et actions » ; captures 052.

### L-019 — Un menu ne passe jamais sous le chrome
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menus contextuels, poignée de bloc, popovers de base
- Anti-pattern : décaler un menu vers la gauche sans vérifier la sidebar ; le
  menu est alors partiellement invisible, même si son centre est cliquable.
- Règle : un overlay vit au-dessus du chrome (`--ui-layer-menu`), et son côté
  est choisi selon l'espace réellement disponible ; vérifier l'occlusion avec
  `elementFromPoint` sur plusieurs points, pas seulement au centre. Tester une
  page étroite et une sidebar élargie.
- Preuve : `notion:parity:capture` (section Occlusion), captures 051.

### L-020 — Pas de carré de sélection inutile
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : champs de recherche de menus, menus d'en-tête de colonne
- Anti-pattern : auto-focus sur un champ qui affiche `outline`/`box-shadow` au
  clic, ou sur un `<select>` qui montre un cadre bleu sans action demandée.
- Règle : un champ texte montre le caret et un bord discret, pas un carré de
  focus au clic. Un menu ouvert au clic ne focalise pas un contrôle de type ;
  le survol de la cellule indique la zone active. Le focus clavier reste visible
  (`:focus-visible`), pas au clic souris.
- Preuve : popover de propriété, captures 053.

### L-021 — Action destructive : neutre puis rouge
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menus de bloc, cartes, propriétés, fichiers
- Anti-pattern : rouge permanent, ou fond rouge différent des autres survols.
- Règle : l'item est neutre au repos ; au survol/focus, texte et icône en
  `--ui-color-danger-text`, fond de survol **commun** (voile translucide), pas
  un fond rouge spécifique. Une seule classe/token pour tous les menus.
- Preuve : capture Notion « Déplacer dans la corbeille », menus 051/053.

### L-022 — Les icônes de propriété sont éditables
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : en-tête de colonne, propriétés d'entrée
- Anti-pattern : icône de type figée, non cliquable, ou remplacée par un emoji.
- Règle : l'icône par défaut est un fallback de type ; l'utilisateur peut
  choisir une icône du catalogue interne et la supprimer pour revenir au type.
  Pas d'emoji. Le sélecteur est accessible depuis l'en-tête et le panneau de
  propriété.
- Preuve : `PropertyIconPicker`, capture 053.

### L-023 — Une icône éditable doit ressembler à un bouton
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : en-tête de colonne, liste des propriétés d’une vue
- Anti-pattern : afficher l’icône comme un simple glyphe, sans bord ni survol ;
  l’utilisateur ne devine pas qu’elle ouvre le sélecteur.
- Règle : icône dans un bouton carré de 26–28 px, bord discret, rayon 6 px,
  survol/focus visibles, `aria-label` « Changer l’icône de … ». Le sélecteur
  propose le catalogue interne et « Supprimer » pour revenir au type.
- Preuve : en-tête de colonne et paramètres de vue (capture 053).

### L-024 — Chaque ligne de menu a une icône
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menu de bloc, menus de base, menus de carte
- Anti-pattern : une ligne « Couleur » sans icône, alors que toutes les autres
  en ont une ; le menu paraît inachevé.
- Règle : toute action de menu a une icône Lucide de la même taille que les
  autres ; « Couleur » utilise `palette`. Les actions destructives gardent
  l’icône `delete` et passent en rouge au survol.
- Preuve : menu de bloc 051, capture avec icône palette.

### L-025 — Le survol d’un en-tête remplit exactement la cellule
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : `th` de table de base
- Anti-pattern : bouton interne plus petit que la cellule, avec arrondi, qui
  dessine un rectangle flottant au lieu de montrer la colonne survolée.
- Règle : `padding: 0` sur le `th`, bouton à 100 % largeur/hauteur, rayon 0 ;
  le fond de survol couvre la cellule entière.
- Preuve : capture hover 053.

### L-026 — Pas de sélecteur natif pour changer un type
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menu d’en-tête de colonne
- Anti-pattern : `<select>` de type, perçu comme un dropdown lourd et non Notion.
- Règle : un bouton « Modifier la propriété » ouvre un sous-menu de types avec
  icônes ; sélection immédiate, pas de select natif, pas de chevron d’icône.
- Preuve : capture 053.

### L-027 — Sous-menu : pas de scrollbar horizontale
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menu Couleur, listes de types
- Anti-pattern : hauteur non bornée, largeur libre, barre horizontale inutile.
- Règle : largeur fixe bornée, hauteur maximale, `overflow-x: hidden`, scroll
  vertical fin stylé ; contenu compact.
- Preuve : capture couleur 051.

### L-028 — « … » d’en-tête = paramètres de vue
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : en-tête de table, à côté du +
- Anti-pattern : « … » ouvre une liste de visibilité isolée, sans lien avec les
  paramètres de vue.
- Règle : « … » ouvre le même panneau que l’engrenage de vue, dans la même zone.
- Preuve : capture 053.


### L-029 — Créer une propriété en un clic
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : menu « + » d'une base
- Anti-pattern : demander nom puis configuration avant de créer ; Notion crée
  immédiatement une colonne avec un nom générique.
- Règle : clic sur un type → création atomique avec le libellé du type comme
  nom générique et les options par défaut ; les réglages se font ensuite dans
  l'en-tête ou les paramètres de vue.
- Preuve : capture 053.


### L-030 — Confirmation destructive dans une modale
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : suppression de propriété, actions destructives de structure
- Anti-pattern : bandeau inline qui s'insère au-dessus de la table et décale
  toute la page.
- Règle : confirmation dans un dialogue au-dessus du contenu, avec Annuler,
  conserver les valeurs incompatibles, supprimer les valeurs concernées ;
  aucune modification de layout derrière.
- Preuve : capture suppression 053.

### L-031 — Réorganiser une liste : la ligne entière, en direct
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : visibilité des propriétés
- Anti-pattern : ne déplacer que le fantôme de la poignée ; hover sur toute la
  ligne ; mouvement horizontal libre.
- Règle : la ligne complète est le drag ghost, déplacement vertical uniquement,
  les autres lignes se réorganisent en direct, le drop valide la position.
  Le survol ne se marque que sur la poignée.
- Preuve : capture visibilité 053.

### L-032 — Paramètres de vue : scroller le contenu dessous
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : panneau de paramètres de vue
- Anti-pattern : panneau fixe qui masque la fin du tableau sans permettre le
  scroll horizontal complet ; panneau qui ne se ferme pas au clic extérieur.
- Règle : réserver la largeur du panneau au contenu de la vue, permettre le
  scroll jusqu'aux dernières colonnes, fermer sur clic hors du panneau.
- Preuve : capture 053.

### L-033 — Noms génériques uniques
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : création de propriété
- Anti-pattern : deux colonnes nommées « Texte » ; la deuxième doit être « Texte 2 ».
- Règle : nom générique du type puis suffixe 2, 3… si déjà pris, pour tous les types.
- Preuve : création 053.


### L-034 — En-tête et corps du tableau : même frame
- Statut : validée (retour propriétaire, 2026-11-05)
- Anti-pattern : ScrollTimeline composité pour déplacer l'en-tête, qui retarde
  d'une frame par rapport au corps.
- Règle : un seul scroll horizontal pilote les deux surfaces, synchronisé sur
  l'événement de scroll et la molette ; aucun décalage visible.
- Preuve : table large 053.

### L-035 — Groupe icône + titre
- Statut : validée (retour propriétaire, 2026-11-05)
- Règle : padding gauche de cellule plus généreux et gap icône↔titre explicite ;
  ne pas coller le groupe au bord.
- Preuve : capture hover 053.

### L-036 — Modale destructive : actions comprises
- Statut : validée (retour propriétaire, 2026-11-05)
- Anti-pattern : option « conserver les valeurs incompatibles » lors d'une
  simple suppression, incompréhensible.
- Règle : pour une suppression, seulement Annuler / Supprimer la propriété ;
  pour une conversion, expliquer conserver ou supprimer les valeurs.
- Preuve : modale suppression 053.

### L-037 — Panneau de réglages : réserver la fin de table
- Statut : validée (retour propriétaire, 2026-11-05)
- Règle : l'espace réservé inclut les contrôles + et … ; à la fermeture, la
  réservation disparaît immédiatement ; l'ouverture ne scrolle pas.
- Preuve : 053.

### L-038 — Drag : ligne réelle, drop seulement
- Statut : validée (retour propriétaire, 2026-11-05)
- Anti-pattern : fantôme de poignée, réorganisation live qui lag.
- Règle : déplacer la ligne elle-même, verticalement, et ne réorganiser qu'au
  relâchement ; le survol de la poignée reprend la forme ronde, pas un carré.
- Amendement 2026-11-05 (E-041) : « ne réorganiser qu'au relâchement » concerne
  la **persistance**. Pendant le geste, les autres lignes se réordonnent en
  aperçu local (la ligne déplacée reste sous le pointeur, le créneau d'arrivée
  est visible), puis une seule mutation est écrite au drop. Échap annule sans
  fermer le panneau ; sans persistance à chaque `pointermove`, l'aperçu ne lag pas.
- Preuve : visibilité 053 ; capture 054 (`visibility-drag-*.png`).

### L-039 — Structure de tableau non destructible par une touche
- Statut : validée (retour propriétaire, 2026-11-05)
- Règle : Suppr/Retour arrière dans une cellule vide ne supprime ni cellule ni
  ligne ; seule une commande explicite modifie la structure.
- Preuve : table 053.

### L-040 — Trait de colonne au-dessus du survol
- Statut : validée (retour propriétaire, 2026-11-05)
- Règle : le trait de colonne est peint au-dessus des fonds de lignes ; le
  survol ne doit jamais recouvrir l'accent bleu.
- Preuve : table 053.

### L-041 — Icône de vidage selon l'axe
- Statut : validée (retour propriétaire, 2026-11-05)
- Règle : vider une ligne = trait horizontal ; vider une colonne = trait vertical.
- Preuve : menu de table 053.

### L-042 — Focus : jamais au pointeur, toujours au clavier
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : contrôles de toute l'app
- Anti-pattern : anneau de focus visible après un clic souris ou tactile ; ou
  suppression totale du focus, qui casse le parcours clavier.
- Règle : `:focus:not(:focus-visible)` ne peint ni outline ni ombre ; le
  `:focus-visible` clavier garde un anneau lisible. Ne pas supprimer le focus
  des boutons en bloc : la décision porte sur la modalité, pas sur le type.
- Preuve : clic sur + sans anneau ; Tab sur un bouton → outline 1 px (054).

### L-043 — En-tête de tableau : un seul rail possède le scroll X
- Statut : validée (retour propriétaire, 2026-11-05)
- Surface : tableau de base de données avec en-tête sticky
- Anti-pattern : deux rails scrollables (en-tête et corps) ; un focus, un
  `scrollIntoView` ou une révélation programmatique déplace l'en-tête seul, et
  il reste décalé de plusieurs centaines de pixels par rapport aux cellules.
- Règle : le corps possède le scroll horizontal ; l'en-tête est **non
  scrollable** (`overflow: clip`) et suit par `transform` sur la même frame.
  Toute révélation programmatique (ajout de colonne, focus) déplace le rail du
  corps puis repeint le transform de l'en-tête.
- Preuve : ajout de colonne à 572 px → `en-tête.scrollLeft = 0`, écart
  en-tête/corps = 0 (evidence/table-header-body-sync-add-572.png).

### L-044 — Cellule de tableau : la garde lit la sélection, pas la cible
- Statut : validée (retour propriétaire, 2026-11-06)
- Surface : tableau de page, touche Retour arrière / Suppr dans une cellule vide
- Anti-pattern : garder `event.target.closest(".editor-table-cell__content")` :
  l'élément focus est la racine ProseMirror, pas la cellule, donc la garde ne
  s'applique jamais et la touche fusionne/supprime la cellule.
- Règle : lire `document.getSelection().anchorNode` pour trouver la cellule, puis
  bloquer si son texte est vide. Attention : dans `PageEditor`, `document` est
  une **prop** (BlockDocument) qui masque le document global — utiliser
  `globalThis.document`.
- Preuve : 6 cellules avant/après Retour arrière = 6 (054).

### L-045 — Menu de propriété : les actions de type vivent dans le groupe
- Statut : validée (retour propriétaire, 2026-11-06)
- Anti-pattern : « Modifier le type » posé seul sous le nom, hors des barres,
  avec une taille différente des autres actions ; champ nom sans padding ni
  affordance.
- Règle : le type est la première action du groupe d'actions (entre les deux
  séparateurs), à la même hauteur que les autres (32 px) ; le nom est une zone
  de 32 px avec padding et voile au survol. Aucun trait sous l'icône + nom.
- Preuve : evidence/column-editor-actions.png.

### L-046 — Trait de colonne : un overlay hors du contexte de la poignée
- Statut : validée (retour propriétaire, 2026-11-06)
- Surface : tableau de page, redimensionnement de colonne
- Anti-pattern : le trait bleu est `position: fixed` mais enfant de la poignée de
  la première ligne (`position:absolute; z-index:2`) : il reste enfermé dans ce
  contexte de pile, et les fonds de survol des poignées des lignes suivantes le
  recouvrent. Le fond de survol vient de la règle générique `button:hover` de
  `compatibility.css`, pas de la poignée.
- Règle : porter le trait dans `document.body` (portail) et neutraliser
  explicitement le fond/bordure de survol du bouton de redimensionnement. Le
  trait doit couvrir toute la hauteur du tableau et rester au-dessus de tous les
  fonds de lignes.
- Preuve : evidence/column-separator-hover-fixed.png ; trait 2 px sur 83 px,
  fond de poignée transparent.

### L-047 — Menu de propriété : une colonne d'icônes, une colonne de contenu
- Statut : validée (retour propriétaire, 2026-11-06)
- Surface : menu d'en-tête de colonne (base de données)
- Règle : le carré d'icône du titre (28 px) et les icônes d'action (14 px)
  partagent le même **centre de colonne** (glyphes sur la même verticale) ; les
  libellés d'action et le **texte** du champ titre partagent la même origine.
  Le champ garde sa bordure/padding à gauche du texte.
- Rythme : la ligne titre a la même hauteur de ligne (32 px) et le même pas
  vertical (33 px) que les options ; pas de gap de popover entre les deux.
- Détail technique : retirer le bleed horizontal des actions, mettre
  `padding-left: 0` sur leurs boutons, et réserver la largeur d'icône par une
  marge à droite de l'icône (12 px) + le gap de 8 px. Pas de filet entre la ligne
  de titre et « Modifier le type » ; le filet reste sous le type.

### L-048 — Ligne d'ajout : hover par bouton, colonne du premier bouton alignée
- Statut : validée (retour propriétaire, 2026-11-06)
- Surface : base de données, ligne d'ajout en bas du tableau
- Anti-pattern : `tbody tr:hover td` allume toute la ligne d'ajout ; l'icône du
  premier bouton est décalée de ~16 px par rapport aux icônes page/dossier des
  lignes de contenu.
- Règle : exclure la ligne d'ajout du hover de ligne, mettre le hover sur chaque
  bouton ; caler le premier bouton sur la colonne de la première cellule (même
  padding de cellule), icône et libellé alignés sur les icônes/titres au-dessus.
- Preuve : evidence/add-row-first-button-hover.png, add-row-no-row-hover.png ;
  icône 327 = icône titre 327, texte 352.
- Complément parité Notion (mesuré le 2026-11-06, capture officielle
  `.notion-lab/parity/add-entry/comparison.md`) : la pilule d'ajout Notion fait
  28 px de haut, rayon 6 px, padding-inline 8 px ; le glyphe fait 16 px et le
  libellé 14 px/400, en couleur tertiaire. Le survol ne peint que le voile
  translucide commun — le libellé reste tertiaire. L'icône et le texte restent
  sur la colonne titre (327/352) : décaler la pilule de −6 px et garder un gap
  de 9 px après un glyphe de 16 px. Le filet de fermeture appartient à la
  dernière ligne de contenu, jamais à la ligne d'ajout. Notion n'a qu'une action
  « Nouvelle page » ; la seconde pilule « Nouveau dossier » est une extension
  produit.
- Preuve : evidence/add-row-notion-pill.png, add-row-pill-light.png,
  -light-hover.png, add-row-pill-dark.png, -dark-hover.png, add-row-pill-390.png.

### L-049 — Création d'entrée : optimiste, en fin de liste, titre immédiat
- Statut : validée (retour propriétaire, 2026-11-06)
- Surface : base de données, ligne d'ajout (page et dossier)
- Anti-pattern : attendre l'écriture locale puis le rechargement de la
  projection pour peindre la ligne (l'élément arrive après ~0,5–1 s) ; laisser
  l'ordre par défaut alphabétique classer la nouvelle entrée au milieu.
- Règle : générer l'id côté page, peindre la ligne optimiste en fin de grille
  avec cet id, ouvrir son titre immédiatement, et mettre en file les saisies
  faites avant la fin de l'écriture (flush dès que l'écriture résout). Sans tri
  explicite, l'ordre par défaut est l'ordre de création (`createdAt`), donc la
  nouvelle entrée reste en fin de liste ; un tri explicite reste prioritaire.
- Preuve : mesuré localement — ligne et champ de titre à ~213 ms (avant :
  après l'aller-retour), entrée dernière (index 13/13), titre tapé pendant
  l'écriture conservé ; tests `database-page-interaction` et `query.property`.

### L-050 — Menu de propriété : un groupe d'actions vide ne laisse aucun filet
- Statut : validée (retour propriétaire, 2026-11-10)
- Surface : menu d'en-tête de colonne (base de données), colonne titre
- Anti-pattern : le dernier groupe (Insérer / Dupliquer / Supprimer) est rendu
  inconditionnellement ; la colonne titre n'a aucune de ces actions, mais le
  `border-top` du groupe vide reste visible sous « Trier ».
- Règle : masquer tout groupe vide (`:empty { display: none }`) ; le filet ne
  sépare que deux groupes qui ont du contenu. Vérifier une colonne non-titre :
  ses trois groupes restent visibles et séparés.
- Preuve : evidence/column-menu-title-empty-section-before.png, -hidden.png ;
  section vide 0×0, menu 149 px → 140 px.

### L-051 — En-tête d'ajout de propriété : le libellé vit dans le bouton
- Statut : validée (retour propriétaire, 2026-11-10)
- Surface : en-tête de table, colonne d'ajout avec une seule colonne
- Anti-pattern : libellé rendu dans un `span` à côté du bouton, hors de la
  colonne d'ajout de 68 px ; la cellule de remplissage peint par-dessus, on ne
  lit que « Ajoute », et le texte n'est pas cliquable.
- Règle : quand il n'y a pas de « … » dans l'en-tête, le libellé fait partie du
  bouton (icône + texte, toute la zone cliquable) et la colonne d'ajout
  s'élargit pour le contenir (180 px, bouton 164,8×28). Dès qu'il y a plusieurs
  colonnes et les « … » à droite, ne garder que + et … sans libellé.
- Preuve : evidence/add-property-single-button-light.png, -dark.png,
  -hover.png, add-property-multi-header-end.png ; clic sur le texte = ouverture
  de la saisie, hit-test sur le libellé = bouton.

### L-052 — En-tête d'ajout sous un panneau flottant : borner la pilule, ellipser
- Statut : validée (retour propriétaire, 2026-11-10)
- Surface : en-tête de table, bouton « Ajouter une propriété », panneau de
  paramètres de vue ouvert sur un écran étroit
- Anti-pattern : le panneau fixe passe au-dessus du bouton et le libellé est
  tranché net à l’arête du panneau (pas de « … »).
- Règle : mesurer l’arête gauche du panneau et la position du bouton, borner la
  pilule juste avant (`--database-add-property-max`) et laisser le libellé
  s’ellipser ; re-mesurer pendant l’ouverture animée, au défilement, au
  redimensionnement, et retirer la borne quand le panneau est fermé. Large
  écran : libellé entier.
- Preuve : evidence/add-property-panel-ellipsis-816.png,
  add-property-panel-open-1440.png ; 816 px ouvert → bouton 74 px, libellé
  34 px (contenu 120 px) + « … » ; 1440 px ouvert → 120 px entier.
