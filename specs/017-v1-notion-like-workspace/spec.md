# Feature Specification: Expérience V1 proche de Notion et convergence locale

**Feature Branch**: `codex/017-v1-notion-like-workspace`

**Created**: 2026-08-20

**Status**: Ready for Tasks

**Input**: User description: "Rendre obligatoire dans la V1 une interface
qualitative et fonctionnelle proche de Notion. Reprendre proprement le shell,
la barre latérale et l'éditeur par blocs avec menus contextuels, barre d'outils
flottante, glisser-déposer, interactions avancées et design cohérent, tout en
réutilisant les fondations d'édition déjà livrées. Corriger également la
restauration de scroll et le cas clavier WebKit encore ouverts dans la feature
003. Garantir aussi que le même propriétaire puisse modifier la même page sur
plusieurs appareils hors ligne, puis retrouver automatiquement un contenu
convergent sans remplacement du document entier ni perte silencieuse."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 3, 6.1, 7, 9 à 21, 28 à 32 et 42 à 47 du
[canevas produit](../../docs/product/product-canvas.md). La vision y promet déjà
une organisation et une édition proches de Notion, mais le périmètre V1 ne
rendait pas encore leur niveau d'interaction et de finition vérifiable. Cette
feature ferme cet écart : la V1 ne peut plus être annoncée comme terminée tant
que ses parcours cœur restent une juxtaposition de contrôles techniques plutôt
qu'un espace de travail cohérent.

Les features précédentes restent propriétaires de leurs données et garanties :
modèle canonique et hors-ligne (001), sécurité (002), éditeur et navigation de
base (003), conversion page/dossier (004), fichiers (005), transport,
autorisation des appareils et rattrapage (006), sauvegarde et restauration
(007), recherche (008), bases et tâches structurées (009). La 017 remplace leur
présentation et enrichit leurs interactions.

Cette feature affine toutefois délibérément deux fondations devenues
insuffisantes pour la V1. Elle remplace le bouton de sauvegarde et l'écriture du
corps complet d'une page hérités de la 003. Elle remplace aussi, pour le seul
contenu éditorial des pages, la fusion à trois voies par blocs de la 006 par une
représentation causale et convergente à la granularité du texte riche, des
blocs stables et de leurs déplacements. La file locale chiffrée, le flux de
changements, les appareils autorisés, les fichiers, les révisions et les
protections de la 006 restent réutilisés. Le modèle canonique indépendant de
l'éditeur demeure le contrat durable ; sa projection est matérialisée depuis
l'état opérationnel vérifié, et non maintenue comme une seconde vérité
concurrente.

Le périmètre obligatoire couvre l'ensemble du produit visible dans la version
livrée : installation initiale, connexion, workspace, barre latérale, pages,
éditeur, fichiers, recherche, bases déjà présentes, sauvegardes, sécurité,
états hors ligne et conflits. « Proche de Notion » désigne ici un modèle
d'interaction mesurable et une qualité cohérente ; cela ne signifie ni copie
pixel par pixel, ni parité avec toutes les fonctions de Notion.

Cette feature absorbe les deux écarts connus de la 003 : restauration de la
position dans un document et déplacement clavier vers le parent sur WebKit.
Elle ne rouvre pas l'historique des tâches terminées de la 003 ; elle prend la
responsabilité explicite de ces comportements dans son propre périmètre.

## Clarifications

### Session 2026-08-20

- Q: Une interface seulement fonctionnelle suffit-elle à déclarer la V1 ? → R:
  Non. La V1 doit posséder une interface cohérente, qualitative et réellement
  utilisable selon un modèle d'interaction proche de Notion.
- Q: La qualité Notion-like doit-elle être ajoutée rétroactivement à la feature
  003 ? → R: Non. La 003 reste la fondation livrée ; la convergence visuelle et
  interactive devient une feature V1 dédiée et vérifiable.
- Q: Une dépendance commerciale ou un service d'édition externe peut-il devenir
  obligatoire pour écrire ? → R: Non. Le parcours essentiel doit rester
  redistribuable avec l'application, auto-hébergé, utilisable hors ligne et
  remplaçable.
- Q: Deux appareils du propriétaire peuvent-ils modifier hors ligne la même
  page, voire le même paragraphe, puis se resynchroniser sans choisir une
  version complète ? → R: Oui. Les caractères, marques, blocs et déplacements
  compatibles doivent converger automatiquement, quel que soit l'ordre de
  réception ou le nombre de nouvelles tentatives.
- Q: Dans quels cas une décision manuelle reste-t-elle acceptable ? → R:
  Uniquement quand deux intentions ne peuvent pas être satisfaites ensemble,
  notamment suppression contre édition ou déplacement. Les deux intentions et
  leur contenu récupérable doivent alors rester conservés jusqu'à résolution.
- Q: Une sauvegarde du document complet reste-t-elle le chemin normal
  d'édition ? → R: Non. Chaque transaction éditoriale est d'abord durable
  localement, puis synchronisée comme mise à jour causale incrémentale. Le
  document canonique complet devient une projection vérifiée pour lecture,
  export, recherche, historique et sauvegarde.
- Q: Une longue absence autorise-t-elle le serveur à oublier un appareil encore
  autorisé ? → R: Non. Le temps seul ne doit pas invalider ses changements ;
  seule une révocation explicite permet de cesser de retenir sa frontière de
  synchronisation.

### Session 2026-08-22

- Q: La stack V1 doit-elle embarquer un serveur Draw.io ? → R: Non. Les fichiers
  `.drawio` restent des pièces jointes téléchargeables. Toute future édition de
  diagrammes vient après les fondations V1, s'exécute directement dans
  MyOwnNotion et n'ajoute ni conteneur Draw.io ni embed public.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrer dans un espace de travail focalisé (Priority: P1)

En tant que propriétaire, j'arrive dans un espace organisé autour d'une barre
latérale et d'un contenu principal. Je retrouve immédiatement mes pages, ma
recherche et l'état de mon travail sans être confronté à une succession de
panneaux techniques et de boutons permanents.

**Why this priority**: Le shell détermine chaque parcours. Tant que navigation,
création et contenu se disputent la même colonne, même un éditeur riche reste
difficile à utiliser.

**Independent Test**: Depuis un workspace contenant une hiérarchie, des
favoris et des éléments récents, ouvrir, créer, renommer, déplacer et retrouver
une page sur ordinateur puis sur un écran de 320 pixels.

**Acceptance Scenarios**:

1. **Given** un écran large, **When** le propriétaire ouvre le workspace,
   **Then** la navigation reste dans une barre latérale distincte et le contenu
   actif occupe une surface de lecture centrée sans panneau technique imposé.
2. **Given** un téléphone ou une fenêtre étroite, **When** le propriétaire
   ouvre puis referme la navigation, **Then** elle se présente comme un panneau
   adapté au toucher, rend le focus au déclencheur et ne masque plus le contenu
   après sélection.
3. **Given** une page de la hiérarchie, **When** le propriétaire la survole, la
   cible au clavier ou ouvre son menu, **Then** les actions contextuelles sont
   disponibles sans transformer chaque ligne en rangée permanente de boutons.
4. **Given** une largeur de barre latérale, des branches ouvertes et une page
   visitée, **When** le propriétaire revient dans l'application, **Then** ce
   contexte est restauré sur l'appareil.
5. **Given** une page ouverte, **When** son titre ou son emplacement change,
   **Then** l'en-tête, le fil de navigation et la barre latérale reflètent la
   même identité sans rechargement ni perte de focus.

---

### User Story 2 - Écrire et manipuler des blocs naturellement (Priority: P1)

En tant que propriétaire, je peux rester dans le texte et faire apparaître les
outils au moment où ils sont utiles : insertion à la position du curseur,
poignée sur le bloc actif, menu contextuel, barre de formatage sur la sélection
et glisser-déposer avec destination visible.

**Why this priority**: C'est le cœur de la promesse Notion-like. Une barre de
nombreux boutons au-dessus du document expose les capacités, mais ne fournit
pas une expérience d'écriture fluide.

**Independent Test**: Créer un document vide, insérer et transformer des blocs
par cinq chemins différents, en déplacer plusieurs, formater une sélection,
annuler, rétablir, recharger et comparer le document obtenu.

**Acceptance Scenarios**:

1. **Given** un bloc vide ou une position entre deux blocs, **When** le
   propriétaire utilise `/`, le bouton d'ajout, le clic droit, le clavier ou le
   glisser-déposer, **Then** le nouveau bloc apparaît à cette position et le
   focus rejoint son contenu.
2. **Given** un bloc ciblé, **When** le propriétaire utilise sa poignée,
   **Then** il peut le déplacer, le transformer, le dupliquer ou le supprimer,
   avec une alternative clavier portant les mêmes actions.
3. **Given** du texte sélectionné, **When** le propriétaire applique une mise
   en forme depuis la barre flottante, **Then** la sélection et la position de
   lecture restent stables et l'action est annulable.
4. **Given** plusieurs blocs sélectionnés, **When** le propriétaire les déplace
   ou les supprime, **Then** l'ordre relatif du groupe est préservé et une seule
   annulation restaure l'ensemble.
5. **Given** une destination interdite ou devenue indisponible, **When** un
   déplacement est tenté, **Then** le document reste inchangé et le refus est
   compréhensible.

---

### User Story 3 - Composer une page riche sans quitter l'éditeur (Priority: P1)

En tant que propriétaire, je peux composer une vraie page de connaissance avec
texte riche, listes imbriquées, tâches, citations, code, sections repliables,
encadrés, tableaux simples, liens internes, images, fichiers et contenus
intégrés, tout en conservant les garanties de fichiers et d'export existantes.

**Why this priority**: Une apparence Notion-like qui ne permettrait que les
blocs minimaux de la 003 resterait une démonstration visuelle, pas un outil de
travail V1 complet.

**Independent Test**: Produire une page contenant chaque bloc et mise en forme
obligatoire, la consulter hors ligne, l'exporter, la rouvrir sur un autre
appareil puis vérifier contenu, ordre et références.

**Acceptance Scenarios**:

1. **Given** une page, **When** le propriétaire utilise les mises en forme
   courantes, **Then** gras, italique, souligné, barré, code en ligne, liens,
   couleur de texte et surlignage peuvent coexister sans créer un contenu
   impossible à exporter.
2. **Given** un bloc, **When** il est transformé entre les types compatibles,
   **Then** son texte et ses enfants compatibles sont conservés et toute perte
   nécessaire est annoncée avant confirmation.
3. **Given** un fichier ou une image locale, **When** il est déposé ou collé
   dans la page, **Then** il suit le cycle de vie, la disponibilité hors ligne,
   les limites et les protections des fichiers existants.
4. **Given** une section repliable, une liste ou un tableau, **When** le
   propriétaire navigue uniquement au clavier, **Then** chaque contenu et
   commande reste atteignable sans piège de focus.
5. **Given** un lien interne, **When** sa cible est renommée, déplacée,
   convertie ou momentanément indisponible, **Then** l'identité canonique reste
   intacte et l'état de la cible est expliqué.

---

### User Story 4 - Reprendre exactement où le travail s'est arrêté (Priority: P1)

En tant que propriétaire, je peux quitter une longue page, naviguer ailleurs,
fermer brutalement l'application ou perdre le réseau, puis reprendre sans
chercher ma position et sans douter de la sécurité de mes modifications.

**Why this priority**: La qualité perçue ne vaut rien si elle affaiblit les
garanties local-first ou si une refonte fait mentir l'état de sauvegarde.

**Independent Test**: Modifier une page longue, mémoriser une position,
interrompre successivement la navigation, le réseau et le processus, puis
revenir et vérifier position, contenu, curseur et état de sauvegarde.

**Acceptance Scenarios**:

1. **Given** une position dans une page longue, **When** le propriétaire ouvre
   une autre page puis revient, **Then** la position précédente est restaurée
   au voisinage du même contenu sans saut tardif.
2. **Given** une modification locale non envoyée, **When** l'application est
   fermée brutalement puis relancée, **Then** la modification réapparaît et son
   état n'est jamais présenté comme synchronisé avant confirmation.
3. **Given** une perte de réseau, **When** le propriétaire continue d'écrire,
   de réordonner ou de formater des blocs disponibles localement, **Then** les
   opérations restent locales, durables et clairement en attente.
4. **Given** une écriture refusée ou un conflit, **When** l'interface se met à
   jour, **Then** la saisie en cours reste accessible et les choix de reprise
   existants ne sont pas cachés par la nouvelle présentation.

---

### User Story 5 - Travailler hors ligne sur plusieurs appareils puis converger (Priority: P1)

En tant que propriétaire, je peux emporter mon ordinateur et ma tablette sans
réseau, modifier la même page sur les deux pendant aussi longtemps que
nécessaire, puis reconnecter les appareils dans n'importe quel ordre. Les
changements compatibles se combinent automatiquement ; une décision ne m'est
demandée que lorsque mes deux intentions s'excluent réellement, et aucun texte
n'est alors perdu.

**Why this priority**: Mono-utilisateur ne signifie pas mono-appareil. Une
application local-first qui remplace une page complète ou demande de choisir
entre deux paragraphes après une longue déconnexion ne satisfait pas la
promesse V1.

**Independent Test**: Ouvrir une même page dans deux contextes navigateur
possédant chacun leur stockage et leur appareil autorisé, couper totalement le
réseau, exécuter des suites concurrentes de texte riche, insertion,
imbrication, déplacement et suppression, fermer l'un des contextes, puis les
reconnecter dans les deux ordres et comparer l'état final et l'historique.

**Acceptance Scenarios**:

1. **Given** deux appareils partis du même paragraphe, **When** l'un modifie le
   début et l'autre la fin hors ligne, **Then** le paragraphe final contient les
   deux modifications sans conflit manuel ni caractère perdu.
2. **Given** un bloc déplacé hors ligne sur un appareil et édité sur l'autre,
   **When** les appareils se reconnectent, **Then** le bloc conserve son
   identité, rejoint la position convergente et porte le texte édité ; l'édition
   ne peut pas migrer vers un bloc voisin.
3. **Given** des insertions et déplacements concurrents de blocs distincts ou
   imbriqués, **When** les mises à jour arrivent dans des ordres différents ou
   plusieurs fois, **Then** chaque appareil produit la même hiérarchie sans
   doublon ni cycle.
4. **Given** un bloc supprimé sur un appareil et édité ou déplacé sur l'autre,
   **When** les appareils se reconnectent, **Then** l'ambiguïté devient un
   conflit explicite dont la version supprimée, le contenu modifié et les deux
   intentions restent récupérables jusqu'à la décision du propriétaire.
5. **Given** un appareil autorisé fermé pendant une longue période avec des
   changements locaux, **When** il revient après de nombreux changements
   distants, **Then** il reprend automatiquement, transmet et reçoit seulement
   ce qui manque, puis converge sans expiration arbitraire de ses données.
6. **Given** une page ouverte et modifiée dans deux onglets ou sur deux
   appareils connectés, **When** une mise à jour distante arrive, **Then** elle
   s'intègre sans remplacer le brouillon local, déplacer l'édition sur un autre
   bloc ni annoncer trop tôt un état synchronisé.

---

### User Story 6 - Retrouver une application cohérente partout (Priority: P2)

En tant que propriétaire, je retrouve les mêmes règles de présentation et
d'interaction dans la recherche, les fichiers, les bases, les conflits, les
sauvegardes, la sécurité, l'installation initiale et la connexion.

**Why this priority**: Un bel éditeur entouré d'écrans techniques disparates ne
constitue pas une interface V1 qualitative.

**Independent Test**: Parcourir tous les écrans livrés, déclencher pour chacun
un état normal, vide, en chargement et en erreur, puis vérifier les mêmes
composants, la même langue, la même hiérarchie visuelle et les mêmes règles de
focus.

**Acceptance Scenarios**:

1. **Given** une action courante, **When** elle existe sur plusieurs écrans,
   **Then** son libellé, son apparence, son emplacement logique et son état
   désactivé suivent les mêmes règles.
2. **Given** un détail technique utile seulement au diagnostic, **When** le
   propriétaire utilise le parcours courant, **Then** ce détail reste derrière
   une surface secondaire et ne concurrence pas le contenu principal.
3. **Given** un thème clair, sombre ou système, **When** il est choisi, **Then**
   chaque écran et chaque menu adopte le thème sans flash illisible ni perte de
   contraste.
4. **Given** une interface réglée en français, **When** le propriétaire parcourt
   les surfaces V1, **Then** aucun fragment courant ne reste en anglais et les
   dates, nombres et raccourcis suivent la locale active.

---

### User Story 7 - Tout accomplir au clavier, au toucher et sur les navigateurs pris en charge (Priority: P1)

En tant que propriétaire, je peux utiliser les mêmes parcours essentiels au
clavier, à la souris, au toucher et avec une technologie d'assistance, quel que
soit le navigateur V1 pris en charge.

**Why this priority**: Les menus contextuels et contrôles apparaissant au
survol peuvent facilement retirer des capacités au clavier ou au toucher. Ils
ne sont acceptables que s'ils améliorent l'interface sans réduire son accès.

**Independent Test**: Exécuter les parcours de création, navigation, édition,
déplacement, recherche et résolution d'erreur sur les moteurs et largeurs pris
en charge, une fois sans pointeur puis une fois au toucher.

**Acceptance Scenarios**:

1. **Given** une branche fermée sélectionnée dans l'arbre, **When** le
   propriétaire utilise la flèche gauche sur WebKit, **Then** le focus rejoint
   son parent comme sur les autres moteurs.
2. **Given** un menu, une barre flottante ou un panneau mobile, **When** il
   s'ouvre au clavier, **Then** le focus y entre selon le motif attendu, Échap
   le ferme et le focus revient à son déclencheur.
3. **Given** un zoom à 200 %, une largeur de 320 pixels ou une préférence de
   réduction des animations, **When** le parcours cœur est exécuté, **Then**
   aucune commande ne disparaît, aucune page ne défile horizontalement et les
   animations non essentielles sont supprimées.
4. **Given** une action proposée au survol ou au clic droit, **When** aucun
   survol ni clic secondaire n'est disponible, **Then** la même action reste
   accessible au clavier et au toucher.

### Edge Cases

- Un titre, un chemin, un lien ou une ligne de code dépasse largement la
  largeur disponible.
- La hiérarchie contient des milliers d'éléments et des branches profondément
  imbriquées ; l'ouverture d'un menu ne doit pas déplacer toute la liste.
- Le document contient 500 blocs, plusieurs blocs inconnus et de grandes listes
  imbriquées.
- Une sélection traverse plusieurs types de blocs dont certains ne supportent
  pas la transformation demandée.
- Un bloc est déplacé pendant que la destination change sur un autre appareil
  ou que le réseau disparaît.
- Un menu flottant est ouvert près d'un bord, au-dessus du clavier virtuel ou
  dans un conteneur qui défile.
- Une saisie avec méthode de composition, un collage riche ou un dépôt de
  plusieurs fichiers est interrompu.
- Un média est présent dans le document mais absent, déchargé, en cours de
  transfert, refusé ou en conflit sur l'appareil courant.
- Une position de scroll enregistrée désigne un contenu supprimé ou un document
  devenu plus court.
- Deux onglets modifient la même page pendant que des contrôles contextuels sont
  ouverts.
- Deux appareils insèrent du texte au même emplacement ou appliquent des
  marques incompatibles à la même plage avant de se reconnecter.
- Un appareil déplace un bloc pendant qu'un autre déplace le même bloc, supprime
  sa destination ou édite un descendant.
- Une suppression concurrente masque un sous-arbre contenant des modifications
  qui n'ont encore jamais atteint le serveur.
- Un appareil encore autorisé revient après une longue absence alors que des
  points de contrôle ont été compactés et que le serveur a été mis à jour.
- Une restauration serveur rencontre ensuite les opérations locales plus
  récentes d'un appareil qui était hors ligne pendant la restauration.
- Une ancienne mutation de remplacement complet attend encore dans la file
  locale au moment où le protocole incrémental devient actif.
- Un client précédent comprend le document canonique mais pas le nouveau flux
  d'opérations et tente d'écrire.
- Un bloc ou une marque inconnue traverse une migration, un déplacement
  concurrent et une matérialisation du document canonique.
- Une table ou une vue structurée est plus large que le contenu principal sur
  un téléphone.
- Le thème change pendant qu'un menu ou un dialogue est ouvert.

## Requirements *(mandatory)*

### Functional Requirements

#### Workspace and navigation

- **FR-001**: L'application MUST appliquer une hiérarchie visuelle, une
  typographie, des espacements, des couleurs, des surfaces et des états
  cohérents à toutes les interfaces livrées.
- **FR-002**: Sur un écran large, le workspace MUST séparer la navigation
  latérale du contenu principal et maintenir une largeur de lecture adaptée au
  contenu courant.
- **FR-003**: Sur un écran étroit, la navigation MUST devenir un panneau
  ouvrable et refermable qui ne laisse aucun contrôle caché dans l'ordre de
  focus.
- **FR-004**: L'état ouvert, la largeur choisie, les branches dépliées et le
  dernier élément visité MUST être restaurés sur l'appareil.
- **FR-005**: Les actions d'une ligne de navigation MUST être regroupées dans
  des contrôles contextuels accessibles au pointeur, au clavier et au toucher.
- **FR-006**: Le propriétaire MUST pouvoir réordonner et déplacer une branche
  par glisser-déposer ainsi que par une alternative clavier explicite, avec une
  destination visible et sans cycle possible.
- **FR-007**: Recherche, favoris, éléments récents, réglages, sauvegardes et état
  de synchronisation MUST rester accessibles depuis la navigation sans
  concurrencer visuellement la hiérarchie principale.
- **FR-008**: Une page ouverte MUST présenter un titre éditable en place, son
  chemin et ses actions de page sans exposer ses identifiants techniques dans
  le parcours courant.
- **FR-009**: Le retour vers une page MUST restaurer sa position de lecture au
  voisinage du même contenu, avec une solution sûre si ce contenu n'existe plus.
- **FR-010**: Navigation, renommage, déplacement, conversion et ouverture d'un
  lien interne MUST conserver l'identité et le focus utile plutôt que remonter
  arbitrairement en haut de l'application.

#### Block editing

- **FR-011**: Le propriétaire MUST pouvoir insérer un bloc par commande `/`,
  clic droit, bouton d'ajout contextuel, raccourci de type Markdown et
  glisser-déposer.
- **FR-012**: Le bloc actif MUST proposer une poignée et un ajout adjacent sans
  afficher en permanence les commandes de tous les blocs.
- **FR-013**: Le glisser-déposer de blocs MUST afficher la destination exacte,
  prendre en charge le défilement automatique et préserver l'ordre et
  l'identité des blocs déplacés.
- **FR-014**: Le menu contextuel d'un bloc MUST permettre au minimum de
  transformer, dupliquer, déplacer et supprimer le bloc, avec des états
  désactivés expliqués lorsque l'action est impossible.
- **FR-015**: Une sélection de texte MUST faire apparaître une barre de
  formatage proche de la sélection sans masquer le texte ni déplacer la page.
- **FR-016**: L'éditeur MUST prendre en charge gras, italique, souligné, barré,
  code en ligne, lien externe, lien interne, couleur de texte et surlignage.
- **FR-017**: L'éditeur MUST prendre en charge au minimum paragraphes, trois
  niveaux de titres, listes à puces et numérotées, tâches, citations, code,
  séparateurs, sections repliables, encadrés, tableaux simples, images,
  fichiers et contenus intégrés autorisés.
- **FR-018**: Le propriétaire MUST pouvoir sélectionner un ou plusieurs blocs
  contigus puis les déplacer, dupliquer ou supprimer comme une seule opération
  annulable.
- **FR-019**: Toute insertion, transformation, mise en forme, imbrication,
  duplication, suppression et réorganisation MUST être annulable et
  rétablissable dans la session.
- **FR-020**: Listes, tâches et blocs compatibles MUST pouvoir être imbriqués et
  désimbriqués au clavier sans que Tab devienne un piège de focus.
- **FR-021**: Un collage riche MUST conserver uniquement les structures et
  mises en forme représentables ; toute réduction MUST préserver le texte et
  ne jamais produire un document impossible à sauvegarder.
- **FR-022**: Les liens internes MUST conserver l'identité canonique de leur
  cible et distinguer visuellement une cible active, supprimée, indisponible ou
  inconnue.
- **FR-023**: Images et fichiers insérés dans une page MUST réutiliser le cycle
  de vie, la sécurité, les limites, la déduplication et la disponibilité locale
  définis par la feature 005.
- **FR-024**: Un contenu intégré MUST être explicitement autorisé, rester
  identifiable lorsqu'il ne peut pas être chargé et ne pas exécuter de contenu
  non fiable dans le contexte privilégié de l'application.
- **FR-025**: Chaque nouveau type de bloc ou de marque MUST posséder un export
  durable, une validation, une transition de version et une conservation sûre
  par un client qui ne le comprend pas encore.

#### Local-first truth and compatibility

- **FR-026**: Les états localement modifié, en envoi, synchronisé, bloqué et en
  conflit MUST rester visibles mais discrets, et ne MUST jamais annoncer une
  confirmation distante avant qu'elle existe.
- **FR-027**: Toutes les opérations éditoriales sur un contenu disponible
  localement MUST continuer à fonctionner sans réseau et rejoindre la file
  durable existante.
- **FR-028**: Une fermeture inattendue MUST préserver les changements locaux et
  l'état nécessaire pour reprendre le parcours.
- **FR-029**: Un refus, une erreur de validation, une indisponibilité de clé ou
  un conflit MUST préserver la saisie et proposer une reprise compréhensible.
- **FR-030**: Un bloc inconnu MUST rester visible comme contenu non rendu,
  déplaçable et conservé sans modification de ses données.
- **FR-031**: Les documents existants MUST rester lisibles sans réécriture sur
  simple ouverture et ne migrer que par une transition documentée et sûre.
- **FR-032**: Lire, écrire, formater, réorganiser et sauvegarder localement une
  page MUST rester possible sans compte, licence ou service hébergé externe à
  l'installation MyOwnNotion.

#### Convergent multi-device page editing

- **FR-052**: Chaque transaction éditoriale validée par l'éditeur MUST être
  chiffrée et rendue durable sur l'appareil avant que l'interface affiche
  « enregistré localement » ; la transmission peut être groupée ensuite mais
  ne MUST jamais être la première copie durable.
- **FR-053**: Le corps d'une page MUST s'enregistrer automatiquement sans bouton
  de sauvegarde ni dépendance à la fermeture du navigateur.
- **FR-054**: Les mises à jour éditoriales MUST être incrémentales, causales,
  idempotentes et convergentes : leur duplication ou leur réception dans un
  ordre différent MUST produire le même état visible une fois le même ensemble
  de mises à jour reçu.
- **FR-055**: Des insertions, suppressions et mises en forme compatibles
  effectuées hors ligne dans le même bloc de texte MUST se fusionner à la
  granularité des caractères et des marques sans demander de choisir une
  version complète du bloc.
- **FR-056**: Chaque bloc persistant MUST conserver une identité stable dans la
  représentation opérationnelle ; une édition concurrente MUST rester attachée
  à ce bloc lorsqu'il est déplacé, réordonné ou réimbriqué ailleurs.
- **FR-057**: Insertions et déplacements concurrents de blocs ou sous-arbres
  MUST converger vers une hiérarchie ordonnée, déterministe, sans doublon et
  sans cycle, y compris lorsque le même bloc est déplacé sur plusieurs
  appareils.
- **FR-058**: Une suppression concurrente avec l'édition ou le déplacement du
  même bloc ou de son sous-arbre MUST produire une ambiguïté durable plutôt que
  supprimer silencieusement l'une des intentions. Le contenu supprimé et le
  contenu modifié MUST rester récupérables jusqu'à résolution.
- **FR-059**: Une mise à jour reçue pendant que la page est ouverte MUST
  s'intégrer sans remplacer le brouillon local, rattacher une édition à un autre
  bloc, perdre la sélection active ni imposer un rechargement complet lorsque
  l'opération est compatible.
- **FR-060**: Les onglets d'un même appareil MUST partager rapidement les mises
  à jour d'une page tout en conservant le stockage local chiffré comme garantie
  de durabilité et la même règle de convergence que deux appareils distincts.
- **FR-061**: Le remplacement du document canonique complet ne MUST plus être
  le chemin normal d'une frappe, d'une mise en forme ou d'une manipulation de
  bloc ; il reste réservé aux projections, imports, migrations et résolutions
  explicitement contrôlés.
- **FR-062**: Le serveur MUST connaître la frontière causale reçue de chaque
  appareil autorisé. Une compaction MUST conserver ce qui est nécessaire pour
  qu'un appareil encore autorisé et possédant ses données locales puisse
  converger après n'importe quelle durée d'absence ; seule sa révocation
  explicite autorise l'abandon de cette garantie.
- **FR-063**: La synchronisation éditoriale MUST posséder une version de
  protocole explicite. Un client précédent qui peut lire la projection
  canonique mais pas écrire des mises à jour compatibles MUST rester en lecture
  seule et recevoir une explication, jamais convertir implicitement son
  remplacement complet en écriture concurrente.
- **FR-064**: Un document historique MUST rester lisible sans réécriture sur
  ouverture. Son passage au modèle opérationnel MUST être paresseux, atomique,
  reprenable et vérifié au premier besoin d'écriture compatible. Cette exigence
  spécialise FR-031 pour la transition opérationnelle v3.
- **FR-065**: Une mutation historique de remplacement complet encore en attente
  au moment de la migration MUST être soit confirmée avant la bascule, soit
  convertie une fois en opérations à partir de sa base causale ; elle ne MUST
  être ni abandonnée ni rejouée après la bascule comme remplacement aveugle.
- **FR-066**: Le modèle canonique indépendant de l'éditeur MUST rester la
  projection documentée utilisée par lecture, export, recherche, relations et
  compatibilité. La représentation opérationnelle éditoriale en est l'autorité
  causale ; sa matérialisation canonique MUST être déterministe, validée et
  réparable sans former une seconde source de vérité concurrente.
- **FR-067**: Mises à jour, points de contrôle, frontières et projections MUST
  recevoir au repos les mêmes garanties de chiffrement, intégrité, rotation de
  clés, expurgation des journaux et reprise que les autres contenus privés.
- **FR-068**: Une sauvegarde MUST inclure assez d'état opérationnel, de
  frontières et de projections vérifiées pour restaurer l'historique puis
  accepter les changements d'un appareil autorisé resté hors ligne. Une
  restauration ne MUST jamais faire gagner silencieusement le serveur sur ces
  changements locaux.
- **FR-069**: L'historique visible MUST consolider les frappes en révisions
  compréhensibles plutôt que créer une entrée par caractère, tout en conservant
  la causalité nécessaire à la convergence et les deux lignées de toute
  ambiguïté explicite.
- **FR-070**: Un bloc, une propriété ou une marque inconnue MUST conserver sa
  représentation opaque, son identité et son emplacement à travers les mises à
  jour opérationnelles, la migration, la projection canonique, l'export et la
  resynchronisation.
- **FR-071**: L'état « synchronisé » d'une référence de fichier créée hors ligne
  MUST attendre à la fois l'acceptation de l'opération documentaire et la
  présence vérifiée des octets du fichier sur le serveur ; la reconnexion ne
  MUST créer ni référence orpheline ni fichier dupliqué.

#### Cohesive product experience

- **FR-033**: Boutons, champs, menus, panneaux, dialogues, onglets, tableaux,
  notifications et états MUST suivre des composants et règles communs plutôt
  que des variantes propres à chaque feature.
- **FR-034**: Identifiants, révisions, files de mutations et diagnostics bruts
  MUST être déplacés hors du parcours courant vers une surface secondaire
  lorsqu'ils restent utiles.
- **FR-035**: Toutes les surfaces présentes dans la version livrée, y compris
  bases structurées, fichiers, recherche, conflits, sauvegardes, sécurité,
  installation et connexion, MUST adopter le même système visuel et les mêmes
  motifs responsive.
- **FR-036**: L'interface MUST proposer des thèmes clair, sombre et système ; le
  choix MUST persister sur l'appareil et rester lisible avant, pendant et après
  le chargement.
- **FR-037**: Le français MUST être la langue initiale cohérente de toutes les
  surfaces V1 ; les textes, nombres, dates et raccourcis MUST être centralisés
  afin qu'une autre locale puisse être ajoutée sans modifier les données.
- **FR-038**: Toute surface asynchrone MUST distinguer chargement, vide,
  indisponible localement, hors ligne, erreur, réussite et conflit sans dépendre
  uniquement de la couleur.
- **FR-039**: Les actions destructives MUST utiliser une confirmation cohérente
  nommant l'objet, l'impact, la récupération possible et le choix sûr par
  défaut ; aucune ne MUST dépendre d'un dialogue natif non stylable.

#### Accessibility, responsiveness, and performance

- **FR-040**: Chaque parcours cœur MUST être entièrement réalisable au clavier,
  y compris menus contextuels, glisser-déposer, sélection multiple et
  réorganisation.
- **FR-041**: Les composants interactifs MUST exposer noms, rôles, états,
  annonces et focus visibles conformes à leur motif d'interaction.
- **FR-042**: Une action révélée au survol ou au clic secondaire MUST posséder
  une voie équivalente au toucher et au clavier.
- **FR-043**: L'interface MUST rester utilisable à partir de 320 pixels et à
  200 % de zoom, sans défilement horizontal de la page ni contrôle inaccessible.
- **FR-044**: Les parcours MUST fonctionner sur les deux dernières versions
  majeures stables de Chrome, Edge, Firefox et Safari, notamment le déplacement
  vers le parent par flèche gauche sur WebKit.
- **FR-045**: Contraste, taille des cibles, réduction des animations, ordre de
  focus et navigation par lecteur d'écran MUST satisfaire WCAG 2.2 AA sur les
  parcours essentiels.
- **FR-046**: Un document de 500 blocs MUST rester éditable sans blocage
  perceptible et les contrôles contextuels ne MUST pas ralentir chaque frappe.
- **FR-047**: Une hiérarchie volumineuse MUST rester navigable sans rendre en
  permanence les actions et contenus invisibles de toutes ses lignes.
- **FR-048**: L'ouverture et la fermeture d'un menu, d'un état ou d'une barre
  flottante ne MUST pas provoquer de déplacement durable du contenu ni perdre
  la sélection active.

#### Boundaries

- **FR-049**: La refonte MUST conserver le modèle canonique, les identités de
  blocs et d'items, les révisions, l'export, les garanties de chiffrement ainsi
  que le transport, l'autorisation des appareils et le rattrapage existants.
  Elle MUST remplacer explicitement le seul chemin de synchronisation du corps
  des pages qui transmet aujourd'hui un document complet.
- **FR-050**: La feature MUST uniquement présenter les capacités de bases déjà
  livrées ; elle ne MUST ajouter aucun nouveau type de propriété, moteur de
  requête ou type de vue.
- **FR-051**: La feature MUST rester strictement mono-utilisateur et ne MUST pas
  introduire présence, commentaires multi-utilisateurs, coédition entre
  identités ou assistance par IA dans le périmètre V1. Plusieurs appareils et
  onglets concurrents du même propriétaire sont explicitement dans le
  périmètre et ne constituent pas une collaboration multi-utilisateur.

### Key Entities

- **État de présentation du workspace**: préférences locales et bornées qui
  permettent de retrouver thème, largeur et visibilité de la barre latérale,
  branches ouvertes, dernier item et positions de lecture sans modifier le
  contenu canonique.
- **Sélection de blocs**: ensemble ordonné et temporaire de blocs ciblés par une
  opération commune ; il ne devient pas une nouvelle structure persistante du
  document.
- **Référence visuelle d'acceptation**: état représentatif d'un parcours sur une
  largeur et un thème donnés, approuvé pour détecter une régression de
  hiérarchie, contraste, débordement ou disposition.
- **Commande contextuelle**: action disponible autour d'une page, d'un item,
  d'un bloc ou d'une sélection, avec disponibilité, raccourci, libellé et
  conséquence explicites.
- **État opérationnel de page**: représentation causale et convergente du corps
  d'une page. Elle porte les identités, le texte riche, la hiérarchie, l'ordre,
  les suppressions et les mises à jour nécessaires pour combiner les travaux de
  plusieurs appareils du propriétaire.
- **Mise à jour éditoriale**: lot binaire ou structuré, idempotent et identifié,
  issu d'une transaction locale. Il peut être reçu plusieurs fois et dans un
  ordre différent sans modifier le résultat convergent.
- **Frontière d'appareil**: résumé causal du dernier état opérationnel connu par
  un appareil autorisé. Elle borne ce qui peut être compacté sans empêcher son
  retour.
- **Projection canonique**: document indépendant de l'éditeur, matérialisé de
  façon déterministe depuis l'état opérationnel et utilisé par les lectures,
  validations, relations, recherches, exports et sauvegardes compatibles.
- **Point de contrôle opérationnel**: état compact vérifié accompagné de sa
  frontière, utilisé pour accélérer l'ouverture, le rattrapage, l'historique et
  la restauration sans perdre les opérations encore nécessaires.
- **Ambiguïté éditoriale**: ensemble d'intentions concurrentes qui ne peuvent
  être satisfaites ensemble, par exemple supprimer et conserver le même bloc.
  Elle garde les données sources jusqu'à une résolution explicite.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propriétaire ne connaissant pas l'application crée une page,
  la renomme, insère cinq types de blocs, en déplace un et retrouve la page en
  moins de trois minutes sans documentation.
- **SC-002**: Au moins neuf participants sur dix accomplissent du premier coup
  les parcours créer, rechercher, modifier, réordonner et retrouver une page,
  puis décrivent correctement l'état de sauvegarde de leur dernière action.
- **SC-003**: Les parcours essentiels ne présentent aucune violation
  d'accessibilité critique ou sérieuse et satisfont tous les critères WCAG 2.2
  AA applicables vérifiés.
- **SC-004**: Cent pour cent des actions des parcours cœur possèdent une voie
  clavier automatisée, dont une réorganisation sans glisser-déposer.
- **SC-005**: Les mêmes parcours passent sur les moteurs desktop et mobile de
  la matrice V1, sans exception propre à WebKit pour la navigation dans l'arbre.
- **SC-006**: À 320 pixels et à 200 % de zoom, chaque écran cœur vérifie que la
  largeur de page ne dépasse pas la largeur visible de plus d'un pixel.
- **SC-007**: Sur un document de 500 blocs, 95 % des frappes deviennent visibles
  en moins de 100 ms et le document devient éditable en moins de deux secondes
  sur l'appareil de référence.
- **SC-008**: Après un aller-retour entre deux pages longues, la position est
  restaurée à moins de 50 pixels du contenu mémorisé ou sur ce contenu lui-même
  si la disposition a changé.
- **SC-009**: Sur 100 scénarios automatisés combinant interruption, hors ligne,
  déplacement, formatage et reprise, aucun bloc ni caractère confirmé
  localement n'est perdu ou annoncé à tort comme synchronisé.
- **SC-010**: Les références visuelles approuvées des écrans cœur, dans les deux
  thèmes et aux largeurs de référence, ne présentent aucune différence non
  revue lors du gate de pull request.
- **SC-011**: L'audit de copie des parcours V1 ne trouve aucun texte courant en
  anglais lorsque la locale française est active, hors contenu fourni par le
  propriétaire, noms propres et diagnostics explicitement techniques.
- **SC-012**: Créer une page depuis la position courante demande au maximum deux
  actions, insérer un bloc depuis le curseur une action ou un raccourci, et
  appliquer une mise en forme à une sélection au maximum deux actions.
- **SC-013**: Le parcours complet d'édition locale réussit avec toutes les
  communications vers des services tiers bloquées.
- **SC-014**: Aucun contrôle contextuel ne provoque un déplacement de contenu
  supérieur à un pixel après ouverture puis fermeture dans les références
  visuelles stables.
- **SC-015**: Pour 1 000 suites générées d'insertions, suppressions, marques,
  créations, imbrications et déplacements réparties sur deux appareils hors
  ligne, importer le même ensemble de mises à jour dans des ordres différents
  produit cent pour cent d'états canoniques et de hiérarchies équivalents, sans
  doublon ni cycle.
- **SC-016**: Cent scénarios où deux appareils modifient des positions
  différentes du même paragraphe hors ligne fusionnent automatiquement sans
  conflit, perte de caractère ni remplacement complet de la page.
- **SC-017**: Cent scénarios combinant déplacement d'un bloc sur un appareil et
  édition de ce bloc sur l'autre conservent cent fois l'identité, le contenu et
  une position convergente ; aucune édition n'apparaît sur un bloc voisin.
- **SC-018**: Chaque scénario suppression contre édition ou déplacement expose
  exactement une ambiguïté durable et permet de restaurer les deux intentions,
  même après redémarrage, sauvegarde et restauration.
- **SC-019**: Un appareil autorisé simulé absent pendant 90 jours et 10 000
  changements distants reprend automatiquement, converge sans conflit causé
  par son seul retard et ne duplique aucune opération locale.
- **SC-020**: Une interruption forcée après chaque frontière de persistance
  locale du parcours d'édition retrouve au redémarrage soit la transaction
  entière, soit l'état précédent ; aucun état partiel n'est annoncé comme
  enregistré.
- **SC-021**: Les documents historiques, les blocs inconnus et les fichiers
  intégrés traversent migration, synchronisation, projection, export,
  sauvegarde et restauration sans perte de données représentables ni référence
  orpheline.

## Assumptions

- La cible est une expérience propre et familière inspirée de Notion, pas une
  reproduction de sa marque, de ses icônes, de chaque pixel ni de toutes ses
  fonctions commerciales.
- Le modèle canonique indépendant de l'éditeur reste le contrat sémantique et
  d'export obligatoire. La représentation opérationnelle est l'autorité de
  causalité pour l'édition ; la conversion vers le modèle canonique est une
  projection déterministe, pas une deuxième branche éditable.
- Les fichiers intégrés utilisent la fondation 005. L'autorisation des
  appareils, le flux de changements, le rattrapage général et la file chiffrée
  utilisent la fondation 006 ; la 017 remplace seulement son écriture et sa
  fusion du corps complet des pages.
- Un appareil reste admissible à la convergence tant qu'il est autorisé et
  possède ses données locales intactes. Une longue absence peut augmenter le
  volume à rattraper mais ne transforme pas seule son travail en conflit.
- Les bases de la 009 étant déjà présentes dans la version de développement,
  elles reçoivent le système visuel commun, mais leurs capacités fonctionnelles
  ne deviennent pas pour autant une nouvelle obligation produit de la V1.
- Le thème initial suit le système lorsque le propriétaire n'a pas encore fait
  de choix explicite.
- La locale initiale est le français et les données canoniques restent
  indépendantes des libellés traduits.
- Les références visuelles sont approuvées sur des états contrôlés et sans
  donnée personnelle ; elles complètent les tests de comportement sans les
  remplacer.
- Les anciens blocs inconnus et documents hérités restent conservés même si
  leur apparence ne peut pas bénéficier de toutes les nouvelles interactions.

## Out of Scope

- Parité intégrale avec Notion, import Notion ou compatibilité avec son format.
- Coédition multi-utilisateur, présence, commentaires d'équipe et permissions
  entre plusieurs comptes.
- Curseurs partagés, avatars ou présence entre les appareils du propriétaire ;
  la convergence de contenu n'a pas besoin de simuler une équipe.
- Assistance d'écriture ou génération de contenu par IA.
- Nouveaux types de bases, propriétés, filtres ou vues au-delà de la 009.
- Graphe, tableaux blancs, partage public, annotations et MCP, qui conservent
  leurs features dédiées.
- Prévisualisation ou édition Draw.io. Les fichiers restent téléchargeables via
  la fondation 005 ; un futur moteur de diagrammes interne appartient à la
  feature tableaux blancs ou à une feature de suivi postérieure.
- Remplacement du modèle canonique par le format interne d'un moteur d'édition,
  ou utilisation du document interne complet de cet éditeur comme unité de
  synchronisation.
- Dépendance obligatoire à un service hébergé ou à une licence individuelle
  pour utiliser les parcours essentiels de l'application auto-hébergée.
