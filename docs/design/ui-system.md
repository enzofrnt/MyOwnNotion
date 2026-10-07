# Composer l’interface MyOwnNotion

Point d’entrée pour toute modification UI/UX. Lire aussi le
[skill ui-quality](../../.agents/skills/ui-quality/SKILL.md), ses
[leçons validées](../../.agents/skills/ui-quality/lessons.md) et les artefacts de
la feature active. Ce guide décrit **les sources utilisables aujourd’hui** ;
les comportements produit restent dans le canevas et les specs.

## En cinq étapes

1. Ouvrir la surface réelle et identifier action principale, contenu, états et densité.
2. Retrouver son propriétaire dans la carte ci-dessous ; `rg` sa classe dans **tous** les CSS.
3. Composer avec les exports réels de `ui/primitives/index.ts`, `AppIcon` et les tokens `--ui-*`.
4. Vérifier la vraie cascade : deux thèmes, 320 px, texte long, clavier, vide/erreur/busy.
5. Conserver captures et observations dans la feature. Typage ou jsdom seuls ne prouvent pas le rendu.

Le [laboratoire `/__ui-lab`](http://localhost:8080/__ui-lab) montre les primitives
et les **vrais** `PageTitleEditor`, `TableView`, `BoardView`, outils de navigation
et rangées de réglages. Les interactions des compositions utilisent uniquement
des exemples en mémoire ; elles ne passent pas par l’API ni le stockage du propriétaire.
La prop `overlay` explicite fige une surface pour les captures ; sans cette prop,
les déclencheurs sont interactifs. Les actions de l’inventaire « Actions » montrent
les variantes ; les compositions et overlays permettent d’essayer les interactions.
`/__ui-lab?view=board` démarre la composition en Kanban, avec les mêmes lignes
en mémoire ; le changement de format reste disponible dans ses onglets.
Les liens « Connexion et installation » ouvrent les vrais écrans de connexion,
première installation et adresse du serveur. Leurs actions s’arrêtent dans
l’exemple local avant une requête ou une cérémonie passkey. L’aperçu d’adresse
du serveur est réservé au navigateur, afin de préserver le profil desktop.
Sous les couleurs de contenu, le sélecteur de démonstration utilise les mêmes
tokens : fond `-soft`, contour `-border`, point central `-accent`, nom et choix
explicites. Il ne définit pas une nouvelle palette locale.

Le lien « Parcourir les interfaces » ouvre `?review=conflicts`. Dix parcours
utilisent les composants de production : conflits, fichiers, historique, bases,
propriétés, éditeur, récupération, desktop, sauvegardes et états de l’app.
Les vues `?review=database&format=gallery` acceptent `table`, `board`, `gallery`,
`list` et `calendar`. Les callbacks et autorités de document sont en mémoire ;
en Kanban, `mutation=pending` ou `mutation=refused` simule l'attente ou le refus
d'un déplacement pour vérifier les commandes et leur reprise sans données serveur.
l’éditeur de revue désactive les transferts de fichiers. Les exemples desktop
montrent le renderer, sans déclencher installation, rotation ou coffre natif.

L'exemple PJ de `?review=files` utilise `TreeAttachmentDisclosure` et le vrai
`CollapsibleRegion` : le trombone inspecte la ligne sans sélectionner sa page.
`activeViewId` identifie seulement la navigation qui ferme les inspections ;
ne pas appeler la navigation de page depuis ce bouton. Les détails/actions de
chaque fichier compact se montent à la demande dans leur `PopoverContent`,
avec `unmountOnHide` local. Garder leur déclencheur et vérifier les dialogues
imbriqués ainsi que le retour du focus après Échap.

## Où écrire le CSS

Les chemins suivants sont relatifs à `apps/web/src/`. Chaque feuille possède une
famille ; plusieurs classes de composition peuvent employer une primitive commune.
Étendre un état commun dans la primitive, une disposition propre dans le domaine.

| Source | Propriétaire / responsabilité |
| --- | --- |
| `global.css` | Manifeste des imports, aucune règle de feature |
| `ui/tokens.css` | Thèmes, typographie, métriques, couleurs de contenu, aliases de compatibilité |
| `ui/base.css` | Box sizing, document, héritage typographique, sélection, plancher 320 px |
| `ui/compatibility.css` | Apparence des contrôles natifs historiques, helpers transversaux |
| `ui/primitives/primitives.css` | Boutons, champs, états, menus, overlays, scroll et focus communs |
| `ui/item-icon.css` | Glyphes de page/dossier/base/vue et marque de référence |
| `ui/dotted-canvas-background.css` | Fond canvas et ses modes |
| `ui/ui-lab.css` | Disposition de la vitrine, sans restyler les features |
| `features/navigation/navigation.css` | Sidebar, outils, rangées, actions révélées, pièces jointes inline |
| `features/navigation/tree.css` | Arbre historique et ses adaptations responsives |
| `features/navigation/convert.css` | Confirmation de conversion de type |
| `features/workspace/workspace.css` | Shell, onglets de page, titre, outline, enfants, colonne de lecture |
| `features/databases/database.css` | Bases, vues, propriétés, options, table/kanban/galerie/liste/calendrier |
| `features/editor/editor.css` | BlockNote, slash menu, blocs, liens et chrome éditorial |
| `features/editor/editor-table.css` | Tableau éditorial, resize/drag, rails et scrollport |
| `features/settings/settings.css` | Shell et navigation des réglages, rubriques communes |
| `features/settings/settings-security.css` | Document Sécurité, groupes, rangées et adaptations de ses panneaux |
| `features/security/security.css` | Kit de récupération et parcours de remplacement/révocation |
| `features/auth/auth.css` | Connexion, bootstrap, autorisation et connexion desktop |
| `features/backup/backup.css` | Sauvegarde/restauration |
| `features/search/search.css` | Recherche globale et résultats |
| `features/knowledge-graph/knowledge-graph.css` | Graphe, filtres, contrôle des forces, panneau d’information |
| `features/files/files.css` | Aperçu de fichier |
| `features/files/attachment-usages.css` | Liste spécialisée des usages de pièce jointe |
| `features/security/mcp-access-panel.css` | Gestion des accès MCP, importée par son composant |
| `features/save-state/save-state.css` | Présentation de l’enregistrement |
| `features/reconciliation/reconciliation.css` | Décisions de réconciliation |
| `features/diagnostics/diagnostics.css` | Liste des mutations locales, sans classes d’arborescence |

### Chargement et priorité

`main.tsx → global.css` charge Tailwind, tokens, base, primitives puis les feuilles
de domaine **dans l’ordre inscrit au manifeste**. `mcp-access-panel.css` est chargée par la
feature. Les styles BlockNote sont importés par les composants éditeur : examiner
aussi ces imports pour une correction éditoriale.

L’ordre du manifeste préserve la cascade historique. Il n’exprime pas une
classification par priorité : certains layouts anciens arrivent après les
primitives. Pas de nouvelle `@layer`, inversion d’import ou augmentation globale
de spécificité sans comparaison réelle. Les variantes locales d’une primitive
doivent cibler une classe de composition (`.settings-back.ui-button`), jamais
restyler tous les boutons d’un panneau composé. Ne pas ajouter d’override en fin
de `global.css` ni dupliquer une feuille de feature.

`compatibility.css` maintient les contrôles historiques avec leur spécificité
initiale. Les exclusions `:where(:not(...))` protègent `ui-button`, `ui-switch`,
`ui-menu__item`, `ui-field__control` et les champs natifs explicites. Elles protègent
aussi les classes `bn-*` et les contrôles des toolbars/menus BlockNote. L’ensemble
du `.bn-container` n’est pas exclu : il peut héberger nos vues intégrées et leurs
contrôles de domaine. Le chrome tiers appartient aux adaptations de `editor.css`.
Ne pas étendre la compatibilité pour un nouveau formulaire.

## API commune réellement disponible

Importer depuis `ui/primitives/index.ts` ; lire les types du composant avant usage.

| Besoin | API réelle et choix |
| --- | --- |
| Action / navigation | `Button` / `LinkButton` ; variantes `primary`, `secondary`, `ghost`, `danger` ; tailles `default`, `compact`, `square` |
| Icône seule | `Button size="square"` avec `aria-label` et aide `title` ; `AppIcon` est décoratif par défaut |
| Saisie simple | `Field` (`input`), `label`, `description`, `error`, taille compacte, props natives ; `inputClassName` pour une adaptation locale |
| Booléen | `Switch`, `checked`, `onCheckedChange`, nom accessible ; le composant rend un bouton |
| Saisie composée / sélection | `NativeInput` / `NativeSelect`, props et ref natifs, `density="comfortable"` (défaut) ou `"compact"` ; conservent `defaultValue`, `multiple`, `size`, validation et `FormData`. Associer un label. |
| Recherche avec icône / jetons | `InputSurface density="compact"` contenant un `NativeInput` direct et les décorations/jetons ; une seule bordure et un focus neutre sur la surface, sans cadre sur la saisie interne. Le nom accessible reste sur l’input. |
| Texte multiligne | `<textarea className="ui-native-textarea">`, label associé, `aria-describedby`, `aria-invalid`, `disabled`, `data-size="compact"` si nécessaire |
| Section de document | `Section`, props natives de `<section>` ; le consommateur fournit titre et actions. Hairline et espacement communs, sans carte. |
| Tableau de lecture | `ReadTable scrollLabel="…"`, props/ref du `<table>` ; scrollport nommé et accessible au clavier, caption/th/td conservés. Aucun modèle de données ajouté. |
| Aperçu de contenu conservé | `CodePreview`, props/ref du `<pre>` ; scroll local, `prose` pour un retour à la ligne du texte. Ce n’est pas un éditeur. |
| Menu | `MenuRoot`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuLabel`, `MenuSeparator` ; `bare` seulement pour un déclencheur déjà composé |
| Popover | `PopoverRoot`, `PopoverTrigger`, `PopoverContent`, heading/description/dismiss |
| Modal / tiroir | `DialogRoot` / `DrawerRoot`, trigger/content/heading/description/dismiss ; `ConfirmDialog` pour une confirmation destructive |
| Attente / vide / erreur | `Status` ou `AsyncState` (description + action de reprise), `LiveRegion` pour une annonce concise |
| Placeholder de contenu | `Skeleton`, `layout="lines"`, `"table"` ou `"media"`, `rows` ; décoratif, à placer dans un cadre adapté au contenu. `media` remplit la géométrie de l’aperçu. `AsyncState kind="loading"` l’intègre via `loadingLayout` / `loadingRows` avec annonce d’attente |
| Défilement d’overlay | `OverlayScrollArea` ; garder le rayon sur la surface peinte |
| Types d’items | `ItemIcon` et `itemKindIconName` dans `ui/item-icon.tsx` |

`IconButton`, `Select`, `TextArea`, `Tabs`, `Tooltip`, etc. listés dans le contrat
cible de 017 ne sont **pas** tous des exports actuels. Ne pas inventer leur import.
Composer les API ci-dessus ; ajouter un wrapper commun seulement si un besoin
réel le justifie. Les comportements Ariakit (Escape, focus, portails) restent
actifs. Ne pas donner `open={false}` à un root destiné à être non contrôlé.

```tsx
<Button variant="primary" busy={saving} onClick={save}>
  <AppIcon name="add" /> Créer une page
</Button>
<Field id="name" label="Nom" value={name} onChange={changeName}
  {...(error ? { error } : {})} />
<div className="ui-field">
  <label className="ui-field__label" htmlFor="description">Description</label>
  <textarea id="description" className="ui-native-textarea" />
</div>
```

Le libellé des boutons est déjà horizontal avec un gap commun. Ne pas recopier
son alignement dans chaque feature. Les dispositions particulières de recherche
et navigation gardent leurs overrides explicites.

Un groupe d’actions peut utiliser `.ui-actions` (flex, retour à la ligne, gap 8 px).
`Field` reste le choix d’un champ complet avec label, aide et erreur. Pour un
formulaire composé, `NativeInput` apporte la même peinture sans imposer de wrapper.
`.ui-field__control` appartient à `Field` : ne pas l’utiliser seule sur une saisie
de domaine. Les éditeurs de brouillon qui gèrent eux-mêmes leur ref peuvent employer
`.ui-native-input`, sans changer leur protocole d’édition.

### Patron des formulaires

Choisir d'abord le protocole : l'édition d'un contenu existant s'enregistre
automatiquement, avec écritures sérialisées et reprise locale après refus.
Un éditeur inline se ferme au clic extérieur ou à Échap ; ses portails restent
dans son périmètre. Aucun pied Enregistrer/Annuler dans ce parcours. Les
créations atomiques et confirmations destructives gardent le protocole défini
par leur spec, sans le recopier dans l'édition courante.

Dans les cartes et propriétés, utiliser des rangées compactes icône/valeur,
avec « Ajouter [propriété] » quand elle est vide et un nom accessible associé.
Empiler les champs seulement lorsque leur format, aide ou largeur le demande.
Garder aide et erreur près du contrôle, regrouper les options conditionnelles
et vérifier à 320 px. Réutiliser les primitives ; le CSS de la feature reste
le seul propriétaire du layout. Ne pas ajouter une carte autour d'un panneau.

Une saisie inline possède son focus et sa sélection : placer le caret initial
une seule fois dans son layout, sans le rejouer au frame suivant ou dans une
microtask du parent. Une sélection, une saisie native ou un focus pris ailleurs
doivent survivre à la projection React ; les champs date natifs ne proposent
pas l'API de sélection textuelle. Usages et garanties : `DraftTextInput` dans
`databases/value-editor.tsx`, édition de titre dans `TableView`, tests
`value-editor-caret.spec.tsx` et `database-table-accessibility.spec.tsx`.

Une recherche avec icône ou des choix sélectionnés utilise `InputSurface` :

```tsx
<InputSurface density="compact">
  <AppIcon name="search" size="small" />
  <NativeInput aria-label="Rechercher une propriété" placeholder="Rechercher…"
    value={query} onChange={event => setQuery(event.target.value)} />
</InputSurface>
```

La peinture de la surface et du contrôle interne appartient à `primitives.css`.
Ne pas ajouter de bordure/outline sur l’input ni rétablir un second champ dans
le CSS de feature. La densité du wrapper gouverne sa saisie et le tactile.
Usages réels : `EntryChoicePicker` et `DatabaseIconPicker` (essayables dans
le lab d’entrée), ainsi que l’écran Propriétés de `ViewSettingsPanel` dans une
base. Pour un jeton retirable, garder la croix
dans la même `OptionPill` (`trailing`), réserver sa place même si le nom est long,
et conserver un bouton de retrait nommé qui rend le focus à la recherche.

```tsx
<Section aria-labelledby="compare-title">
  <h2 id="compare-title">Comparer les versions</h2>
  <ReadTable scrollLabel="Versions conservées">
    <caption>Contenu disponible</caption>
    <tbody><tr><th scope="row">Texte</th><td><CodePreview prose>{text}</CodePreview></td></tr></tbody>
  </ReadTable>
  <div className="ui-actions"><Button onClick={keep}>Conserver</Button></div>
</Section>
<label>Format <NativeSelect density="compact" defaultValue="table">
  <option value="table">Table</option>
  <option value="board">Tableau kanban</option>
</NativeSelect></label>
```

Usages réels : `sync/conflict-resolution.tsx`,
`databases/database-conflict-resolution.tsx`, `history/revision-restore.tsx`,
`databases/property-editor.tsx` et `knowledge-graph/graph-controls.tsx`.
Les grilles de bases virtualisées, tableaux éditoriaux, sélection et resize restent
dans leur domaine. `ReadTable` sert uniquement aux comparaisons de lecture.

## Tokens, exceptions et intention Notion

| Rôle | Famille canonique |
| --- | --- |
| Surfaces | `--ui-color-canvas`, `sidebar`, `surface`, `surface-raised`, `surface-sunken`, `surface-hover`, `surface-active` |
| Texte / séparation | `--ui-color-text`, `text-muted`, `text-subtle`, `text-disabled`, `text-inverse`, `border`, `border-strong` |
| Actions / états | `--ui-color-accent`, `accent-hover`, `accent-soft`, `focus`, `danger`, `warning`, `success`, `info` et leurs variantes définies |
| Texte | `--ui-font-sans`, `--ui-font-mono`, `--ui-text-xs…3xl`, `--ui-leading-tight/normal/relaxed` |
| Géométrie partagée | `--ui-space-0…12`, `--ui-radius-*`, `--ui-target` (44 px), `--ui-target-compact` (32 px), `--ui-reading-width` |
| Superpositions / mouvement | `--ui-layer-*`, `--ui-shadow-*`, `--ui-focus-ring`, `--ui-duration-*`, `--ui-ease-*` |
| Couleurs de contenu | `--ui-content-{gray,brown,orange,yellow,green,blue,purple,pink,red}` (texte), `-accent` (repère), `-foreground` (texte de commande), `-wash` (support faible), `-soft` (contenu), `-badge` (option), `-border` (contour) |

Les aliases `--color-*`, `--space-*`, etc. sont conservés pour les consommateurs
existants, y compris les styles inline. Nouveau CSS : `--ui-*`. Les couleurs et
ombres littérales vivent dans `tokens.css`. Les accents utilisent le bleu `#4481D8` et le rouge `#D56C5E` demandés par le
propriétaire (031), avec leurs variantes hover. Le focus utilise une bordure
neutre et `--ui-focus-ring: none`, sans glow. Pour du texte coloré, utiliser
`--ui-color-accent-text` / `--ui-color-danger-text` : leurs variantes conservent
un contraste lisible sur les surfaces de chaque thème. Le bouton principal
emploie `--ui-color-accent-solid` / `-solid-hover` pour son texte blanc ; les
repères de sélection et traits de dépôt gardent `--ui-color-accent`. Les
couleurs `--ui-content-*` restent les textes éditoriaux lisibles. Les graines
`-accent` et les coefficients communs `--ui-content-*-weight` produisent les
fonds `-wash` (colonne), `-soft` (carte/highlight), `-badge` (option) et le
contour `-border` sans palette locale. `-foreground` mélange l’accent au texte
principal dans les deux thèmes ; les commandes et compteurs restent lisibles tandis que
les points et sélecteurs conservent la teinte de base. La palette de propriété s'applique aussi
quand le badge est posé sur une carte d'une autre couleur. Le gris utilise les
surfaces neutres. Un contour ne reprend jamais le texte clair d'un badge.
Le survol dérive la luminosité du support avec `--ui-content-hover-lightness`,
sans modifier teinte ni géométrie. Voir [041](../../specs/041-content-color-system/plan.md).
Une nouvelle valeur de thème doit
être vérifiée dans `:root`, `[data-theme="dark"]` et le fallback sombre sans JS.

Les tokens `--ui-graph-*-dark`, `--ui-color-retire-accent-dark`,
`--ui-color-text-on-emphasis`, `--ui-color-search-overlay`, `--ui-shadow-panel`
et `--ui-shadow-card*` portent des rôles spécifiques (géométrie historique et accents clarifiés en 031). Ils ne
créent pas de seconde palette à recopier ailleurs. Le texte sur accent est blanc dans les deux thèmes ; le texte et le fond des
options de propriétés continuent de suivre leur palette de contenu.

Des valeurs locales restent légitimes : positionnement Ariakit
`--popover-available-height`, thème de syntaxe `--shiki-*`, profondeur d’outline,
largeur de sidebar, remplissage du slider du graphe, animation de jonction de
rangée. Elles proviennent du composant ou du tiers. Les dimensions de données,
largeurs de colonnes et calculs `100cqi` ne sont pas des tokens de thème.
Les pixels optiques déjà validés (sidebar 30/24 px, gouttières, hairlines, traits)
ne doivent pas être arrondis sur une grille de 8 px. Les géométries historiques
restent en place ; les nouveaux espacements communs utilisent l’échelle.

### Recettes et sources

- **Attente** : réserver les repères du contenu avec `Skeleton` ou le placeholder
  contextualisé déjà présent (par exemple `PageContentSkeleton`). Le nombre de
  lignes et le cadre appartiennent à la feature : le défaut générique ne garantit
  pas zéro déplacement pour une page de taille inconnue. Garder le contenu
  pendant un rafraîchissement et ajouter une indication compacte si utile.
  `AsyncState` compact réserve une seule ligne par défaut, trois hors mode compact ;
  `loadingRows` explicite permet d’adapter le contexte.
- **Information / vide** : titre en `--ui-color-text`, blanc en sombre, aide muted,
  fond transparent. Une reprise utile à côté du texte ; aucune grande carte bleue
  ou orange pour un état normal. Erreur proche de la saisie, qui reste conservée.
- **Clavier / destruction** : repère neutre 1 px sans halo sur les contrôles
  communs. Le bleu reste pertinent pour une sélection de cellule ou l’action
  principale. `Button variant="danger"` garde un fond neutre avec texte et contour
  rouges ; `MenuItem destructive` reste normal au repos et rouge à l’interaction.

- **Page** : `workspace/page-title-editor.tsx` puis colonne de lecture dans
  `workspace.css`. Le titre domine ; métadonnées et chemin restent discrets.
- **Base** : `databases/database-container-page.tsx`, `table-view.tsx`,
  `board-view.tsx` et `database.css`. Onglets denses, en-têtes légers, séparations
  fines et actions contextuelles. Une vue intégrée garde la largeur du texte.
  La table possède son scroll horizontal. En pleine page ou intégrée, son
  défilement vertical suit `.workspace-main` via `useTableViewport` ; le lab
  borné garde son scroll vertical local. Conserver l'origine du tbody et
  l'étendue calculée pendant les remplacements de lignes virtualisées, afin
  de garder pagination et retour/focus accessibles après 1 000 entrées.
  Le Kanban pleine page/intégré suit aussi le viewport de page ; chaque liste
  observe son origine et garde sa hauteur virtuelle avec un gap mesuré. Seul
  le lab borné garde le scroll vertical local. Les en-têtes table/Kanban vivent
  dans un rail CSS sticky, frère du corps à défilement horizontal, et s'arrêtent
  à la fin de la base. `usePageHeaders` mesure le retrait sous le chemin, la
  gouttière et la course horizontale lors d'un changement de layout. Le corps
  est l'unique source de scroll horizontal : une ScrollTimeline anime le
  contenu de l'en-tête directement depuis cette source, sans copier scrollLeft
  après chaque événement. Le rail d'en-têtes est clippé et ne défile pas seul.
  Un moteur sans ScrollTimeline coordonne le geste horizontal et sa traduction
  dans le même handler. Aucun calcul de position d'en-tête pendant le scroll
  vertical. Les commandes
  restent uniques ; la table partage ses largeurs via les mêmes colgroups.
  Le rail Kanban peint les coins supérieurs complets sur un fond de canvas.
  Le Kanban pleine page partage le breakout 100cqi/gouttière de la table ;
  `data-page-flow` scope les surfaces du viewport vertical canonique.
  Chaque colonne dépliée propose une carte de création après ses cartes, avec
  Page/Dossier à l'intérieur et valeur initiale enregistrée atomiquement sur
  Entrée/clic extérieur. Le crayon d'une carte existante déplie ses rangées
  icône/valeur (ValueEditor presentation="card"), avec autosave sérialisé, type
  permanent et fermeture extérieure reconnaissant ses portails. Une erreur
  conserve la saisie et propose Réessayer. Aucun pied Enregistrer/Annuler.
  Le titre et l'icône canonique sont prioritaires. Crayon et « … » partagent
  une capsule bordée révélée au survol/focus, visible au toucher. Le menu portal
  propose les actions prises en charge ; ConvertItemControl partage la
  confirmation de l'arbre et ses icônes origine/flèche/destination.
  Le regroupement se configure via « Grouper » dans les réglages de la vue,
  avec un panneau dédié et une propriété appliquée immédiatement. Les cibles de 32 px
  passent à 44 px avec un pointeur tactile ; Échap rend le focus à l'origine et
  un déplacement réussi le rend à la carte dans la colonne de destination.
- **Entrée de base** : `workspace-page-canvas.workspace-entry-canvas` contient
  `EntryPanel` avec `renderHeader(onClose)` → `PageTitleEditor` (titre/icône,
  chemin et retour). `entry-properties` et le document/dossier suivent la même
  colonne ; `workspace.css` possède ce placement, `database.css` possède les
  lignes/valeurs. `ValueEditor presentation="entry"` utilise `EntryChoicePicker`
  et les mêmes `OptionPill` que les cellules : recherche/création, jetons retirables,
  réglage du nom et de la couleur depuis chaque option. Relations en menu,
  autres champs natifs compacts. `useEntryAutosave` conserve la saisie et sérialise
  les écritures locales après une pause, blur/Entrée ou un choix immédiat ; aucun
  bouton Enregistrer. `saveEntryPropertyChanges` fusionne uniquement les champs
  modifiés dans la dernière révision, bloque une divergence sur le même champ
  et préserve le brouillon pour reprise. Ne pas remplacer cette file par une
  écriture du formulaire entier à chaque caractère.
  `EntryPropertyList` possède les poignées à six points, la preview bleue et
  le même menu d’actions au clic normal, clic droit ou Maj+F10 ; Échap rend le
  focus au libellé. `PropertyConfiguration` et
  `PropertyOptionSettings` utilisent les menus/popovers partagés et les tokens
  de contenu ; leurs modifications sont automatiques. Les mutations passent
  par `editEntrySourceDefinition`, avec confirmation d’impact avant retrait ou
  changement incompatible et conservation des valeurs pour récupération.
  `DatabaseIconPicker` est le sélecteur commun des icônes de vues et propriétés,
  avec le catalogue de `view-icon.tsx`. `PropertyIconPicker` l’ouvre depuis la
  configuration d’entrée et les réglages de source ; `DatabasePropertyIcon`
  affiche partout le choix ou le symbole du type. La marque vit dans la propriété
  (`icon` facultatif/null), jamais dans les valeurs ni dans une colonne de vue.
  Retirer le choix revient au symbole du type ; conversion/duplication gardent
  la marque. Conserver une grille sans débordement et les cibles tactiles.
  L’ordre des lignes est celui des propriétés de la source ; les colonnes des
  vues gardent leur ordre propre. Glisser ne persiste qu’au dépôt, Échap annule ;
  clavier Espace/flèches/Espace et commandes Monter/Descendre restent disponibles.
  Conserver protection de révision, validation, erreurs près des champs et
  rôles de tâches accessibles. Ne pas ajouter un deuxième petit titre ou une carte
  de formulaire. Exemple mémoire : `/__ui-lab?review=entry` (page/dossier,
  indisponible, vide, échec/succès). Le lab ne restyle que ses titres de section
  directs ; il laisse la typographie du document au propriétaire éditeur.
  La liste invisible de mesure du chemin est contenue sans comprimer ses
  segments ; les liens visibles respectent la largeur de leur segment.
- **Navigation** : outils `workspace-navigation__search/__graph`, rangées d’arbre
  et `navigation.css`. Icône + libellé à gauche, fond discret ; icônes de ligne
  révélées puis chrome seulement au survol du contrôle (L-001…008/L-013).
- **Réglages** : `settings-content` et document Sécurité dans
  `settings-security.css`. Rangée `__row-main` avec libellé/aide puis
  `__row-actions`. Un document de sections, sans transformer chaque ligne en carte.
  Les `.panel` historiques et `.ui-settings-panel` sont aplaties uniquement
  dans `.settings-content` : ne pas recopier cet override ailleurs. Les contrôles
  gardent la peinture de leur variante ; les adaptations Sécurité règlent la
  géométrie et le retour à la ligne des libellés. Les détails de page séparent
  identité/relations et historique par un `gap` de section.
- **Connexion** : `auth.css`, `.ui-auth-surface` et `.ui-auth-card` ; largeur
  de formulaire 28 rem, gouttières de 16 px et sections transparentes. Le bootstrap
  conserve une largeur supérieure pour ses instructions. Employer `Field` et
  les variantes de boutons sans override général de leur peinture.
- **Recherche** : `search.css`, titre flexible avec `min-width: 0`, type non
  compressible et chemins qui reviennent à la ligne. Les libellés longs restent
  lisibles à 320 px sans repousser le type ni élargir le document.
- **Éditeur tiers** : `editor.css`, `editor-table.css` et
  [guide des tableaux](affine-table-ui.md). Hover/drag hors du DOM ProseMirror ;
  géométries/`!important` des node views sont des exceptions expliquées (L-012…017).
  La poignée de bloc conserve AppIcon `drag` ; sa surface est rectangulaire,
  avec des marges égales autour des points et 4 px avant le texte. Sa largeur
  retranche un tiers de la taille du dessin à sa hauteur (32 px au pointeur,
  44 px au tactile) : ne pas lui
  réappliquer une cible carrée (retrait supérieur fixé par le propriétaire).
  L'ajout et la poignée se centrent sur la première ligne de texte mesurée
  par `editor-menus/block-side-menu-layout.ts`, dans le middleware existant.
  Ne pas recopier un offset par niveau de titre ni centrer sur la hauteur
  totale d'un titre multiligne ; les espacements et la typographie réels
  doivent déterminer le placement, sans mutation du DOM ProseMirror.
  Le menu `/` utilise la stratégie `fixed` de Floating UI : son ancrage suit
  le curseur et le défilement de page, tandis que les options défilent dans
  leur propre surface bornée par le viewport. Cette option appartient à
  `editor-menus/slash-menu.tsx` ; l’apparence reste dans `editor.css`.

Ne pas reproduire la palette avec une nouvelle carte pour chaque section, des
diagnostics dans le contenu, un dégradé promotionnel ou de gros boutons dans la
sidebar. Les [références Notion de 029](../../specs/029-database-pages-views/)
et les leçons validées donnent l’intention ; elles ne garantissent pas une parité
visuelle exhaustive de toutes les surfaces déjà livrées.
Les [captures supplémentaires du propriétaire](../../specs/031-css-system/references/README.md)
précisent la distinction entre sélection bleue, action principale et suppression sobre.

## Revue avant livraison

Pour chaque story UI, capturer la vraie surface en clair/sombre, à 1280 et 320 px,
avec texte long. Examiner titres, quatre côtés des espacements, arrondis peints,
hover/focus et stabilité busy/disabled. Ouvrir les overlays au clavier, fermer
avec Escape et contrôler le retour au déclencheur. Faire défiler les tables
dans leur propre surface ; vérifier que la page ne déborde pas. Vérifier aussi
zoom 200 % et réduction des animations si les métriques/mouvements changent.

Ajouter un test comportemental lorsqu’une interaction change ; compléter avec
typages/lint/build. Noter les écrans réellement vus et les limites dans
`specs/<feature>/verification.md` ou `validation.md`. Le journal de leçons reçoit
une nouvelle entrée uniquement après validation explicite du propriétaire.
Les gates de [développement](../development.md) restent requis avant push.

Historique de cette standardisation : [031 et ses preuves](../../specs/031-css-system/verification.md).
Revue des surfaces en contexte et limites : [032](../../specs/032-ui-uniformity/verification.md).
Inventaire complet des familles, bibliothèque et états conditionnels :
[033](../../specs/033-app-ui-review/verification.md).
