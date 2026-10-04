# Feature Specification: Système de styles cohérent et maintenable

**Feature Branch**: `codex/031-css-system`
**Created**: 2026-10-02
**Status**: implémentée localement ; revue propriétaire et E2E différés
**Input**: Standardiser les styles de l’application, préserver au maximum les rendus
existants et permettre aux prochains contributeurs et IA de produire une UI/UX
cohérente, très proche de l’intention visuelle de Notion.

## Direction produit et périmètre

Affinement du canevas, sections 4 (V1 qualitative), 12 (navigation secondaire),
13 (éditeur), 14 (bases), 39 (atelier UI), 43.6 (langage visuel commun) et 46
(architecture évolutive). Références : features 003, 017, 022, 023, 029 ;
ui-quality et son journal gouvernent la méthode, les besoins restent ici.
Aucune nouvelle fonction métier, migration, permission ou politique offline.
Le premier commit Slopo `b782a106` reste séparé de cette standardisation.

## Clarifications du propriétaire

- 2026-10-02 : accents plus saturés, bleu indicatif RGB 68/129/216 (`#4481D8`)
  et rouge RGB 213/108/94 (`#D56C5E`). Les couleurs des options de propriétés
  conviennent et doivent rester inchangées. Cette évolution visuelle explicite
  s’ajoute à la préservation des géométries ; le survol des actions suit ces accents.
- 2026-10-02 : chargement avec placeholders neutres adaptés à la surface pour
  limiter les déplacements ; informations et états vides en texte principal,
  sans grande carte colorée. Le focus clavier reste lisible, discret et neutre,
  sans halo bleu. Suppression en texte/contour rouges sur fond neutre ; dans un
  menu, accent rouge au survol ou à la sélection. Captures du propriétaire dans
  `references/`, utilisées comme références visuelles.
- 2026-10-02 : conserver les échantillons de couleurs de contenu et ajouter
  dessous un exemple de sélection en rangée : fond doux, contour et point central
  plus saturés, sans changer la palette. Choix et nom sélectionné visibles.

## User Scenarios & Testing

### US1 — Retrouver le bon style et le réutiliser (P1)

Un contributeur trouve le propriétaire d’une surface, les styles et composants
communs adaptés, et les exceptions intentionnelles sans relire tout le dépôt.

**Independent Test** : partir d’un bouton, d’un champ, d’un menu et d’une base ;
retrouver leur référence, leur propriétaire et leur mode de composition.

**Acceptance Scenarios** :
1. Une surface est à modifier : le guide indique son propriétaire et les contrôles
   à réutiliser ; les exceptions sont expliquées à côté des règles concernées.
2. Une nouvelle action est ajoutée : son rôle, densité, états et focus proviennent
   du système commun ; aucune nouvelle famille de contrôles n’est nécessaire.

### US2 — Garder une interface prévisible et proche de Notion (P1)

Le propriétaire conserve la hiérarchie et les interactions déjà affinées :
contenu principal, navigation discrète, tableaux denses et menus contextuels.

**Independent Test** : comparer les surfaces de référence avant/après, en clair
et sombre, sur desktop et à 320 px ; vérifier clavier et états interactifs.

**Acceptance Scenarios** :
1. Sur une page et une base, les titres, alignements, densités, couleurs et limites
   de défilement gardent leur rendu de référence après standardisation.
2. Un contrôle est au repos, survolé, focalisé, désactivé ou occupé : ses dimensions
   restent stables et son rôle est lisible dans les deux thèmes.
3. Un dialogue, menu ou panneau s’ouvre au clavier : focus, fermeture Escape et
   retour au déclencheur restent prévisibles.
4. À 320 px et avec du texte long, les contrôles utiles restent accessibles ;
   tableaux et code défilent dans leur surface sans élargir toute la page.
5. Pendant l’ouverture d’un contenu, les placeholders conservent les repères de
   la surface. Une mise à jour en arrière-plan conserve le contenu disponible.
   Les informations, états vides et confirmations restent dans le thème neutre.

### US3 — Faire évoluer le système sans créer de dérive (P2)

Un prochain agent dispose d’exemples réels et de règles de composition vérifiables,
avec une procédure explicite de validation visuelle et des liens vers Spec Kit.

**Independent Test** : les références couvrent boutons, champs, menus, overlays,
états, surfaces de contenu et listes compactes ; chaque règle renvoie à une source.

**Acceptance Scenarios** :
1. Une variation est nécessaire : le guide distingue extension commune, style de
   domaine et adaptation d’un éditeur tiers ; les valeurs de thème restent communes.
2. Une correction est proposée : comparaison visuelle et contrôles pertinents
   sont documentés ; une simple compilation n’est pas considérée comme preuve UI.

### Edge Cases

Cascade et spécificité existantes ; styles d’éditeurs tiers ; portails hors de la
surface ; thèmes sans JavaScript ; valeurs graphiques de contenu ; sliders et
positionnement dynamique ; tableaux larges ; texte long ; chargement/erreur/vide ;
préférences de réduction des animations ; classes historiques encore consommées.

## Requirements

- **FR-001** : Chaque famille de styles a un propriétaire identifiable et une
  chaîne de chargement documentée ; les variantes communes ne sont pas dupliquées.
- **FR-002** : Les couleurs de thème et les repères partagés de typographie,
  espacement, forme et couches ont une référence commune ; les exceptions optiques,
  dimensions de données et adaptations tierces sont explicites.
- **FR-003** : Les styles de contrôles historiques ne modifient pas implicitement
  les primitives communes ni les contrôles d’un éditeur tiers.
- **FR-004** : Préserver les fonctions, états, hiérarchie visuelle, densités et
  alignements déjà approuvés ; tout écart intentionnel est justifié par une
  exigence existante et une comparaison visuelle.
- **FR-005** : Fournir un guide de composition court avec sources, exemples,
  anti-patterns et procédure de revue utilisables par un humain ou une IA.
- **FR-006** : Conserver des surfaces réelles de référence des états des contrôles
  et des principales compositions, utilisables sans toucher les données utilisateur.
- **FR-007** : Vérifier rendu réel, thèmes, largeur étroite, textes longs et clavier,
  avec preuves avant/après ; tests pertinents, typage et build complètent la revue.
- **FR-008** : Le résultat est un second commit dédié. Les E2E restent différés
  selon la demande du propriétaire ; aucun push ni validation de release implicite.
- **FR-009** : Les états communs emploient des placeholders neutres pour l’attente,
  des informations sobres et un focus clavier lisible sans halo. Une action
  destructive garde un fond neutre avec texte/contour rouges ; un menu réserve
  cet accent à son interaction. Les références expliquent comment adapter la
  géométrie du chargement au contenu attendu.

## Success Criteria

- **SC-001** : Toutes les feuilles de styles applicatives sont inventoriées avec
  leur propriétaire ; aucun style de feature ne reste dans un fourre-tout global.
- **SC-002** : Les familles communes de contrôles et les deux thèmes ont une seule
  référence, retrouvable depuis le guide et le skill partagé.
- **SC-003** : Les comparaisons des surfaces de référence ne présentent pas de
  régression visuelle inexpliquée ; les scénarios clavier et 320 px passent.
- **SC-004** : Guide, références, preuves et tâches permettent à un prochain
  contributeur de reprendre le travail sans historique de chat.

## Assumptions

Standardisation progressive de toute la feuille commune, sans redesign global ni
remplacement du moteur d’édition. Le rendu courant et les leçons validées constituent
la baseline ; les captures Notion de 029 guident l’intention, pas une parité de
fonctionnalités. Toute validation de release demeure soumise aux gates du dépôt.
