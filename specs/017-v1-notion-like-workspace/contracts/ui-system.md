# Contract: Système d'interface V1

## 1. Objectif

La V1 doit former un espace de travail cohérent, dense et calme, proche des
principes d'usage de Notion sans en copier la marque. Le système visuel couvre
le shell, l'éditeur et toutes les surfaces fonctionnelles déjà livrées. Une
page « finie » entourée d'écrans provisoires ne satisfait pas ce contrat.

Tailwind CSS fournit la grammaire de composition ; les variables CSS portent
les décisions de thème ; Ariakit porte les comportements de focus et
d'interaction ; les composants MyOwnNotion portent apparence, variantes et
copie.

## 2. Dépendances et limites

- Tailwind CSS 4.x via son plugin Vite, sans runtime navigateur.
- Ariakit comme fondation headless pour dialogue, menu, popover, combobox,
  tooltip, tabs et focus composite.
- BlockNote Ariakit restylé avec les mêmes tokens.
- Lucide React comme seule famille d'icônes générales.
- dnd-kit pour l'arbre de navigation et son capteur clavier.
- Aucun deuxième framework de composants global, aucune dépendance XL et
  aucune couleur produit codée directement dans un composant.

Le CSS spécifique reste autorisé pour les comportements que les utilitaires
n'expriment pas clairement : rendu BlockNote, animations complexes, contenu
imprimé et détails natifs. Il consomme tout de même les tokens.

## 3. Tokens publics

Les tokens sont des variables sémantiques, stables entre thèmes :

~~~text
--color-canvas             fond de l'application
--color-surface            panneau principal
--color-surface-raised     popover/dialogue
--color-surface-subtle     hover et groupes secondaires
--color-text               texte principal
--color-text-muted         métadonnées
--color-text-disabled      indisponible
--color-border             séparation normale
--color-border-strong      focus/limite forte
--color-accent             action et sélection
--color-accent-contrast    contenu sur accent
--color-danger / warning / success / info
--focus-ring

--font-sans / --font-mono
--text-xs / sm / base / lg / xl / 2xl / 3xl
--leading-tight / normal / relaxed

--space-1 … --space-12
--radius-sm / md / lg / pill
--shadow-popover / dialog / drag
--layer-base / sticky / menu / overlay / toast
--motion-fast / normal / slow
--ease-standard / emphasized
~~~

Les thèmes `light` et `dark` définissent toutes les variables. `system` suit
`prefers-color-scheme` en temps réel. Les couleurs de contenu (`blue`, `red`,
etc.) ont une variante texte et fond par thème conforme aux contrastes. Aucun
thème ne dépend d'une image distante ou d'une police réseau.

## 4. Primitives obligatoires

~~~text
Button, IconButton, LinkButton
TextField, TextArea, Checkbox, Switch, Select
Menu, ContextMenu, Popover, Tooltip, Combobox
Dialog, ConfirmDialog, Drawer
Tabs, SegmentedControl
Badge, Status, Progress, Skeleton, EmptyState, Callout
ToastRegion
ResizablePanel, ScrollArea
VisuallyHidden, FocusBoundary
~~~

Chaque primitive documente : variantes, taille, états normal/hover/active,
focus-visible, disabled, busy, destructive, thème sombre, 200 % et libellé
compréhensible. Les composants composés ne réimplémentent pas le focus ou les
raccourcis d'une primitive Ariakit.

Les boutons icône seuls ont toujours un libellé explicite et un tooltip non
indispensable à la compréhension. Un état n'est jamais transmis par la couleur
seule.

## 5. Shell desktop

~~~text
┌──────────── navigation 240–360 px ────────────┬──────── page ────────┐
│ workspace / actions                           │ fil d'Ariane         │
│ recherche                                     │                      │
│ Favoris / Récents (facultatifs)               │ titre                │
│ Notes : arbre pages & bases                   │ propriétés           │
│                                               │ éditeur              │
│ réglages                                      │ état sync épinglé    │
└───────────────────────────────────────────────┴──────────────────────┘
~~~

- sidebar redimensionnable et largeur mémorisée localement ;
- largeur par défaut 280 px, limites 240–360 px ;
- contenu éditorial centré, largeur lisible par défaut et option pleine largeur
  future sans changer le document ;
- chrome discret : les actions secondaires apparaissent au hover/focus mais
  restent découvrables au clavier ;
- titre, statut local/sync et navigation ne sautent pas pendant le chargement ;
- les surfaces asynchrones utilisent skeleton ou état explicite, pas un écran
  vide.

L'arbre conserve sélection, focus et branches ouvertes. Le DnD montre parent,
position et action refusée ; l'équivalent clavier permet déplacer avant/après
ou dans une page.

Les sections `Favoris` et `Récents` ont chacune un contrôle discret de
repli/dépli indépendant. Leur visibilité est réglable dans la destination
Réglages et ces choix de présentation restent locaux à l'appareil. La
hiérarchie principale s'appelle `Notes`. Ses descendants sont rapprochés du
bord gauche tout en conservant une indentation et un guide visuel assez nets
pour rendre le parent immédiatement identifiable.

Chaque ligne de hiérarchie expose trois destinations de déplacement : avant,
dans et après. Avant/après affichent une ligne entre les éléments ; dans met en
évidence la ligne parent. Un état vide est rendu en français sous le parent
concerné, avec la même indentation, sans donner l'impression d'une nouvelle
section globale.

### 5.1 Frontière du workspace

La colonne principale ne rend que le contenu ou une vue de connaissance :
page, dossier, recherche, base déjà livrée et, plus tard, graphe. Elle ne rend
jamais à la suite du document les panneaux de stockage, appareils, sécurité,
sauvegardes, corbeille administrative, révisions techniques, outbox ou
diagnostics.

Ces fonctions ouvrent une destination dédiée depuis la sidebar ou une action
contextuelle. La page conserve seulement un bouton d'information compact
épinglé au bord inférieur visible, hors du flux du document. Il résume
« Hors ligne », « Enregistré sur cet appareil », « Synchronisation… »,
« Synchronisé » ou « Action requise » et révèle les détails au survol, au
focus ou au clic, sans déplacer le titre ni l'éditeur. Revenir d'une
destination dédiée restaure item actif, focus utile, sélection et ancre de
scroll.

## 6. Responsive

| Largeur | Navigation | Page | Menus |
| --- | --- | --- | --- |
| ≥ 1024 px | sidebar persistante | colonne centrale | popovers ancrés |
| 768–1023 px | sidebar repliable | largeur fluide | popovers ou drawers selon place |
| 320–767 px | drawer modal | pleine largeur, marges 16 px | actions en bottom sheet/drawer |

À 320 px, aucun contenu ou bouton essentiel ne sort horizontalement. Les
tables peuvent défiler dans leur propre zone avec affordance visible. À 200 %
de zoom, le layout adopte la variante étroite selon la place disponible, pas
seulement selon la largeur physique.

Les cibles tactiles essentielles font au moins 44×44 CSS px ou possèdent un
espacement équivalent. Le DnD n'est jamais l'unique méthode.

## 7. Éditeur

- corps de page sans « carte » lourde autour de chaque paragraphe ;
- ligne active et poignée visibles sans déplacer le texte ;
- slash menu et barres flottantes alignés au viewport et non coupés par les
  conteneurs de scroll ;
- sélection multi-blocs perceptible dans les deux thèmes ;
- placeholders différents pour titre, paragraphe vide et bloc inconnu ;
- largeur de code/table/média contrôlée sans casser la colonne de lecture ;
- état local/sync toujours accessible mais visuellement secondaire ;
- ambiguïté présentée près du bloc et dans un centre d'attention global.

Le titre est la première grande ligne éditable du canevas. Il peut rester vide
tant que le propriétaire le modifie ; `Sans titre` n'est affiché qu'après la
sortie du champ, une validation explicite ou le départ de la page.

Un lien interne ou externe déjà présent est reconnaissable au pointeur et
offre les actions ouvrir, modifier la cible, modifier le texte et retirer le
lien. Retirer le lien conserve son texte et ne supprime jamais la page cible.
Ces actions existent dans la barre contextuelle, au clic droit et par un
chemin clavier simple.

Le focus ne saute pas lors d'une update distante. Une suppression distante du
bloc actif place le focus sur le voisin logique et affiche un retour d'état
compréhensible.

## 8. États communs et copie

Chaque surface possède : loading, empty, ready, partial/offline, forbidden,
recoverable error et terminal error lorsque pertinents. Les messages disent :

1. ce qui est conservé ;
2. ce qui ne l'est pas encore ;
3. l'action disponible.

Exemple : `Hors ligne — vos changements sont enregistrés sur cet appareil et
seront synchronisés à la reconnexion.`

Le français est la langue V1. Les chaînes visibles viennent du catalogue de
copie, y compris BlockNote. Aucun message technique brut, code d'erreur ou nom
de table n'est montré à l'utilisateur.

## 9. Ergonomie clavier et basiques d'interface

Le contrat vise le besoin personnel du propriétaire, sans certification
formelle ni campagne de technologies d'assistance :

- ordre de tabulation logique et focus visible ;
- titres et libellés compréhensibles ;
- contraste lisible pour le texte, les icônes et le focus ;
- menus/dialogues fermables par `Escape` sans perte de saisie ;
- retour du focus utile à l'ouverture et à la fermeture ;
- `prefers-reduced-motion` réduit transitions et déplacements ;
- statuts de sauvegarde/synchronisation visibles sans déplacer le contenu ;
- erreurs visibles près du contrôle concerné ;
- alternatives clavier à tous les gestes essentiels.

Les raccourcis affichent la variante macOS ou Windows/Linux et ne détournent
pas un raccourci navigateur essentiel sans alternative.

## 10. Mouvement et performance perçue

- hover/focus : 80–120 ms ; ouverture : 120–180 ms ; drawer : ≤ 240 ms ;
- pas d'animation du texte pendant une synchronisation ;
- skeletons géométriquement proches du contenu pour limiter le CLS ;
- menus ouverts dans le même frame perceptible que l'action ;
- virtualisation seulement après mesure, jamais au prix de la navigation
  clavier ou de la sélection éditeur.

`prefers-reduced-motion` ramène les transitions non essentielles à zéro ou à
un fondu bref.

## 11. Preuve visuelle et migration

La migration suit cet ordre :

1. tokens et primitives ;
2. shell, navigation et statuts ;
3. éditeur et menus ;
4. séparation du workspace et des destinations de configuration ;
5. recherche, fichiers, bases, import/export, paramètres, sécurité, sauvegarde
   et restauration ;
6. suppression des styles historiques devenus sans consommateur.

Chaque surface migrée possède des références Playwright en clair/sombre pour
desktop et mobile, plus les contrôles fonctionnels. Les captures ne remplacent
pas les assertions de rôle, focus, scroll et comportement.

Une différence visuelle est revue explicitement ; mettre à jour une référence
en masse sans expliquer le changement n'est pas une validation.

## 12. Critères contractuels

- toutes les routes V1 utilisent les tokens et primitives communes ;
- aucun composant ne mélange deux familles de menus/dialogues ;
- shell utilisable à 320 px et zoom 200 % sans perte d'action ;
- thèmes clair/sombre/système sans flash durable de mauvais thème ;
- navigation et éditeur complets au clavier ;
- menus BlockNote visuellement intégrés au shell ;
- états offline, local, pending, syncing, synced, attention et blocked sont
  distincts et compréhensibles ;
- aucun panneau de configuration ou diagnostic détaillé n'est rendu sous le
  document courant ; les destinations dédiées restaurent le contexte au retour ;
- Favoris/Récents sont configurables localement et Notes présente une
  hiérarchie lisible avec trois cibles de déplacement explicites ;
- le statut de page reste épinglé en bas sans modifier la géométrie du document ;
- les liens internes et externes offrent le même cycle ouvrir/modifier/retirer,
  sans destruction de leur cible ;
- les parcours principaux passent Chromium, Firefox et WebKit ;
- aucune fonction essentielle n'est accessible uniquement par drag, hover ou
  couleur.
