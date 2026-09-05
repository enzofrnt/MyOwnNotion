---
name: ui-quality
description: Concevoir, implémenter et vérifier les interfaces MyOwnNotion avec les composants du repo, une hiérarchie claire, des espacements cohérents et des interactions prévisibles. À charger pour les phases UI des specs, les modifications visuelles et les revues UX.
---

# Qualité UI de MyOwnNotion

Lire le canevas produit, la spec active et ses décisions visuelles. Les références
ou corrections explicites du propriétaire priment sur ces conventions. Ce skill
ne crée pas de permission de publier ni de nouvelle exigence métier.

## Partir du système existant

Depuis la racine du repo, consulter `apps/web/src/ui/tokens.css`,
`apps/web/src/global.css`, `apps/web/src/ui/primitives/`, `apps/web/src/ui/icons.tsx` et les composants voisins.
Vérifier depuis le point d’entrée quelle feuille de styles est effectivement chargée ;
ne pas valider une copie historique inutilisée. Utiliser les tokens sémantiques, `Button`, `Field`, les menus/dialogues Ariakit
existants et `AppIcon`. Compléter une primitive commune lorsqu'il manque un état
utile ; éviter une nouvelle famille de boutons pour une seule feature.

Le contenu est la surface principale. Mettre sécurité, stockage et diagnostics
dans les réglages. Une propriété technique, un identifiant interne ou un état de
transport ne doit pas occuper l'espace d'une note sans raison utile à l'utilisateur.

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

- Employer les couleurs de surface, texte, bordure, focus et état du thème ;
  ne pas placer des couleurs brutes dans chaque composant. Vérifier clair et sombre.
- Garder un focus clavier visible. Le survol, la couleur ou une icône seuls ne
  suffisent pas à communiquer un état. Préserver les libellés et la hiérarchie des titres.
- Menus et dialogues : ouverture au clavier, Échap, focus initial utile et retour
  au déclencheur. Utiliser les couches existantes ; éviter les z-index arbitraires
  et les contrôles coupés par un conteneur scrollable.
- À 320 px comme sur desktop, le contenu reste utilisable. Les tableaux et le code
  peuvent défiler dans leur propre surface ; ils ne font pas déborder toute la page.
- Respecter la réduction des animations. Une transition aide à comprendre un état ;
  elle ne retarde pas l'action et ne déplace pas son contrôle.

## Vérifier la réalisation

Avant de coder, inscrire dans la spec/les tâches les états UI et interactions qui
comptent pour la feature. Tester les comportements modifiés au niveau pertinent.
Ne pas écrire un test qui ne fait que recopier une valeur CSS ou le texte de ce skill.

Ouvrir la vraie interface et examiner les surfaces modifiées à l'échelle normale :
état rempli et vide, texte long, erreur/chargement, clavier, largeur étroite, thèmes.
Contrôler visuellement espacements, emboîtement des arrondis et stabilité des actions.
Conserver dans la validation de feature les preuves obtenues et les limites réelles.
Les contrôles locaux obligatoires restent ceux de `docs/development.md`.
