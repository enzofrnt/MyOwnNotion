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
