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
tokens : fond `-soft`, contour et point central en couleur de contenu, nom et
choix explicites. Il ne définit pas une nouvelle palette ni une API globale.

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
| Sélection / texte multiligne | Éléments natifs `.ui-native-select` / `.ui-native-textarea`, label associé, `aria-describedby`, `aria-invalid`, `disabled`, `data-size="compact"` si nécessaire ; `.ui-select` est un alias historique du même select |
| Menu | `MenuRoot`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuLabel`, `MenuSeparator` ; `bare` seulement pour un déclencheur déjà composé |
| Popover | `PopoverRoot`, `PopoverTrigger`, `PopoverContent`, heading/description/dismiss |
| Modal / tiroir | `DialogRoot` / `DrawerRoot`, trigger/content/heading/description/dismiss ; `ConfirmDialog` pour une confirmation destructive |
| Attente / vide / erreur | `Status` ou `AsyncState` (description + action de reprise), `LiveRegion` pour une annonce concise |
| Placeholder de contenu | `Skeleton`, `layout="lines"` ou `"table"`, `rows` ; décoratif, à placer dans un cadre adapté au contenu. `AsyncState kind="loading"` l’intègre via `loadingLayout` / `loadingRows` avec annonce d’attente |
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

## Tokens, exceptions et intention Notion

| Rôle | Famille canonique |
| --- | --- |
| Surfaces | `--ui-color-canvas`, `sidebar`, `surface`, `surface-raised`, `surface-sunken`, `surface-hover`, `surface-active` |
| Texte / séparation | `--ui-color-text`, `text-muted`, `text-subtle`, `text-disabled`, `text-inverse`, `border`, `border-strong` |
| Actions / états | `--ui-color-accent`, `accent-hover`, `accent-soft`, `focus`, `danger`, `warning`, `success`, `info` et leurs variantes définies |
| Texte | `--ui-font-sans`, `--ui-font-mono`, `--ui-text-xs…3xl`, `--ui-leading-tight/normal/relaxed` |
| Géométrie partagée | `--ui-space-0…12`, `--ui-radius-*`, `--ui-target` (44 px), `--ui-target-compact` (32 px), `--ui-reading-width` |
| Superpositions / mouvement | `--ui-layer-*`, `--ui-shadow-*`, `--ui-focus-ring`, `--ui-duration-*`, `--ui-ease-*` |
| Couleurs de contenu | `--ui-content-{gray,brown,orange,yellow,green,blue,purple,pink,red}` et `-soft` |

Les aliases `--color-*`, `--space-*`, etc. sont conservés pour les consommateurs
existants, y compris les styles inline. Nouveau CSS : `--ui-*`. Les couleurs et
ombres littérales vivent dans `tokens.css`. Les accents utilisent le bleu `#4481D8` et le rouge `#D56C5E` demandés par le
propriétaire (031), avec leurs variantes hover. Le focus utilise une bordure
neutre et `--ui-focus-ring: none`, sans glow. La palette des propriétés
`--ui-content-*` reste inchangée. Une nouvelle valeur de thème doit
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
  La table et le kanban possèdent leurs scrollports ; ne pas donner
  `overflow: visible` au scrollport du kanban en voulant libérer le tableau.
  Sur une carte Kanban, le titre est une action ghost alignée au texte. Le select
  compact et les flèches de déplacement partagent une ligne ; les flèches gardent
  un nom accessible décrivant la destination et une aide au survol. Les cibles
  de 32 px passent à 44 px avec un pointeur tactile.
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
