# Feature Specification: Graphe de connaissances V1

**Feature Branch**: `codex/010-knowledge-graph-spec`

**Created**: 2026-08-31

**Status**: In revision after product review

**Input**: User description: "Faire arriver le Knowledge graph avant la V1 et
poser ses bases dans les specs avant la convergence finale du correctif en
cours sur main."

**Product review correction (2026-09-01)**: "Le graphe doit mettre en relation
le contenu des pages au lieu de reproduire l'arborescence de fichiers, disposer
d'un corpus cohérent qui révèle un vrai réseau de connaissances et être
navigable à la souris, avec Obsidian comme référence de comportement."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 6.1, 10 à 13, 17 à 22, 28 à 31 et 42 à
47 du [canevas produit](../../docs/product/product-canvas.md). Elle déplace le
graphe de connaissances de l'après-V1 vers le périmètre obligatoire de la V1 :
la release ne peut pas être déclarée complète tant que le propriétaire ne peut
pas comprendre et parcourir les relations de son workspace.

Les fondations existantes restent propriétaires de leurs données et de leurs
garanties : identités, hiérarchie, relations et cycle de vie (001 et 004),
sécurité et chiffrement (002), navigation et édition (003 et 017), fichiers
(005), synchronisation et conflits (006 et 018), sauvegarde et restauration
(007), recherche (008) et bases/tâches structurées déjà disponibles (009). La
feature 010 fournit des backlinks et des vues dérivées de ces objets ; elle ne
crée ni modèle canonique concurrent, ni seconde façon de modifier leur vérité.

Le périmètre V1 couvre :

- les backlinks dérivés des liens internes réellement écrits dans les pages et
  les relations sortantes de l'élément courant ;
- un graphe local centré sur une page ou un autre élément canonique ;
- un graphe global et des périmètres dossier, sélection et voisinage ;
- les pages, dossiers, bases, tâches, fichiers et pièces jointes déjà
  représentables par le modèle canonique ;
- un réseau de connaissances principal formé par les liens éditoriaux et les
  relations métier explicites, avec direction, type et multiplicité ;
- les placements hiérarchiques et liens de fichier comme couches structurelles
  optionnelles, désactivées par défaut et distinctes du réseau principal ;
- des filtres combinables, une représentation non spatiale équivalente et une
  navigation au clavier et à la souris utilisable hors ligne avec un état de
  complétude honnête.

Les tableaux blancs seront ajoutés comme type de nœud et de relation par la
feature 011 lorsqu'ils existeront. Les graphes publics et les accès MCP restent
respectivement propriétaires des features 012 et 013 et ne peuvent pas élargir
implicitement la vue privée définie ici.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Comprendre les liens d'une page (Priority: P1)

En tant que propriétaire, je peux voir ce que la page courante référence et
quelles autres pages la référencent, afin de parcourir mes connaissances dans
les deux sens sans reconstruire mentalement ces connexions.

**Why this priority**: Les backlinks rendent immédiatement utiles les liens
internes déjà disponibles et constituent la base vérifiable de toutes les vues
de graphe.

**Independent Test**: Créer trois pages, écrire dans le contenu de deux pages
plusieurs liens internes vers la troisième, ouvrir chaque page, vérifier les
directions et les nombres d'occurrences, puis naviguer par les backlinks et
relations sortantes sans créer de relation depuis un écran technique séparé.

**Acceptance Scenarios**:

1. **Given** une page qui référence plusieurs éléments, **When** le
   propriétaire ouvre ses relations, **Then** les relations sortantes sont
   séparées des backlinks et affichent le titre, l'icône, le type et le nombre
   d'occurrences courants de chaque cible.
2. **Given** plusieurs liens de la même source vers la même cible, **When** la
   cible affiche ses backlinks, **Then** la source apparaît une seule fois avec
   un nombre d'occurrences exact.
3. **Given** une relation entrante ou sortante visible, **When** le propriétaire
   l'active au pointeur ou au clavier, **Then** l'identité canonique liée s'ouvre
   dans le workspace sans créer de copie ni modifier la hiérarchie.
4. **Given** une cible renommée, déplacée, convertie ou dont l'emoji change,
   **When** ses relations sont affichées, **Then** elles conservent la même
   identité et montrent sa présentation actuelle.
5. **Given** une cible placée dans la corbeille ou indisponible, **When** une
   relation survivante est consultée, **Then** son état est explicite et elle
   n'est ni redirigée ni supprimée silencieusement.
6. **Given** la suppression de la dernière occurrence d'un lien interne,
   **When** cette modification est enregistrée localement, **Then** la relation
   sortante et le backlink disparaissent ensemble sans attendre le réseau.
7. **Given** une page placée sous un dossier mais sans lien éditorial,
   **When** ses backlinks et relations de connaissance sont consultés,
   **Then** ce placement n'est pas présenté comme une référence de contenu.

---

### User Story 2 - Explorer le voisinage d'un élément (Priority: P1)

En tant que propriétaire, je peux ouvrir un graphe local autour de l'élément
courant, choisir sa profondeur et comprendre la direction des relations, afin
de découvrir rapidement le contexte utile sans être noyé dans tout le
workspace.

**Why this priority**: Le voisinage local transforme les backlinks en outil de
découverte tout en restant lisible sur un workspace volumineux.

**Independent Test**: Construire dans le contenu des pages un réseau avec liens
entrants, sortants et réciproques sur trois niveaux, le répartir dans des
dossiers sans lien avec cette topologie, ouvrir le graphe local, changer la
profondeur, le parcourir à la souris, sélectionner chaque nœud et ouvrir une
cible.

**Acceptance Scenarios**:

1. **Given** un élément courant relié à d'autres éléments, **When** le graphe
   local s'ouvre, **Then** il centre cet élément et montre son voisinage direct
   avec le type et la direction de chaque relation.
2. **Given** un réseau sur plusieurs niveaux, **When** le propriétaire augmente
   ou réduit la profondeur, **Then** seuls les niveaux demandés sont ajoutés ou
   retirés et le périmètre actif reste visible.
3. **Given** un nœud sélectionné, **When** le propriétaire consulte son détail,
   **Then** son identité, son emplacement, ses relations visibles et son état
   sont lisibles, et une action permet de l'ouvrir.
4. **Given** des relations réciproques, multiples ou de types différents entre
   deux nœuds, **When** elles sont rendues, **Then** leur sens, leur type et leur
   multiplicité restent distinguables sans dépendre uniquement de la couleur.
5. **Given** un écran étroit ou un usage au clavier, **When** le graphe local est
   exploré, **Then** la carte reste la seule représentation : Tab et les
   flèches parcourent ses nœuds, et l'inspecteur reste disponible.
6. **Given** une page possède des enfants hiérarchiques mais aucun lien de
   contenu, **When** son graphe local s'ouvre avec les réglages par défaut,
   **Then** ces enfants ne constituent pas son voisinage de connaissances.
7. **Given** la carte est utilisée à la souris, **When** le propriétaire fait
   glisser le fond, utilise la molette, survole, sélectionne puis active un
   nœud, **Then** il peut respectivement déplacer le point de vue, zoomer autour
   du pointeur y compris en deçà de 50 %, isoler visuellement les connexions
   directes, inspecter puis ouvrir la page canonique.
8. **Given** un nœud est saisi au pointeur, **When** le propriétaire le fait
   glisser, **Then** ce nœud se déplace sur la carte et le fond ne panoramique
   pas.

---

### User Story 3 - Explorer et filtrer le workspace (Priority: P1)

En tant que propriétaire, je peux explorer le graphe du workspace entier ou
d'un périmètre choisi et combiner des filtres, afin d'identifier des groupes,
des passerelles et des contenus isolés.

**Why this priority**: Le graphe devient une capacité V1 seulement s'il dépasse
la page courante et reste maîtrisable lorsque le workspace grandit.

**Independent Test**: Charger un jeu mêlant pages, dossiers, bases, tâches et
fichiers dans plusieurs branches, appliquer successivement puis conjointement
les périmètres et filtres, révéler les éléments isolés et réinitialiser la vue.

**Acceptance Scenarios**:

1. **Given** un workspace contenant plusieurs branches, **When** le propriétaire
   choisit le workspace complet, un dossier et ses descendants, une sélection
   manuelle ou le voisinage d'un élément, **Then** la vue indique clairement le
   périmètre actif et n'affiche que les éléments qui lui appartiennent.
2. **Given** un graphe hétérogène, **When** des filtres de type d'élément, type
   de relation, propriété, statut, format, date, profondeur ou branche sont
   combinés, **Then** leur intersection est visible et chaque filtre actif peut
   être retiré séparément.
3. **Given** des éléments sans relation dans le périmètre, **When** le filtre
   d'éléments isolés est activé, **Then** ces éléments deviennent repérables
   sans inventer de connexion.
4. **Given** un grand périmètre, **When** la vue initiale ne peut pas présenter
   utilement tous les nœuds à la fois, **Then** elle fournit un résumé
   progressif, des comptes honnêtes et des moyens de réduire le périmètre sans
   bloquer l'application.
5. **Given** plusieurs filtres et une sélection active, **When** le propriétaire
   réinitialise la vue, **Then** le périmètre par défaut et l'absence de filtre
   sont restaurés en une seule action sans modifier les contenus.
6. **Given** le propriétaire ouvre le graphe global pour la première fois,
   **When** aucun réglage local n'a encore été choisi, **Then** seules les
   relations de connaissance sont actives ; hiérarchie et pièces jointes sont
   disponibles comme couches nommées mais désactivées.

---

### User Story 4 - Garder un graphe fiable hors ligne et après reprise (Priority: P1)

En tant que propriétaire, je peux consulter les relations déjà présentes et
voir mes nouvelles connexions hors ligne, puis retrouver le même graphe après
reconnexion, synchronisation, sauvegarde ou restauration.

**Why this priority**: Un graphe V1 qui contredit l'éditeur local-first ou
affiche une complétude fictive affaiblirait la confiance dans les données.

**Independent Test**: Charger un sous-graphe, couper le réseau, ajouter et
retirer des liens, redémarrer, comparer backlinks et graphe, reconnecter deux
appareils puis sauvegarder et restaurer le workspace sur une installation vide.

**Acceptance Scenarios**:

1. **Given** des éléments et relations présents localement, **When** le serveur
   est indisponible, **Then** backlinks, graphe local, filtres et navigation
   restent utilisables sans prétendre couvrir les données absentes.
2. **Given** un ajout ou retrait de lien hors ligne, **When** la modification
   est confirmée localement puis l'application redémarre, **Then** le document,
   les backlinks et le graphe local reflètent ensemble cette modification.
3. **Given** deux appareils ayant modifié des relations hors ligne, **When** ils
   reçoivent ensuite le même ensemble de changements, **Then** ils convergent
   vers les mêmes nœuds, relations, directions et nombres sans doublon.
4. **Given** une sauvegarde vérifiée contenant les objets canoniques, **When**
   elle est restaurée, **Then** les backlinks et graphes reconstruits sont
   équivalents à ceux du workspace sauvegardé.
5. **Given** une projection locale incomplète, en reconstruction ou en erreur,
   **When** le propriétaire ouvre le graphe, **Then** l'état de complétude et la
   marche à suivre sont explicites ; la dernière vue valide n'est pas présentée
   comme actuelle si elle ne l'est plus.

---

### User Story 5 - Valider un redéploiement sur un workspace de démonstration (Priority: P1)

En tant que personne qui valide la release, je peux repartir d'une application
et d'un navigateur réellement propres puis charger un workspace de
démonstration riche, afin de tester le graphe dans des conditions répétables
sans confondre un défaut du nouveau code avec un cache ou des données locales
issus du déploiement précédent.

**Why this priority**: Le graphe dépend à la fois des données canoniques, de la
projection locale et du shell installé dans le navigateur. Une validation sur
un état ancien peut masquer une régression ou en inventer une ; un jeu trop
petit ne permet pas d'éprouver les filtres, les limites et les cas
relationnels de la V1.

**Independent Test**: Sur une installation locale de démonstration contenant
des données quelconques, suivre la procédure de remise à zéro, vérifier
l'absence d'état serveur et navigateur résiduel, générer le workspace de
démonstration, se connecter avec l'identifiant factice documenté, lire des
pages reliées par leur contenu puis exercer les backlinks, périmètres, couches,
filtres, isolés, cycles, multiplicités et limites.

**Acceptance Scenarios**:

1. **Given** une version précédente a été utilisée dans le navigateur, **When**
   la procédure de redéploiement propre est suivie, **Then** elle efface ou
   remplace explicitement session, données locales, caches, application
   installée et processus de fond avant de charger la nouvelle version.
2. **Given** l'installation locale contient des données de test anciennes,
   **When** la remise à zéro du workspace de démonstration est confirmée,
   **Then** données canoniques, fichiers et sauvegardes locales de démonstration
   sont supprimés ensemble et ne sont jamais mélangés au nouveau jeu.
3. **Given** une installation locale vide, **When** le jeu de démonstration est
   généré, **Then** un unique propriétaire factice avec mot de passe factice
   documenté et un workspace cohérent sont prêts sans cérémonie manuelle.
4. **Given** le workspace de démonstration, **When** son graphe est ouvert,
   **Then** il contient 240 éléments et un réseau de connaissances en forêt
   (arbres par branche, quelques passerelles), plusieurs composantes, des
   éléments isolés, cycles, relations réciproques, multiplicités, relations
   entre branches, éléments structurés, fichiers et états de cycle de vie
   permettant d'exercer chaque filtre V1.
5. **Given** le jeu vient d'être généré, **When** son contrôle de cohérence est
   exécuté ou que la génération est rejouée après une nouvelle remise à zéro,
   **Then** les nombres, catégories et invariants attendus sont identiques et
   aucun doublon ni relation orpheline n'est accepté.
6. **Given** un environnement autre que la démonstration locale explicitement
   autorisée, **When** la génération ou la remise à zéro est demandée, **Then**
   elle est refusée sans modifier les données ; aucun compte ou mot de passe
   factice n'est créé par un démarrage ou un déploiement normal.
7. **Given** le workspace de démonstration vient d'être généré, **When** une
   personne ouvre plusieurs nœuds reliés, **Then** chaque arête éditoriale est
   explicable par un lien visible dans une page au contenu lisible et cohérent.
   Les liens internes suivent surtout l'arbre de notes de chaque branche, avec
   quelques passerelles ; ils ne forment pas une pelote qui relie chaque page
   à toutes les perspectives.

### Edge Cases

- Le workspace ne contient aucune relation, uniquement des éléments isolés ou
  un seul élément.
- Un élément se référence lui-même, deux éléments se référencent mutuellement
  ou un cycle traverse plusieurs types de relation.
- Plusieurs occurrences et plusieurs types de relation relient la même paire
  d'éléments dans des sens différents.
- Un dossier est déplacé avec des milliers de descendants pendant qu'un graphe
  limité à cette branche est ouvert.
- Une page est convertie en dossier et perd son contenu éditorial pendant que
  d'autres relations vers son identité subsistent.
- Un élément est placé dans la corbeille, restauré puis supprimé définitivement
  alors que certains appareils sont hors ligne.
- Une relation inconnue issue d'une version plus récente est conservée sans
  être confondue avec un type connu ni bloquer toute la vue.
- Les titres sont identiques, vides, très longs ou changent pendant que le
  graphe est ouvert.
- Le périmètre ou les filtres ne produisent aucun nœud.
- Le nombre de nœuds visibles dépasse ce que l'écran peut présenter utilement.
- Le réseau disparaît pendant le chargement du graphe global ou sa
  reconstruction locale.
- Une sauvegarde ou un export contient les objets et relations canoniques mais
  aucune préférence locale de présentation du graphe.
- La génération de démonstration est interrompue : le contrôle ne doit jamais
  présenter un jeu partiel comme prêt à tester.
- Un ancien navigateur conserve un processus de fond, une base locale, un
  cache applicatif ou un cookie après redéploiement.
- La procédure de démonstration vise par erreur une installation distante, une
  base non locale ou un workspace qui n'est pas explicitement jetable.
- Une page mentionne exactement le titre ou un alias d'une autre page sans
  créer de lien interne : cette mention ne devient pas silencieusement une
  arête du graphe.
- Une paire d'éléments est reliée à la fois par un lien de contenu et par un
  placement hiérarchique : les deux couches restent distinguables et leur
  activation ne change pas la multiplicité du lien éditorial.
- Un déplacement de dossier change toute l'arborescence sans modifier les
  liens écrits dans les pages : le réseau de connaissances principal reste
  identique.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La V1 MUST fournir au propriétaire authentifié des backlinks, un
  graphe local et un graphe global privés.
- **FR-002**: Toute vue de graphe MUST être dérivée des objets, contenus,
  relations et, lorsqu'elles sont demandées, connexions structurelles
  canoniques ; elle MUST être reconstruisible et ne MUST jamais devenir une
  seconde source de vérité éditable.
- **FR-003**: Le graphe V1 MUST représenter les pages, dossiers, bases, tâches,
  fichiers et pièces jointes présents dans son périmètre sans dupliquer leur
  identité canonique.
- **FR-004**: Les relations MUST conserver au minimum leur source, leur cible,
  leur direction, leur type, leur disponibilité et leur multiplicité lorsqu'un
  résumé agrège plusieurs occurrences.
- **FR-005**: Renommer, déplacer, réordonner, convertir ou changer l'icône d'un
  élément MUST préserver son nœud et ses relations par identité stable.
- **FR-006**: Les occurrences répétées d'une même relation source-cible-type
  MUST être agrégées pour la lecture avec un nombre exact, sans perdre les
  occurrences canoniques qui expliquent ce nombre.
- **FR-007**: Une modification canonique confirmée localement MUST mettre à jour
  de façon cohérente la projection relationnelle, les backlinks et le graphe ;
  aucun état accepté ne peut ne modifier qu'une partie de ces vues.
- **FR-008**: La corbeille, la restauration et la suppression définitive MUST
  produire des états explicites et cohérents : une cible survivante n'est
  jamais redirigée, une cible restaurée retrouve son identité, et une identité
  définitivement supprimée ne reste pas présentée comme active.
- **FR-009**: Le workspace MUST offrir une destination dédiée au graphe global
  et un accès contextuel aux relations et au graphe local de l'élément courant.
- **FR-010**: Les backlinks et relations sortantes MUST être présentés
  séparément et regroupés par élément lié, avec direction, type, présentation
  actuelle, disponibilité et nombre d'occurrences.
- **FR-011**: Activer un nœud ou une entrée relationnelle active MUST ouvrir la
  même identité canonique dans le workspace, l'ajouter à la bande d'onglets
  comme une page, et préserver l'onglet du graphe pour y revenir.
- **FR-012**: Les libellés et icônes visibles MUST refléter l'état courant de la
  cible sans rendre leur ancienne valeur indépendante ou éditable dans le
  graphe.
- **FR-013**: Le graphe MUST proposer au minimum les périmètres workspace
  complet, dossier et descendants, élément et voisinage, et sélection manuelle.
- **FR-014**: Le voisinage MUST permettre de choisir une profondeur de un à
  trois niveaux et MUST rendre cette profondeur active visible.
- **FR-015**: Les filtres MUST couvrir les types d'élément et de relation, les
  pièces jointes, formats, propriétés, statuts, branches, profondeurs, dates et
  éléments isolés lorsque ces dimensions existent dans le périmètre.
- **FR-016**: Les filtres MUST être combinables, retirables individuellement et
  réinitialisables en une action. Ils MUST être présentés dans un panneau que
  le propriétaire révèle à la demande ; un indicateur MUST rester visible tant
  qu'un filtre autre que le défaut est actif.
- **FR-017**: Afficher les éléments isolés MUST être un choix explicite et MUST
  ne créer aucune relation artificielle.
- **FR-018**: La direction, le type, la multiplicité, la sélection et les états
  de disponibilité MUST rester compréhensibles sans dépendre uniquement de la
  couleur, de la position ou d'une animation.
- **FR-019**: Sélectionner un nœud MUST afficher une synthèse actionnable de son
  identité, son emplacement, son état et ses relations visibles sans modifier
  le contenu.
- **FR-020**: Le graphe MUST s'afficher uniquement comme carte. Le clavier
  MUST parcourir les nœuds de cette carte. Il MUST NOT exister de
  représentation liste parallèle.
- **FR-021**: La vue visuelle MUST fournir des actions explicites pour zoomer,
  déplacer le point de vue, recentrer, ajuster les éléments visibles et revenir
  au périmètre initial.
- **FR-022**: Une projection locale disponible MUST permettre de consulter et
  parcourir hors ligne ses backlinks, relations et sous-graphes sans requête
  réseau obligatoire.
- **FR-023**: La vue MUST distinguer un résultat complet, localement partiel,
  en cours de reconstruction, obsolète ou indisponible et MUST expliquer la
  portée manquante sans révéler de contenu sensible.
- **FR-024**: Ajouter ou retirer une relation hors ligne MUST survivre à un
  arrêt brutal après confirmation locale et réapparaître une seule fois dans
  chaque vue dérivée au redémarrage.
- **FR-025**: La synchronisation et les nouvelles tentatives MUST être
  idempotentes et MUST empêcher les doublons de nœuds, relations agrégées,
  backlinks ou comptes d'occurrences.
- **FR-026**: Des appareils autorisés recevant le même ensemble de changements
  MUST converger vers des graphes sémantiquement équivalents, indépendamment de
  l'ordre de réception.
- **FR-027**: Les périmètres, filtres, nœuds sélectionnés et réglages visuels
  MUST être des préférences de présentation bornées à l'appareil et MUST ne pas
  modifier les objets ou relations canoniques.
- **FR-028**: Les données et index locaux ou serveur nécessaires au graphe MUST
  respecter les mêmes exigences de chiffrement, sauvegarde, restauration,
  rétention et effacement que leurs sources.
- **FR-029**: Aucun graphe privé, backlink, titre, requête de filtre ou détail
  relationnel ne MUST être accessible sans la session du propriétaire ni
  apparaître dans les journaux, diagnostics ou erreurs non expurgés.
- **FR-030**: Les exports et sauvegardes MUST conserver les objets et relations
  canoniques nécessaires à la reconstruction, sans rendre obligatoire la
  conservation d'une disposition visuelle locale.
- **FR-031**: Après restauration ou migration, le graphe MUST pouvoir être
  reconstruit et vérifié par comparaison des identités, directions, types,
  disponibilités et multiplicités attendues.
- **FR-032**: Une relation inconnue mais valide MUST être conservée et présentée
  comme type non reconnu sans perte ; une relation invalide MUST être isolée et
  signalée sans corrompre le reste du graphe.
- **FR-033**: Sur le jeu de référence V1, le graphe global MUST fournir
  progressivement une première vue utile et MUST borner le nombre d'éléments
  rendus simultanément plutôt que bloquer l'interface ou tronquer silencieusement
  les données.
- **FR-034**: Les parcours essentiels du graphe MUST rester utilisables au
  clavier, à 320 pixels de large, à 200 % de zoom et avec réduction des
  animations, sans défilement horizontal de la page entière.
- **FR-035**: L'interface française MUST employer des termes cohérents pour
  nœud, relation, backlink, direction, profondeur, périmètre, filtre et état de
  complétude.
- **FR-036**: Une erreur de chargement, de projection ou de reconstruction MUST
  conserver la dernière donnée canonique valide, proposer une reprise sûre et
  ne MUST jamais être présentée comme un graphe complet à jour.
- **FR-037**: La feature MUST fournir une procédure versionnée et vérifiable de
  redéploiement propre couvrant séparément l'état serveur, la session, le
  stockage local du navigateur, les caches, l'application installée et ses
  processus de fond.
- **FR-038**: Un workspace de démonstration MUST pouvoir être créé uniquement
  dans un environnement local explicitement jetable avec un propriétaire et
  un mot de passe factices clairement documentés ; ce comportement MUST être
  absent et refusé dans tout démarrage ou déploiement normal.
- **FR-039**: Le jeu de démonstration MUST contenir 240 éléments et un réseau
  relationnel cohérent en forêt : arbres de notes par branche, quelques
  passerelles, plus des relations métier. Il MUST couvrir les types de nœud
  disponibles, plusieurs composantes, isolés, cycles, réciprocité,
  multiplicité, liens entre branches, propriétés, statuts, dates, pièces
  jointes, relations inconnues valides et états de cycle de vie.
- **FR-040**: La remise à zéro de démonstration MUST demander une intention
  explicite, annoncer précisément la cible et supprimer ensemble les données
  de démonstration serveur, fichiers et sauvegardes ; elle MUST refuser une
  cible distante, ambiguë ou non jetable.
- **FR-041**: La génération de démonstration MUST être répétable et vérifiée :
  un jeu n'est déclaré prêt que si ses nombres attendus, l'unicité du
  propriétaire, l'authentification factice, les extrémités de relation et les
  catégories de couverture sont tous valides.
- **FR-042**: Le graphe de connaissances principal MUST utiliser par défaut les
  liens internes issus du contenu des pages et les relations métier explicites ;
  un placement hiérarchique ou une pièce jointe ne MUST pas devenir une arête
  de connaissance par défaut.
- **FR-043**: La hiérarchie et les pièces jointes MUST être proposées comme des
  couches structurelles nommées, indépendamment activables et visuellement
  distinguables des relations de connaissance.
- **FR-044**: Une mention textuelle non liée ou une ressemblance calculée entre
  contenus ne MUST pas créer automatiquement une relation canonique ni une
  arête présentée comme certaine en V1.
- **FR-045**: Sur une interface à pointeur, le propriétaire MUST pouvoir faire
  glisser le fond pour déplacer la carte. La molette, le pinch trackpad et le
  glissement deux doigts d'avant en arrière MUST zoomer autour du pointeur,
  en conservant sous le pointeur la zone visée, et MUST NOT panoramiquer. Un
  geste trackpad horizontal MUST être ignoré. L'inertie du défilement après
  relâchement MUST NOT continuer à zoomer. Seul le glisser du fond déplace
  la vue.
- **FR-046**: Le survol d'un nœud MUST mettre en évidence ce nœud, ses relations
  directes et ses voisins ; la sélection MUST révéler son détail et une action
  au pointeur MUST ouvrir son identité canonique sans passer par
  l'arborescence.
- **FR-047**: Le corpus de démonstration MUST contenir des pages lisibles
  rangées en arbre (dossier, vue d'ensemble, sections, notes filles). Les
  liens internes visibles MUST suivre surtout cette outline, avec quelques
  passerelles entre branches, afin que le graphe de connaissances ressemble à
  un workspace réel plutôt qu'à une grille dense.
- **FR-048**: La proéminence visuelle d'un nœud MUST refléter de façon bornée le
  nombre de pages qui le référencent afin de rendre les hubs repérables sans
  masquer les nœuds moins connectés.
- **FR-049**: Ouvrir le graphe global ou le voisinage d'un élément MUST ajouter
  un onglet dédié à la bande d'onglets du canevas, ou activer l'onglet existant
  s'il est déjà ouvert ; cet onglet MUST rester dans la bande lorsqu'une page
  s'ouvre depuis un nœud.
- **FR-050**: Tant que le graphe est l'onglet actif, la carte MUST occuper tout
  l'espace du canevas sous la bande d'onglets, sans en-tête de document ni
  colonne permanente de contrôles.
- **FR-051**: Les filtres, le périmètre, les couches et le détail d'un nœud
  MUST apparaître uniquement lorsque le propriétaire les demande, en
  superposition de la carte, et MUST pouvoir être refermés sans quitter le
  graphe.
- **FR-052**: Faire glisser un nœud MUST le déplacer sur la carte sans
  panoramiquer le fond. La molette MUST pouvoir dézoomer sans plancher afin de
  voir l'ensemble ; seul le zoom avant reste borné. Les messages de couverture
  et de vue bornée, ainsi que l'ajustement du point de vue, MUST rester
  disponibles derrière un contrôle d'information, pas comme un bandeau ou une
  barre permanente.
- **FR-053**: Sur la carte, une simulation de forces vivante MUST positionner
  les nœuds comme un graphe dirigé par les forces (centre, répulsion, liaison,
  distance). Ces quatre paramètres MUST être réglables, persistés comme
  préférence d'appareil, et un glisser de nœud MUST échauffer la simulation
  pour que le voisinage suive. Avec réduction des animations, la simulation
  MUST se figer après un nombre borné d'itérations.

### Key Entities

- **Nœud de graphe**: représentation reconstruisible d'un élément canonique,
  avec son identité stable, son type, sa présentation courante, son état de
  cycle de vie et ses comptes relationnels.
- **Relation de connaissance**: connexion orientée et explicable entre deux
  identités, issue d'un lien visible dans un contenu ou d'une relation métier
  délibérée ; elle forme le réseau principal.
- **Connexion structurelle**: placement parent-enfant ou rattachement de
  fichier utile pour situer un élément, mais affiché seulement dans une couche
  optionnelle et jamais confondu par défaut avec une relation de connaissance.
- **Relation canonique**: occurrence source de l'une de ces connexions,
  conservant sa source, sa cible, son type et son origine.
- **Relation agrégée**: résumé de lecture regroupant des occurrences de même
  source, cible et type, avec une multiplicité exacte ; ce résumé n'est pas une
  nouvelle relation éditable.
- **Résumé de backlink**: agrégation des relations qui ciblent l'élément
  courant, distincte de ses relations sortantes.
- **Périmètre de graphe**: règle explicite déterminant les identités candidates
  — workspace, branche, voisinage ou sélection — avant application des filtres.
- **Filtre de graphe**: contrainte de présentation combinable qui réduit la vue
  sans modifier les données sources.
- **État de complétude**: indication expliquant si la vue couvre tout son
  périmètre ou seulement les données disponibles localement.
- **État de présentation**: préférences propres à l'appareil, telles que le
  périmètre récent, les filtres, la profondeur, la sélection et le point de vue.
- **Workspace de démonstration**: installation locale jetable et reproductible,
  avec identité factice et contenu cohérent conçu pour exercer les parcours et
  limites du graphe sans devenir une donnée de production.
- **État navigateur de démonstration**: ensemble de la session, des données
  locales, caches, application installée et processus de fond qui doivent être
  remis à zéro pour garantir qu'un redéploiement est réellement testé.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propriétaire ouvre les backlinks d'une page, identifie la
  source la plus référente et l'ouvre en moins de 15 secondes sans documentation.
- **SC-002**: Les backlinks et relations sortantes donnent des identités,
  directions, types et nombres exacts dans 100 % des jeux couvrant doublons,
  cycles, relations réciproques, corbeille, restauration et suppression finale.
- **SC-003**: Un voisinage de deux niveaux contenant jusqu'à 500 nœuds devient
  sélectionnable et filtrable en moins d'une seconde dans au moins 95 % des
  mesures sur l'appareil de référence.
- **SC-004**: Sur le jeu V1 de 100 000 pages et 100 000 relations, le graphe
  global fournit une première vue utile ou un résumé progressif en moins de
  deux secondes dans au moins 95 % des mesures, sans blocage de plus de 100 ms.
- **SC-005**: Les périmètres workspace, branche, voisinage et sélection, ainsi
  que chaque combinaison de filtres d'acceptation, produisent exactement les
  nœuds et relations attendus dans 100 % des fixtures déterministes.
- **SC-006**: Cent parcours ajout hors ligne, redémarrage et reconnexion
  produisent chacun exactement une relation, un résumé sortant et un backlink,
  sans perte ni doublon.
- **SC-007**: Mille scénarios générés répartissant ajouts, retraits,
  renommages, déplacements, conversions et restaurations entre deux appareils
  convergent vers des ensembles de nœuds et relations sémantiquement identiques.
- **SC-008**: Cent restaurations d'un jeu de référence reconstruisent 100 % des
  identités, directions, types, disponibilités et multiplicités attendues.
- **SC-009**: Toutes les actions essentielles — changer de périmètre, filtrer,
  sélectionner, inspecter, recentrer et ouvrir — possèdent un parcours clavier
  automatisé avec focus visible.
- **SC-010**: À 320 pixels et à 200 % de zoom, les parcours backlinks, graphe
  local et graphe global ne dépassent la largeur visible de la page de plus
  d'un pixel et restent utilisables sur la carte.
- **SC-011**: Sur dix essais guidés uniquement par l'interface, au moins neuf
  participants identifient correctement un groupe fortement relié, un élément
  passerelle et un élément isolé en moins de trois minutes.
- **SC-012**: Une réinitialisation retire 100 % des filtres et revient au
  périmètre par défaut en une action dans tous les parcours automatisés.
- **SC-013**: Les contrôles de confidentialité ne trouvent aucun titre,
  contenu, requête de filtre ou détail de relation privé dans les journaux,
  diagnostics, erreurs et artefacts de test expurgés.
- **SC-014**: Une personne suivant uniquement la procédure documentée passe
  d'un ancien redéploiement à un navigateur propre, un workspace de
  démonstration prêt et une session ouverte en moins de cinq minutes.
- **SC-015**: Dix remises à zéro suivies d'une génération produisent chacune
  exactement le même nombre d'éléments, d'occurrences relationnelles, de
  branches, de composantes et de cas spéciaux, sans extrémité orpheline.
- **SC-016**: Cent tentatives d'exécuter la génération contre une cible non
  locale ou non explicitement jetable sont refusées avant toute modification.
- **SC-017**: Le contrôle du jeu de démonstration prouve à chaque génération la
  présence de 100 % des catégories exigées par FR-039 et refuse de déclarer
  prêt tout jeu incomplet.
- **SC-018**: Dans 100 % des jeux où l'arborescence et les liens de contenu
  décrivent des topologies différentes, la vue initiale et le voisinage local
  reproduisent exactement la topologie des liens de contenu et restent
  inchangés après un déplacement purement hiérarchique.
- **SC-019**: Dix parcours au pointeur permettent chacun de déplacer la carte,
  zoomer sur une zone choisie, identifier le voisinage direct d'un nœud et
  ouvrir une page reliée en moins de 20 secondes sans utiliser
  l'arborescence ni le clavier.
- **SC-020**: Dans le workspace de démonstration, 100 % des arêtes éditoriales
  échantillonnées renvoient à un lien visible dans le contenu source ; les
  notes connectées forment une forêt d'arbres par branche, pas un graphe
  unique illisible.

## Assumptions

- Le graphe V1 est privé et réservé au propriétaire authentifié.
- Les liens internes et relations canoniques déjà disponibles sont la
  fondation du graphe ; cette feature ajoute leur lecture relationnelle et leur
  exploration, pas une nouvelle syntaxe de lien obligatoire.
- La vue graphe d'Obsidian sert de référence comportementale pour le rôle des
  liens internes, le graphe local, le survol, le clic, le déplacement et le
  zoom ; la présentation visuelle n'est pas copiée.
- Une arête certaine de la V1 doit rester explicable par une action délibérée du
  propriétaire. La détection de mentions non liées ou de similarités peut
  devenir une suggestion séparée plus tard, jamais une relation silencieuse.
- Les types livrés par la feature 009 peuvent apparaître comme nœuds et
  relations lorsqu'ils sont présents, sans que la feature 010 redéfinisse les
  capacités de bases de données ou de tâches.
- Les positions calculées des nœuds n'ont pas de valeur canonique. Leur
  conservation éventuelle sur un appareil reste une préférence réinitialisable.
- Les types de relation inconnus utilisent une présentation générique jusqu'à
  ce qu'un client compatible sache les nommer.
- Les éléments actifs sont visibles par défaut ; la corbeille et les éléments
  isolés sont révélés par des choix explicites lorsque le contexte le permet.
- La convergence finale de la feature 017 intégrera les surfaces du graphe au
  système visuel V1 sans déplacer les exigences métier de la feature 010.
- Le workspace de démonstration est une aide jetable de développement et de
  validation ; son mot de passe est public par conception, ne protège aucune
  donnée réelle et ne constitue jamais une valeur par défaut de production.

## Out of Scope

- Créer, modifier ou supprimer directement des relations canoniques en tirant
  des arêtes dans le graphe ; elles restent créées par leurs parcours métier.
- Disposition manuelle persistante, carte libre, dessin, connexion visuelle
  éditable ou comportement de tableau blanc — feature 011.
- Graphes publics, navigation d'un visiteur et annotations — feature 012.
- Lecture ou mutation du graphe par un client MCP — feature 013.
- Graphe multi-utilisateur, présence, curseurs partagés ou collaboration entre
  plusieurs identités.
- Vue tridimensionnelle, réalité augmentée, recommandations automatiques,
  embeddings, regroupement, liens sémantiques inférés ou génération assistés
  par IA.
- Transclusion du contenu d'une page dans une autre et édition depuis le graphe.
- Reproduction exacte de la présentation d'un produit tiers.
