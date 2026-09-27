---
name: ui-quality
description: Concevoir, implémenter et vérifier les interfaces MyOwnNotion (UI et UX) avec les composants du repo, une hiérarchie claire, des parcours prévisibles et des leçons capitalisées. À charger pour Speckit (plan, tasks, implement, converge), toute modification visuelle et toute revue UX.
---

# Qualité UI/UX de MyOwnNotion

Lire le canevas produit, la spec active et ses décisions visuelles, puis
[lessons.md](lessons.md). Les références ou corrections explicites du
propriétaire priment sur ces conventions. Ce skill ne crée pas de permission de
publier ni de nouvelle exigence métier.

UI et UX vont ensemble : pixels cohérents sans parcours clair, ou parcours clair
sans système visuel, sont des échecs.

## Boucle atelier (correction → leçon)

Quand on corrige une surface avec le propriétaire :

1. Auditer le rendu réel (pas seulement le code) : hiérarchie, friction, états.
2. Proposer des défauts courts, priorisés ; attendre le go avant de patcher.
3. Corriger ; vérifier clavier, largeur étroite, thèmes clair/sombre si touchés.
4. Capitaliser : écrire une leçon `L-NNN` dans `lessons.md` après validation.
5. Remonter dans ce skill uniquement les règles stables et générales.

Ne pas cocher une tâche UI Speckit sans revue visuelle documentée (même brève)
dans les artefacts de feature.

## Gates Speckit

Sur toute feature qui touche l’interface :

| Phase | Obligation |
| --- | --- |
| `plan` | Charger ce skill + `lessons.md` ; lister états UX (vide, erreur, chargement, succès) et parcours. |
| `tasks` | Au moins une tâche explicite « appliquer ui-quality + preuves visuelles » par story UI. |
| `implement` | Relire skill + leçons avant le code UI ; ne pas marquer done sans preuve visuelle. |
| `converge` | Un écart UI/UX matériel bloque la convergence ; ce n’est pas cosmétique. |

## Intention UX avant pixels

Avant d’ajuster espacements ou couleurs, répondre :

- Quelle est la **prochaine action utile** sur cet écran ?
- Qu’est-ce qui est **principal** vs secondaire vs diagnostic ?
- L’état vide/erreur propose-t-il une reprise **là où l’utilisateur regarde** ?
- Un statut technique (sync, stockage, ids) ne doit pas rivaliser avec le contenu
  ni l’action principale, sauf dans les réglages ou un panneau dédié.

## Partir du système existant

Depuis la racine du repo, consulter `apps/web/src/ui/tokens.css`,
`apps/web/src/global.css`, `apps/web/src/ui/primitives/`, `apps/web/src/ui/icons.tsx` et les composants voisins.
Vérifier depuis le point d’entrée quelle feuille de styles est effectivement chargée ;
ne pas valider une copie historique inutilisée. Avant de restyler une surface,
inventorier (`rg`) toutes les règles qui la touchent et ne garder qu’un seul
propriétaire CSS ; supprimer ou re-scoper les autres dans la même passe
(`L-009`). Pas de sélecteurs génériques `.x li` / `.x form` / `.x button` sur
une surface composée de plusieurs panneaux. Utiliser les tokens sémantiques, `Button`, `Field`, les menus/dialogues Ariakit
existants et `AppIcon`. Compléter une primitive commune lorsqu'il manque un état
utile ; éviter une nouvelle famille de boutons pour une seule feature.

Le contenu est la surface principale. Mettre sécurité, stockage et diagnostics
dans les réglages. Une propriété technique, un identifiant interne ou un état de
transport ne doit pas occuper l'espace d'une note sans raison utile à l'utilisateur.

Dans la barre latérale, les outils (recherche, graphe, etc.) forment une rangée
horizontale icône + libellé, pleine largeur, alignée à gauche — jamais une pile
centrée. Voir `L-001` dans [lessons.md](lessons.md).

La sidebar est **secondaire** au contenu de page : typo petite et muted,
séparateur hairline, rangées compactes (`L-004`). Les actions de ligne
d’arbre se révèlent en icônes au survol de la rangée ; le chrome bouton
n’apparaît qu’au survol du contrôle (`L-002`, `L-013`). Une surface ouverte ne
réutilise pas le même fond que le hover de ligne (`L-003`). Si on compacte
une rangée, on réduit aussi ses contrôles (`L-005`).

Dans l’éditeur (tableaux, node-views BlockNote/ProseMirror) : l’état de
survol, de brouillon de resize et de layout vit **hors** du DOM ProseMirror
(`L-012`) ; un séparateur de colonne mis en avant l’est sur **toute** la
hauteur (`L-014`) ; un contenu plus large que la colonne de lecture a son
propre scrollport aligné au texte (`L-015`) ; un drag prévisualise en local
et ne persiste qu’au `pointerup` (`L-017`).

## Boutons et états

- Une action utilise un bouton ; une navigation, un lien. Donner un verbe précis
  à l'action. Un bouton icône possède un nom accessible et une aide au survol/focus.
- Déclencher les actions avec le clic sémantique du bouton, après relâchement.
  Un appui puis un relâchement hors de la cible doit annuler ; ne pas contourner
  un remontage du contrôle en exécutant l’action sur `pointerdown`. Vérifier
  activation unique par Entrée/Espace et technologies d’assistance.
- Distinguer l'action principale, les actions secondaires et les commandes discrètes
  avec les variantes existantes. Éviter plusieurs actions principales concurrentes
  dans le même groupe. Réserver le style danger aux conséquences destructives.
- Conserver position, largeur et zone de clic entre repos, survol, focus et chargement.
  Ne pas remplacer un contrôle sous le pointeur pendant une mise à jour d'état.
  Le chargement empêche les doubles déclenchements et indique ce qui reste en cours.
- Réutiliser les cibles `--ui-target` (44 px) et `--ui-target-compact` (32 px).
  La variante compacte convient aux zones denses au pointeur ; conserver une cible
  confortable au tactile. La taille du dessin de l'icône n'est pas la zone cliquable.
- Une désactivation compréhensible explique son prérequis. Une erreur garde la
  saisie, reste près de l'action et propose une reprise. Ne pas annoncer « synchronisé »
  si seul l'enregistrement local est confirmé.

## Espacements et alignements

Employer l'échelle `--ui-space-*` : 4, 8, 12, 16, 24, 32 px sont des repères,
non une raison de réécrire un alignement optique déjà validé. L'écart interne
entre éléments liés reste inférieur à celui séparant deux groupes. Une séparation
plus forte signale un changement de section.

Préférer `gap` et un padding de conteneur explicite aux marges individuelles qui
s'accumulent. Aligner les libellés, les champs et les actions sur des repères communs.
Mesurer les quatre côtés d'une barre d'outils, d'un formulaire ou d'une carte,
y compris avec un texte long, une icône, un état vide et un message d'erreur.

## Arrondis imbriqués

Deux surfaces proches doivent avoir des courbes concentriques. Pour un parent
de rayon extérieur R et un retrait réel d entre les deux contours, viser
`rayon_enfant = max(0, R - d)`. Compter bordure et padding dans le retrait,
sans compter deux fois la même distance.

Exemple : parent de rayon 16 px, enfant en retrait de 4 px → rayon enfant 12 px.
Donner 16 px aux deux crée une pointe visuelle et un intervalle irrégulier.
Cette règle concerne un enfant qui suit le contour du parent ; elle ne force
pas le rayon d'un petit bouton libre au centre d'un panneau. Utiliser les tokens
de rayon disponibles, puis vérifier visuellement le résultat à l'échelle réelle.
Réserver les formes entièrement rondes aux contrôles dont la forme le justifie.

## Lisibilité, clavier et superpositions

- Réutiliser les polices, tailles et interlignes des tokens. Distinguer titre,
  texte courant et aide avec une hiérarchie stable ; éviter de multiplier tailles
  et graisses dans un même panneau. Garder un interligne confortable pour les
  paragraphes. Un libellé long doit revenir à la ligne ou rester accessible ;
  ne pas réduire la taille du texte pour le faire tenir dans un bouton.
- Employer les couleurs de surface, texte, bordure, focus et état du thème ;
  ne pas placer des couleurs brutes dans chaque composant. Vérifier clair et sombre.
- Garder un focus clavier visible. Le survol, la couleur ou une icône seuls ne
  suffisent pas à communiquer un état. Préserver les libellés et la hiérarchie des titres.
- Menus et dialogues : ouverture au clavier, Échap, focus initial utile et retour
  au déclencheur. Utiliser les couches existantes ; éviter les z-index arbitraires
  et les contrôles coupés par un conteneur scrollable. Les coins arrondis
  s’appliquent à la **surface peinte** (`overflow` + `border-radius`), pas
  seulement au positioner (`L-016`).
- À 320 px comme sur desktop, le contenu reste utilisable. Les tableaux et le code
  peuvent défiler dans leur propre surface ; ils ne font pas déborder toute la page.
  Un tableau large s’aligne au texte au repos et reste au-dessus du fond canvas
  pendant le scroll (`L-015`).
- Respecter la réduction des animations. Une transition aide à comprendre un état ;
  elle ne retarde pas l'action et ne déplace pas son contrôle.

## Vérifier la réalisation

Avant de coder, inscrire dans la spec/les tâches les états UI et interactions qui
comptent pour la feature. Tester les comportements modifiés au niveau pertinent.
Ne pas écrire un test qui ne fait que recopier une valeur CSS ou le texte de ce skill.

Ouvrir la vraie interface et examiner les surfaces modifiées à l'échelle normale :
état rempli et vide, texte long, erreur/chargement, clavier, largeur étroite, thèmes.
Contrôler visuellement espacements, emboîtement des arrondis et stabilité des actions.
`tsc` et les tests jsdom ne voient pas la cascade CSS : une passe CSS sans
capture de la surface réelle n'est pas vérifiée et ne doit pas être annoncée
comme telle (`L-010`). Un overlay qui contient des sliders ou des valeurs qui
changent pendant l'interaction a une largeur fixe (`L-011`).
Conserver dans la validation de feature les preuves obtenues et les limites réelles.
Les contrôles locaux obligatoires restent ceux de `docs/development.md`.
