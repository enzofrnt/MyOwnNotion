# Feature Specification: Fil d’Ariane discret, onglets ouverts et vue de dossier

**Feature Branch**: `codex/022-page-tabs-folder-view`

**Created**: 2026-09-02

**Status**: In implementation

**Input**: User description: "Les éléments qui définissent où nous sommes (fil d’Ariane) doivent aller juste au-dessus de l’emoji d’une page, sans être mis en avant, et sans dépasser une longueur trop grande : si le chemin est trop long, on met des … à la place des éléments intermédiaires. En haut de la page, intégrer une gestion des onglets : lorsqu’on ouvre une page, elle apparaît tout en haut parmi toutes les pages ouvertes ; quand il y a trop de pages on peut scroller de gauche à droite pour chercher la nôtre ; chaque onglet montre l’emoji et le nom complet de la page, terminé par … s’il est trop long ; les dossiers peuvent aussi apparaître dans les onglets. Dans une page qui est un dossier, on affiche toujours à la place du contenu la liste de son contenu : on ne peut pas taper de texte, on a la liste de ses enfants sous forme de liens, dont on peut réorganiser l’ordre, et cet ordre se répercute dans l’arborescence."

## Product Direction, Dependencies, and Scope

Cette feature affine les sections 11 (pages, dossiers et hiérarchie), 12
(barre latérale et navigation) et 12.1 (frontière entre connaissance et
configuration) du canevas produit `docs/product/product-canvas.md`, et
s’appuie sur le contrat de destinations de la feature 020.

- **Direction produit** : le canevas principal reste réservé au travail de
  connaissance. Le propriétaire doit savoir où il se trouve sans que cette
  information concurrence le titre, retrouver rapidement les éléments qu’il a
  ouverts pendant sa session, et ranger le contenu d’un dossier depuis le
  dossier lui-même sans passer par la barre latérale.
- **Dépendances** : identités stables et placements ordonnés parmi les frères
  (001/004), workspace V1 avec en-tête, emoji et barre latérale (017), URL
  canonique `/notes/:itemId` comme unique source de vérité de la destination
  (020), synchronisation locale-first des placements (005/006/018).
- **Périmètre** : présentation et troncature du fil d’Ariane ; bande
  d’onglets des pages, dossiers et graphe ouverts sur l’appareil ; canevas
  d’un dossier présentant la liste réordonnable de ses enfants directs.
- **Exclusions** : onglets synchronisés entre appareils, groupes ou
  épinglage d’onglets, glisser-déposer d’un onglet vers l’arborescence,
  déplacement d’un enfant vers un autre parent depuis la vue de dossier,
  contenu éditorial pour un dossier, vues de dossier en grille ou en galerie.

### Impact sur le canevas produit

La section 12 dit aujourd’hui qu’un dossier ouvert « présente dans la zone
principale son emoji et son titre modifiables ». Cette feature étend cette
phrase : sous cette identité, le dossier présente la liste ordonnée de ses
enfants directs. Elle ajoute aussi une bande d’onglets par appareil au-dessus
du canevas. Ces deux ajouts sont reportés dans le canevas dans le même
changement que cette spécification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Savoir où l’on est sans être distrait (Priority: P1)

Le propriétaire ouvre une page rangée profondément dans l’arborescence. Juste
au-dessus de l’emoji de la page, une ligne discrète montre le chemin qui mène
à cette page. Cette ligne ne dépasse jamais une seule ligne de texte : quand
le chemin est trop long, les ancêtres intermédiaires sont remplacés par un
seul « … » qui reste consultable. Chaque ancêtre visible reste cliquable pour
remonter.

**Why this priority**: C’est la demande la plus directe et la moins risquée ;
elle corrige l’en-tête existant et conditionne la place laissée aux deux autres
histoires.

**Independent Test**: Créer une hiérarchie de six niveaux avec des titres
longs, ouvrir la feuille, vérifier que le fil d’Ariane tient sur une ligne
au-dessus de l’emoji, que « … » apparaît, qu’il révèle les ancêtres masqués,
et que cliquer un ancêtre visible ouvre bien cet ancêtre.

**Acceptance Scenarios**:

1. **Given** une page à trois niveaux de profondeur, **When** elle est ouverte,
   **Then** le fil d’Ariane apparaît immédiatement au-dessus de l’emoji (ou de
   l’emplacement de l’emoji si la page n’en a pas), dans un style atténué par
   rapport au titre, et liste ses ancêtres dans l’ordre puis la page courante.
2. **Given** une page dont le chemin complet ne tient pas sur une ligne dans la
   largeur disponible, **When** elle est ouverte, **Then** la ligne ne déborde
   pas et n’est pas coupée : le premier ancêtre et la fin du chemin restent
   visibles, les ancêtres intermédiaires sont remplacés par un unique « … ».
3. **Given** un fil d’Ariane contenant « … », **When** le propriétaire
   l’active au pointeur ou au clavier, **Then** les ancêtres masqués sont
   listés dans l’ordre et chacun peut être ouvert.
4. **Given** un fil d’Ariane visible, **When** la fenêtre est redimensionnée,
   **Then** la troncature s’adapte : des ancêtres réapparaissent quand la
   place augmente, et « … » réapparaît quand elle diminue, toujours sur une
   seule ligne.
5. **Given** une page renommée ou déplacée pendant qu’elle est ouverte,
   **When** la modification est appliquée, **Then** le fil d’Ariane reflète le
   nouveau chemin sans rechargement.
6. **Given** une page à la racine, **When** elle est ouverte, **Then** le fil
   d’Ariane ne montre que la page courante, sans « … ».

---

### User Story 2 - Retrouver les éléments ouverts pendant la session (Priority: P2)

Chaque fois que le propriétaire ouvre une page, un dossier ou le graphe, cet
élément apparaît dans une bande d’onglets en haut du canevas. L’onglet d’une
page ou d’un dossier montre l’emoji de l’élément et son titre complet, coupé
par « … » quand il est trop long. L’onglet du graphe montre l’icône de graphe
et le libellé « Graphe ».
Quand les onglets dépassent la largeur disponible, la bande défile
horizontalement pour retrouver l’onglet cherché. Le propriétaire peut passer
d’un onglet à l’autre et fermer ceux qu’il ne veut plus voir.

**Why this priority**: Cette histoire ajoute une capacité nouvelle appréciable
mais indépendante ; le workspace reste utilisable sans elle.

**Independent Test**: Ouvrir successivement quinze pages et dossiers depuis la
barre latérale et la recherche, vérifier que chacun est ajouté une seule fois
à la bande, que l’onglet actif suit l’URL, que la bande défile, que fermer un
onglet actif active un voisin, et que le rechargement de l’application
restaure la bande sur cet appareil.

**Acceptance Scenarios**:

1. **Given** aucune page ouverte, **When** le propriétaire ouvre une page
   depuis l’arbre, un favori, un récent, la recherche, un lien interne ou le
   fil d’Ariane, **Then** un onglet portant son emoji et son titre est ajouté
   au début de la bande (le plus récent d’abord) et devient l’onglet actif.
2. **Given** un élément déjà présent dans la bande, **When** il est ouvert à
   nouveau, **Then** aucun onglet supplémentaire n’est créé ; l’onglet existant
   devient actif et la bande défile pour le rendre visible.
3. **Given** un dossier ouvert, **When** il devient la destination active,
   **Then** il apparaît dans la bande exactement comme une page, avec son
   emoji ou son icône de type.
3b. **Given** le graphe ouvert, **When** il devient la destination active,
    **Then** un onglet « Graphe » est ajouté ou activé, occupe le canevas sous
    la bande, et reste présent si une page s’ouvre ensuite depuis un nœud.
4. **Given** un titre plus long que la largeur maximale d’un onglet, **When**
   l’onglet est rendu, **Then** le titre est coupé et se termine par « … », le
   titre complet restant disponible à la consultation (par exemple au survol
   ou au focus).
5. **Given** plus d’onglets que la largeur disponible, **When** le propriétaire
   fait défiler la bande horizontalement au pointeur, au toucher ou au
   clavier, **Then** tous les onglets sont atteignables et l’onglet actif
   reste identifiable.
6. **Given** un onglet actif, **When** il est fermé, **Then** l’onglet voisin
   (le suivant, sinon le précédent) devient actif et la destination change en
   conséquence ; s’il n’en reste aucun, le workspace sans sélection s’affiche.
7. **Given** un onglet non actif, **When** il est fermé, **Then** la
   destination active ne change pas.
8. **Given** plusieurs onglets, **When** le propriétaire utilise précédent ou
   suivant dans le navigateur, **Then** l’onglet correspondant à l’URL devient
   actif ; s’il avait été fermé, il est rouvert au début de la bande.
9. **Given** un élément ouvert dans un onglet, **When** il est renommé, reçoit
   un nouvel emoji ou est converti entre page et dossier, **Then** l’onglet
   reflète le changement sans rechargement.
10. **Given** un élément ouvert dans un onglet, **When** il est supprimé
    (mis à la corbeille), **Then** son onglet est retiré ; s’il était actif,
    la règle du scénario 6 s’applique.
11. **Given** une bande d’onglets, **When** l’application est rechargée sur le
    même appareil, **Then** la bande et l’onglet actif sont restaurés, sans
    rouvrir les éléments devenus indisponibles.
12. **Given** un écran étroit, **When** la bande est rendue, **Then** elle reste
    sur une ligne, défile au toucher et ne réduit pas le canevas à une colonne
    de contrôles.
13. **Given** un dossier replié dans l’arborescence et une autre destination
    active, **When** le propriétaire clique une fois sur la ligne du dossier,
    **Then** le dossier se déplie, la destination et la bande d’onglets ne
    changent pas.
14. **Given** un dossier déjà déplié et une autre destination active, **When**
    le propriétaire clique une fois sur la ligne du dossier, **Then** le
    dossier se replie, la destination et la bande d’onglets ne changent pas.
15. **Given** un dossier déjà déplié, **When** le propriétaire double-clique sa
    ligne, **Then** le dossier reste déplié, devient la destination active et
    apparaît dans la bande d’onglets.
16. **Given** un dossier replié, **When** le propriétaire double-clique sa
    ligne, **Then** le dossier se déplie, devient la destination active et
    apparaît dans la bande d’onglets.

---

### User Story 3 - Ranger le contenu d’un dossier depuis le dossier (Priority: P3)

Quand le propriétaire ouvre un dossier, le canevas ne propose aucune zone de
texte. Sous l’emoji et le titre du dossier, il voit la liste ordonnée de ses
enfants directs — pages, sous-dossiers et fichiers autonomes — chacun
présenté comme un lien vers cet élément. Il peut réordonner ces enfants, et
le nouvel ordre est celui de l’arborescence dans la barre latérale et sur ses
autres appareils.

**Why this priority**: Cette histoire change le comportement d’un canevas
existant et touche aux placements canoniques ; elle exige les mêmes garanties
de cohérence que la barre latérale.

**Independent Test**: Créer un dossier avec cinq enfants de types mêlés,
l’ouvrir, vérifier qu’aucune saisie de texte n’est possible, que les cinq
enfants apparaissent dans l’ordre de l’arbre, réordonner deux d’entre eux au
pointeur puis au clavier, et vérifier que l’arbre, un second onglet et un
second appareil montrent le même ordre.

**Acceptance Scenarios**:

1. **Given** un dossier ouvert, **When** son canevas est rendu, **Then** il
   montre son emoji et son titre modifiables, puis la liste de ses enfants
   directs dans l’ordre de l’arborescence, et aucune zone d’édition de texte.
2. **Given** un enfant listé, **When** le propriétaire l’active, **Then**
   l’élément s’ouvre par le mécanisme de navigation commun (URL, onglet, fil
   d’Ariane cohérents).
3. **Given** un dossier sans enfant, **When** il est ouvert, **Then** un état
   vide explicite, dans la langue de l’interface, remplace la liste et propose
   de créer une page ou un dossier à cet emplacement.
4. **Given** deux enfants, **When** le propriétaire déplace l’un avant ou après
   l’autre au pointeur, **Then** la liste montre le nouvel ordre immédiatement,
   et la barre latérale l’affiche identiquement sans rechargement.
5. **Given** un enfant sélectionné dans la liste, **When** le propriétaire
   utilise les actions clavier de réorganisation existantes de l’arbre,
   **Then** le résultat est identique à celui du pointeur.
6. **Given** un réordonnancement fait hors ligne, **When** la connexion
   revient, **Then** l’ordre est synchronisé selon les règles de convergence
   existantes des placements, et un conflit produit un des deux ordres, jamais
   un entrelacement.
7. **Given** un enfant ajouté, renommé, converti ou supprimé depuis la barre
   latérale ou un autre appareil, **When** la modification est reçue,
   **Then** la liste du dossier ouvert se met à jour sans rechargement.
8. **Given** un dossier converti en page pendant qu’il est ouvert, **When** la
   conversion est appliquée, **Then** le canevas passe à l’éditeur de page et
   ses enfants restent visibles dans l’arborescence.
9. **Given** une liste d’enfants, **When** elle est rendue, **Then** chaque
   ligne distingue visuellement page, dossier et fichier, et un fichier ouvre
   sa destination existante.

---

### Edge Cases

- Un titre d’ancêtre est vide (« Sans titre ») : le fil d’Ariane et l’onglet
  affichent le libellé de repli, jamais un segment vide.
- Le fil d’Ariane ne peut afficher que « … » et la page courante faute de
  place : le premier ancêtre est alors lui aussi masqué dans « … ».
- Un ancêtre masqué dans « … » est déplacé ou supprimé pendant que le menu est
  ouvert : le menu se ferme ou se met à jour, sans ouvrir une destination
  introuvable.
- La bande d’onglets restaurée référence un élément supprimé, inaccessible ou
  hors ligne et absent localement : l’onglet est retiré ou marqué indisponible
  selon la règle FR-016 de la feature 020, sans mutation.
- Deux onglets du même navigateur ouvrent des éléments différents : chacun a
  sa propre bande ; la bande n’est pas partagée entre onglets du navigateur.
- Des centaines d’onglets sont ouverts : la bande reste défilable et l’onglet
  actif atteignable ; aucune limite arbitraire ne ferme des onglets à l’insu
  du propriétaire.
- Un dossier contient plusieurs centaines d’enfants : la liste reste lisible
  et réordonnable sans figer l’interface.
- Un réordonnancement est lancé alors que le même enfant vient d’être déplacé
  vers un autre parent par un autre appareil : l’opération est refusée ou
  reprise proprement, jamais appliquée à un parent devenu faux.
- Un enfant de dossier est une entrée de base ou une base : il est listé et
  s’ouvre par sa destination canonique.
- Écran étroit : le fil d’Ariane et la bande d’onglets restent sur une ligne
  chacun ; la liste d’un dossier reste réordonnable au toucher.
- Un clic simple sur un dossier déjà déplié : il se replie et la destination
  ne change pas. Un double-clic sur ce même dossier ne le replie pas : il
  s’ouvre et reste déplié.

## Requirements *(mandatory)*

### Functional Requirements

#### Fil d’Ariane

- **FR-001**: Le fil d’Ariane d’une page ou d’un dossier MUST être rendu
  immédiatement au-dessus de l’emoji (ou de son emplacement) du canevas, dans
  un style visuellement subordonné au titre, avec un écart net avant le début
  du titre. Le libellé de type (Page / Dossier) MUST être rendu
  immédiatement sous le titre, dans le même style discret.
- **FR-002**: Le fil d’Ariane MUST lister les ancêtres dans l’ordre
  hiérarchique puis l’élément courant, et MUST NOT répéter le nom de
  l’application comme premier segment.
- **FR-003**: Le fil d’Ariane MUST tenir sur une seule ligne et MUST NOT
  dépasser la largeur de la colonne de contenu.
- **FR-004**: Lorsque le chemin complet ne tient pas, les ancêtres
  intermédiaires MUST être remplacés par un unique élément « … », en
  conservant en priorité l’élément courant, puis son parent, puis le premier
  ancêtre.
- **FR-005**: L’élément « … » MUST être activable au pointeur et au clavier et
  MUST révéler les ancêtres masqués, chacun ouvrable.
- **FR-006**: Chaque ancêtre visible MUST être ouvrable par le mécanisme de
  navigation commun ; l’élément courant MUST NOT être un lien.
- **FR-007**: La troncature MUST se recalculer au redimensionnement et après
  renommage, déplacement ou conversion d’un élément du chemin.

#### Onglets des éléments ouverts

- **FR-010**: Une bande d’onglets MUST être rendue en haut du canevas et lister
  les pages, dossiers et le graphe ouverts sur cet appareil du plus récemment
  ouvert au plus ancien (le dernier ouvert est le premier de la bande).
- **FR-011**: Toute ouverture d’un élément par le mécanisme de navigation
  commun, y compris l’ouverture du graphe, MUST ajouter un onglet s’il n’existe
  pas, sinon activer l’onglet existant ; un élément MUST NOT apparaître deux
  fois.
- **FR-012**: L’onglet actif MUST correspondre exactement à la destination
  courante (`/notes/:itemId` ou `/graph` / `/graph/:itemId`) ; une navigation
  précédent/suivant MUST activer l’onglet correspondant, en le rouvrant s’il
  avait été fermé.
- **FR-013**: Chaque onglet d’élément MUST afficher l’emoji de l’élément (ou
  son icône de type à défaut) et son titre complet ; l’onglet graphe MUST
  afficher l’icône de graphe et le libellé « Graphe ». Un titre trop long MUST
  être coupé et terminé par « … », le titre complet restant consultable. Tous
  les onglets MUST avoir la même largeur pour que le contrôle de fermeture
  reste au même endroit d’un onglet à l’autre.
- **FR-014**: Quand la somme des onglets dépasse la largeur disponible, la
  bande MUST défiler horizontalement au pointeur, au toucher et au clavier,
  sans passer sur plusieurs lignes, et MUST rendre l’onglet actif visible lors
  de son activation.
- **FR-015**: Chaque onglet MUST pouvoir être fermé au pointeur et au clavier,
  y compris par ⌘W / Ctrl+W sur l’onglet actif ; fermer l’onglet actif MUST
  activer le voisin suivant, sinon précédent, sinon conduire au workspace
  sans sélection.
- **FR-016**: Un onglet MUST refléter sans rechargement le renommage, le
  changement d’emoji et la conversion page ↔ dossier de son élément, et MUST
  être retiré quand l’élément est mis à la corbeille.
- **FR-017**: La bande et l’onglet actif MUST être restaurés sur le même
  appareil après rechargement, en écartant les éléments devenus indisponibles ;
  cet état est une préférence de présentation de l’appareil et MUST NOT être
  synchronisé ni compté comme contenu canonique.
- **FR-018**: La bande d’onglets MUST suivre les composants communs de
  l’interface et rester utilisable sur écran étroit.
- **FR-019**: Dans l’arborescence, un clic simple sur un dossier MUST le
  déplier s’il était replié et le replier s’il était déplié, sans changer la
  destination ni ajouter d’onglet. Un double-clic MUST ouvrir le dossier par
  le mécanisme de navigation commun et MUST le laisser déplié, qu’il ait été
  replié ou déjà déplié ; les deux clics du double-clic MUST NOT replier le
  dossier entre-temps. Un clic sur le chevron MUST continuer de replier ou
  déplier immédiatement sans ouvrir. Une page, un fichier ou une base MUST
  continuer de s’ouvrir au clic simple.

#### Vue d’un dossier

- **FR-020**: Le canevas d’un dossier MUST présenter, sous son emoji et son
  titre modifiables, la liste ordonnée de ses enfants directs et MUST NOT
  proposer de zone d’édition de texte.
- **FR-021**: Chaque enfant listé MUST être présenté comme un lien vers sa
  destination canonique et MUST distinguer visuellement page, dossier, fichier
  et base.
- **FR-022**: Un dossier sans enfant MUST afficher un état vide explicite
  proposant la création d’une page ou d’un dossier à cet emplacement.
- **FR-023**: Le propriétaire MUST pouvoir réordonner les enfants listés au
  pointeur, au toucher et au clavier, avec les mêmes destinations « avant » et
  « après » que la barre latérale.
- **FR-024**: Un réordonnancement depuis la vue de dossier MUST produire la
  même opération de placement que la barre latérale, de sorte que
  l’arborescence, les autres onglets et les autres appareils convergent vers
  le même ordre.
- **FR-025**: La liste MUST refléter sans rechargement toute création,
  suppression, renommage, conversion ou déplacement d’un enfant reçu depuis la
  barre latérale ou un autre appareil.
- **FR-026**: La vue de dossier MUST NOT permettre de déplacer un enfant vers
  un autre parent ni d’imbriquer un enfant sous un frère ; ces opérations
  restent à la barre latérale.
- **FR-027**: La conversion d’un dossier ouvert en page MUST basculer le
  canevas vers l’éditeur sans perdre la destination active ni les enfants.

#### Transversal

- **FR-030**: Le fil d’Ariane, les onglets et la liste d’un dossier MUST être
  atteignables au clavier avec des rôles, libellés et états annoncés aux
  technologies d’assistance.
- **FR-031**: Les parcours modifiés MUST être couverts par des tests
  unitaires/composant et de bout en bout, sur desktop et viewport étroit, dans
  les navigateurs pris en charge.

### Key Entities

- **Segment de chemin** : un ancêtre ou l’élément courant, avec son identité
  stable, son titre affiché (ou libellé de repli) et sa position dans le
  chemin ; un segment peut être visible ou regroupé dans « … ».
- **Onglet ouvert** : référence à l’identité stable d’une page, d’un dossier
  ou de la vue graphe, avec sa position dans la bande et son état actif ; un
  onglet d’élément n’a pas de titre ni d’emoji propres et lit toujours ceux de
  l’élément ; l’onglet graphe a un libellé de vue fixe.
- **Bande d’onglets** : liste ordonnée d’onglets ouverts propre à un appareil
  et à une fenêtre de l’application ; préférence de présentation, hors contenu
  canonique.
- **Enfant de dossier** : placement d’un élément (page, dossier, fichier,
  base) directement sous le dossier ouvert, avec sa position parmi ses frères ;
  cette position est la même donnée que celle de l’arborescence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pour une page à huit niveaux de profondeur avec des titres de
  quarante caractères, le fil d’Ariane occupe une seule ligne sur une colonne
  de 720 px et de 360 px, et les ancêtres masqués sont tous atteignables en au
  plus deux activations.
- **SC-002**: Ouvrir vingt éléments distincts produit exactement vingt onglets ;
  les rouvrir n’en ajoute aucun ; chacun est atteignable par défilement en
  moins de trois secondes sur écran étroit.
- **SC-003**: Après rechargement, 100 % des onglets d’éléments encore
  disponibles sont restaurés dans le même ordre, avec le même onglet actif.
- **SC-004**: Un réordonnancement depuis la vue de dossier est visible dans la
  barre latérale du même appareil en moins d’une seconde et sur un second
  appareil connecté à la prochaine synchronisation, avec un ordre identique.
- **SC-005**: Aucune saisie de texte n’est possible dans le canevas d’un
  dossier ; 100 % des enfants directs y sont listés et ouvrables.
- **SC-006**: Toutes les interactions décrites sont réalisables au clavier
  seul, et les tests automatisés d’accessibilité des parcours modifiés ne
  relèvent aucune violation.

## Assumptions

- Le fil d’Ariane omet le libellé de l’application ; le premier segment est
  l’ancêtre de premier niveau. L’en-tête existant qui affichait
  « MyOwnNotion » comme racine est remplacé par cette présentation.
- Un onglet est créé pour chaque ouverture, quelle que soit sa provenance ;
  il n’existe pas de mode « remplacer l’onglet courant ».
- La bande d’onglets est une préférence de présentation stockée sur
  l’appareil, au même titre que la largeur de la barre latérale ; elle est
  propre à chaque fenêtre ou onglet du navigateur.
- Les fichiers autonomes ne deviennent pas des onglets tant qu’ils n’ont pas
  de destination canonique propre ; ils restent ouvrables depuis la liste d’un
  dossier par leur mécanisme actuel.
- La réorganisation dans la vue de dossier réutilise les opérations de
  placement existantes de l’arborescence ; aucune nouvelle donnée canonique
  n’est introduite.
- Les libellés de repli, l’état vide et les messages suivent la langue de
  l’interface déjà en place.

## Out of Scope

- Synchronisation des onglets entre appareils ou entre fenêtres.
- Groupes, épinglage, réorganisation par glisser des onglets, raccourcis de
  cycle entre onglets au-delà des contrôles de base.
- Déplacement d’un enfant vers un autre parent, imbrication ou création de
  sous-dossiers depuis la vue de dossier.
- Contenu éditorial, description ou propriétés pour un dossier.
- Présentations alternatives de la liste d’un dossier (grille, galerie,
  aperçus).
