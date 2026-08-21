# Feature Specification: Bases de données et tâches structurées

**Feature Branch**: `codex/009-databases-structured-tasks`

**Created**: 2026-08-20

**Status**: Implémentée et validée localement ; pull request #125 ouverte et
correction du démarrage CI validée

**Input**: User description: "Poursuivre la trajectoire produit avec la feature
009 : propriétés typées, relations, filtres, tris, vues table, Kanban, galerie,
liste et calendrier, ainsi que des tâches structurées proches de Notion."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 6.2, 10, 13, 14, 17 à 22, 27 à 33 et
42 à 43 du [canevas produit](../../docs/product/product-canvas.md). Elle ouvre la
phase 4 après la livraison des fondations V1 001 à 008.

Les fondations existantes restent propriétaires de leurs responsabilités :
identités, révisions, hiérarchie, export et cycle de vie (001), chiffrement et
propriétaire unique (002), pages et édition par blocs (003), conversion des
items (004), fichiers et disponibilité locale (005), synchronisation et
conflits (006), sauvegarde et restauration (007), recherche (008). La 009 ajoute
un modèle structuré et des vues sur ces identités ; elle ne crée ni une seconde
hiérarchie, ni une seconde source de vérité, ni un moteur de synchronisation
parallèle.

Une entrée de base de données est une page canonique. Elle conserve la même
identité, le même document éditorial, le même historique et les mêmes garanties
qu'une autre page, auxquels s'ajoutent son appartenance à une base et ses
valeurs de propriétés. Une tâche structurée est une telle page d'entrée avec
des propriétés reconnues pour le statut, l'échéance et la priorité. Elle n'est
pas un objet concurrent. Les simples cases à cocher dans le texte restent des
blocs d'éditeur et ne deviennent pas automatiquement des tâches structurées.

Une base peut posséder plusieurs vues enregistrées sur les mêmes entrées. Les
vues changent la présentation, le filtrage, le tri et le regroupement ; elles
ne copient pas les pages et ne modifient pas leur identité. Cette livraison
couvre les bases ouvertes comme des éléments du workspace. Les vues liées ou
intégrées dans une autre page sont différées afin de ne pas confondre le modèle
structuré avec l'évolution visuelle de l'éditeur préparée dans la feature 003.

Le produit reste strictement mono-utilisateur. Toutes les bases, propriétés,
vues et tâches de cette feature sont privées et accessibles au propriétaire
authentifié. Les futures surfaces publiques et MCP devront appliquer leurs
propres projections autorisées.

## Clarifications

### Session 2026-08-20

- Q: La feature 009 doit-elle traduire seule ses nouvelles surfaces en français
  alors que la langue active de l'application est encore l'anglais ? → R: Non.
  Une langue partielle rendrait l'expérience incohérente. La 009 prépare toutes
  ses copies et tous ses formats pour suivre la langue active de l'application ;
  le passage au français reste un changement transversal de release couvrant
  l'ensemble du produit en une seule expérience cohérente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Structurer une collection de pages (Priority: P1)

En tant que propriétaire, je peux créer une base, définir les propriétés dont
j'ai besoin et créer des entrées qui restent de vraies pages éditables.

**Why this priority**: Sans schéma typé ni entrée-page, aucune vue ou tâche
structurée n'a de fondation fiable. Cette story apporte déjà un registre
personnel utile, même avant les présentations avancées.

**Independent Test**: Créer une base de projets, ajouter une propriété de chaque
type obligatoire, créer plusieurs entrées, modifier leurs valeurs puis ouvrir
une entrée et éditer son contenu comme une page ordinaire.

**Acceptance Scenarios**:

1. **Given** un emplacement du workspace, **When** le propriétaire crée une
   base et lui donne un nom, **Then** elle apparaît dans la navigation avec une
   identité stable et une première vue utilisable.
2. **Given** une base, **When** le propriétaire ajoute des propriétés texte,
   nombre, date, statut, sélection, sélection multiple, case à cocher et
   relation, **Then** chacune accepte uniquement des valeurs conformes à son
   type et explique un refus sans perdre la saisie en cours.
3. **Given** une base, **When** le propriétaire crée une entrée, **Then** cette
   entrée possède un titre, peut recevoir les propriétés de la base et s'ouvre
   comme une page éditoriale ordinaire.
4. **Given** une même entrée visible dans plusieurs vues de la base, **When**
   son titre, son contenu ou une propriété change, **Then** toutes les vues
   reflètent la même identité et la même version sans copie.
5. **Given** une propriété relation, **When** le propriétaire sélectionne une
   page active du workspace, **Then** la valeur conserve l'identité canonique
   de la cible et reste valide après son renommage ou son déplacement.
6. **Given** une propriété contenant des valeurs, **When** le propriétaire
   demande à la supprimer ou à changer son type, **Then** l'interface présente
   l'impact et empêche toute perte silencieuse des valeurs incompatibles.

---

### User Story 2 - Retrouver une organisation enregistrée (Priority: P1)

En tant que propriétaire, je peux créer des vues table ou liste, combiner des
filtres, des tris et des regroupements, puis retrouver exactement cette
organisation lors de ma prochaine ouverture et sur mes autres appareils.

**Why this priority**: La valeur d'une base ne vient pas seulement de ses
colonnes, mais de la possibilité de revoir rapidement le même sous-ensemble
ordonné sans reconstruire la requête à chaque visite.

**Independent Test**: Sur une base contenant des valeurs variées, enregistrer
plusieurs vues table et liste avec des combinaisons différentes, fermer puis
rouvrir l'application et comparer les entrées, l'ordre et les groupes obtenus.

**Acceptance Scenarios**:

1. **Given** une base peuplée, **When** le propriétaire crée une vue table ou
   liste, **Then** il peut la nommer, choisir les propriétés visibles et
   réordonner leur présentation sans modifier les entrées.
2. **Given** plusieurs critères, **When** le propriétaire choisit de satisfaire
   tous les critères ou au moins l'un d'eux, **Then** la règle est visible,
   modifiable, réinitialisable et produit un résultat stable.
3. **Given** plusieurs tris, **When** ils sont appliqués dans un ordre choisi,
   **Then** les égalités utilisent un départage stable et aucun item ne saute ou
   ne se duplique entre deux affichages identiques.
4. **Given** une propriété compatible, **When** le propriétaire groupe une vue,
   **Then** chaque entrée apparaît dans un seul groupe explicite et les valeurs
   absentes restent accessibles dans un groupe dédié.
5. **Given** une vue enregistrée, **When** un autre appareil compatible la
   reçoit, **Then** il affiche les mêmes critères, le même ordre, les mêmes
   groupes et le même résultat pour le même état canonique.
6. **Given** une propriété masquée dans une vue, **When** elle est modifiée dans
   une autre vue ou dans la page d'entrée, **Then** sa valeur est conservée et
   la vue masquée ne la supprime pas.

---

### User Story 3 - Suivre des tâches structurées (Priority: P1)

En tant que propriétaire, je peux créer des tâches qui sont aussi des pages,
leur attribuer un statut, une échéance, une priorité et des relations, puis les
faire progresser sans séparer leurs notes de leur suivi.

**Why this priority**: Les tâches structurées sont l'un des usages principaux
annoncés pour les bases. Elles doivent réutiliser le modèle de page au lieu de
créer une liste parallèle difficile à relier, rechercher et sauvegarder.

**Independent Test**: Créer une base de tâches, créer une tâche avec chaque
champ sémantique, écrire des notes dans sa page, la faire passer entre plusieurs
statuts et vérifier son échéance dans les vues concernées.

**Acceptance Scenarios**:

1. **Given** une base, **When** le propriétaire active son usage pour les
   tâches, **Then** il associe explicitement des propriétés compatibles au
   statut, à l'échéance et à la priorité sans dupliquer les données.
2. **Given** une tâche structurée, **When** le propriétaire l'ouvre, **Then** il
   peut éditer son contenu par blocs et ses propriétés dans le même parcours.
3. **Given** une tâche, **When** son statut, son échéance ou sa priorité change,
   **Then** toutes les vues et la recherche reflètent la nouvelle valeur sans
   changer l'identité de la page.
4. **Given** une tâche reliée à un projet ou une autre page, **When** la cible
   est renommée ou déplacée, **Then** la relation reste résolue vers la même
   identité.
5. **Given** une case à cocher dans le corps d'une page, **When** elle est
   cochée ou décochée, **Then** elle reste un bloc local au document et aucune
   tâche structurée n'est créée implicitement.
6. **Given** une tâche placée dans la corbeille puis restaurée, **When** les
   vues sont recalculées, **Then** elle disparaît puis retrouve ses propriétés,
   ses relations et son contenu sans ancienne copie résiduelle.

---

### User Story 4 - Changer de perspective sans dupliquer les données (Priority: P2)

En tant que propriétaire, je peux afficher une même base en Kanban, galerie ou
calendrier pour planifier visuellement selon le contexte.

**Why this priority**: Ces vues rapprochent l'expérience de la cible Notion,
mais elles dépendent du schéma, des entrées et des règles enregistrées livrés
par les stories précédentes.

**Independent Test**: Créer une vue de chaque type sur la même base, déplacer
une carte Kanban, modifier une date depuis le calendrier et ouvrir une carte de
galerie, puis vérifier l'unicité et les valeurs de l'entrée dans toutes les
vues.

**Acceptance Scenarios**:

1. **Given** une propriété statut ou sélection, **When** elle est choisie pour
   une vue Kanban, **Then** chaque valeur devient une colonne et déplacer une
   carte met à jour la propriété de la page correspondante.
2. **Given** une propriété date, **When** elle est choisie pour une vue
   calendrier, **Then** chaque entrée datée apparaît au bon jour et un
   déplacement autorisé met à jour cette date.
3. **Given** des entrées sans date, **When** une vue calendrier est ouverte,
   **Then** elles restent accessibles dans une zone non planifiée et ne sont
   pas silencieusement exclues.
4. **Given** une vue galerie, **When** les entrées sont affichées, **Then** les
   cartes présentent au minimum le titre et les propriétés choisies, avec un
   substitut explicite lorsqu'aucun aperçu sûr n'est disponible.
5. **Given** une carte dans n'importe quelle vue, **When** le propriétaire
   l'ouvre, **Then** il atteint la même page canonique et revient ensuite à la
   même vue, aux mêmes filtres et à une position compréhensible.
6. **Given** un viewport de 320 pixels ou un zoom à 200 %, **When** une vue est
   utilisée, **Then** ses actions essentielles restent accessibles sans perte
   d'information ni défilement horizontal de toute la page.

---

### User Story 5 - Continuer hors ligne et converger sans perte (Priority: P1)

En tant que propriétaire, je peux consulter et modifier les bases présentes
localement, y compris leurs entrées et vues, puis synchroniser mes changements
sur mes appareils sans qu'un conflit de schéma ou de valeur détruise une
version.

**Why this priority**: Une base de données qui contournerait les garanties
local-first et multi-appareils du produit remettrait en cause la confiance
acquise par les features V1.

**Independent Test**: Précharger une base sur deux appareils, couper le réseau,
modifier des valeurs, le schéma et une vue de part et d'autre, redémarrer un
client puis reconnecter les deux appareils et résoudre les conflits produits.

**Acceptance Scenarios**:

1. **Given** une base disponible localement, **When** l'appareil perd le réseau,
   **Then** les vues déjà disponibles restent consultables et les modifications
   locales autorisées sont confirmées sans attendre le serveur.
2. **Given** une base seulement partiellement locale, **When** elle est ouverte
   hors ligne, **Then** l'interface distingue les entrées présentes, les données
   déchargées et l'impossibilité de garantir un résultat complet.
3. **Given** deux appareils modifiant des propriétés distinctes de la même
   entrée depuis un état commun, **When** ils se reconnectent, **Then** les
   changements compatibles convergent sans faux conflit.
4. **Given** deux appareils modifiant la même valeur ou un schéma et une valeur
   de manière incompatible, **When** ils se reconnectent, **Then** toutes les
   versions sont conservées et un conflit explicite doit être résolu avant
   d'annoncer la convergence.
5. **Given** une modification locale confirmée puis un arrêt inattendu, **When**
   l'application redémarre, **Then** la valeur, le schéma ou la vue en attente
   est récupéré et rejoué sans duplication.
6. **Given** une sauvegarde contenant des bases et tâches, **When** elle est
   restaurée sur une installation compatible, **Then** schémas, entrées,
   valeurs, vues, relations, contenu, historique et identités retrouvent le
   même état observable.

### Edge Cases

- Une propriété est renommée pendant qu'une vue la filtre, la trie, la groupe
  ou l'utilise comme axe visuel.
- Une propriété contenant des valeurs est convertie vers un type qui ne peut
  pas représenter toutes les valeurs existantes.
- Une option de statut ou de sélection encore utilisée est renommée, réordonnée
  ou demandée à la suppression.
- Une relation vise une page mise à la corbeille, restaurée ou définitivement
  supprimée par la future orchestration de cycle de vie.
- Une entrée ne possède aucune valeur pour un filtre, un tri, un groupe, une
  colonne Kanban ou une date de calendrier.
- Une date tombe pendant un changement de fuseau horaire ou de règle d'heure
  d'été ; une date sans heure ne doit pas changer de jour.
- Un nombre saisi ou affiché utilise une convention locale différente de celle
  de l'appareil qui a créé la valeur.
- Une vue enregistrée référence une propriété qui devient indisponible à cause
  d'un conflit non résolu.
- Deux vues portent le même nom ou une base ne conserve plus qu'une seule vue.
- Une base ou une entrée est placée dans la corbeille pendant qu'elle est
  ouverte sur un autre appareil.
- Une base de 100 000 entrées reçoit une modification qui change l'appartenance
  à de nombreux filtres ou groupes.
- Une entrée contient un bloc inconnu, un fichier déchargé ou un contenu que le
  client courant ne sait pas afficher ; ses propriétés doivent rester sûres et
  son contenu préservé.

## Requirements *(mandatory)*

### Functional Requirements

**Bases, schémas et identités**

- **FR-001**: Le propriétaire MUST pouvoir créer, renommer, déplacer, mettre à
  la corbeille et restaurer une base comme un élément identifiable du workspace.
- **FR-002**: Chaque base MUST conserver une identité stable indépendante de
  son nom, de son emplacement et de ses vues.
- **FR-003**: Chaque entrée MUST être une page canonique ouvrable et éditable,
  avec une identité stable, un contenu par blocs, un historique et un cycle de
  vie ordinaires.
- **FR-004**: L'appartenance d'une page à une base MUST être distincte de son
  placement hiérarchique et de ses relations vers d'autres pages.
- **FR-005**: Une entrée MUST appartenir activement à au plus une base ; une
  autre base peut la référencer par relation sans la copier ni changer son
  appartenance.
- **FR-006**: Chaque base MUST posséder exactement une propriété titre
  obligatoire, non supprimable, utilisée pour identifier ses entrées.
- **FR-007**: Le propriétaire MUST pouvoir ajouter, nommer, réordonner,
  configurer et supprimer des propriétés texte, nombre, date, statut,
  sélection, sélection multiple, case à cocher et relation.
- **FR-008**: Chaque propriété MUST posséder une identité stable indépendante
  de son nom et de sa position afin que les vues et valeurs survivent à un
  renommage ou réordonnancement.
- **FR-009**: Chaque valeur MUST être validée selon le type et la configuration
  courants de sa propriété, sans que le refus efface la saisie non validée.
- **FR-010**: Les options de statut et de sélection MUST posséder une identité,
  un libellé, un ordre et une apparence qui ne dépend pas uniquement de la
  couleur.
- **FR-011**: Une date MUST distinguer une date civile sans heure d'un instant
  horodaté et MUST conserver cette distinction sur tous les appareils.
- **FR-012**: Un nombre MUST conserver une valeur canonique indépendante de la
  convention d'affichage locale et MUST expliquer une saisie ambiguë ou invalide.
- **FR-013**: Une relation MUST référencer une identité canonique autorisée,
  rester résolue après renommage ou déplacement et signaler explicitement une
  cible indisponible sans la rediriger.
- **FR-014**: La suppression ou conversion d'une propriété, option ou schéma
  contenant des valeurs MUST présenter l'impact, exiger une confirmation
  proportionnée et préserver toute valeur qui ne peut pas être convertie en
  sécurité jusqu'à une décision explicite.
- **FR-015**: Les modifications de schéma et de valeurs MUST produire des
  révisions attribuables et restaurables selon les politiques d'historique
  existantes.

**Vues, filtres et interactions**

- **FR-016**: Chaque base MUST posséder au moins une vue et MUST permettre de
  créer, nommer, dupliquer, réordonner et supprimer des vues enregistrées sans
  supprimer les entrées.
- **FR-017**: Les types de vue obligatoires MUST être table, Kanban, galerie,
  liste et calendrier.
- **FR-018**: Une vue MUST enregistrer son type, ses propriétés visibles, leur
  ordre, ses filtres, ses tris, son regroupement et les options propres à sa
  présentation.
- **FR-019**: Les filtres MUST permettre une combinaison explicite « tous » ou
  « au moins un ». Ils MUST couvrir au minimum égalité, différence, présence et
  absence pour tous les types ; contient et ne contient pas pour les textes,
  sélections multiples et relations ; avant, après et période pour les dates ;
  inférieur et supérieur pour les nombres.
- **FR-020**: Les tris MUST être composables dans un ordre explicite et MUST
  utiliser un départage stable documenté pour produire le même ordre à état
  canonique identique.
- **FR-021**: Le regroupement MUST prendre en charge au minimum les propriétés
  statut, sélection et case à cocher, conserver une seule occurrence de chaque
  entrée et rendre les valeurs absentes accessibles dans un groupe dédié.
- **FR-022**: Une vue MUST recalculer son résultat après une modification
  locale confirmée sans attendre la synchronisation serveur.
- **FR-023**: La table MUST permettre de consulter et modifier les propriétés
  visibles, de réordonner les colonnes et de redimensionner leur présentation
  sans modifier le schéma ni les valeurs.
- **FR-024**: La liste MUST fournir une présentation compacte, ouvrable et
  navigable des entrées et des propriétés choisies.
- **FR-025**: Le Kanban MUST utiliser une propriété statut ou sélection comme
  colonnes et MUST traduire un déplacement autorisé en modification de cette
  propriété sur la même entrée.
- **FR-026**: La galerie MUST afficher le titre et les propriétés choisies de
  chaque entrée et MUST utiliser un substitut sûr et explicite en l'absence
  d'aperçu disponible.
- **FR-027**: Le calendrier MUST utiliser une propriété date choisie, placer
  correctement les entrées datées et conserver les entrées sans date dans un
  espace accessible.
- **FR-028**: Une modification déclenchée depuis une vue MUST utiliser les mêmes
  règles de validation, d'historique, de sauvegarde locale et de conflit qu'une
  modification depuis la page d'entrée.
- **FR-029**: Ouvrir puis quitter une entrée MUST restaurer le contexte de la
  vue, ses critères et une position ou sélection compréhensible.

**Tâches structurées**

- **FR-030**: Le propriétaire MUST pouvoir désigner une base comme base de
  tâches en associant exactement une propriété statut ou sélection au rôle de
  statut, au plus une propriété date à l'échéance et au plus une propriété
  statut ou sélection à la priorité. Un même rôle ne peut pas viser plusieurs
  propriétés simultanément.
- **FR-031**: Une tâche structurée MUST rester une page d'entrée ordinaire et
  MUST pouvoir contenir le même contenu éditorial, les mêmes fichiers et les
  mêmes relations qu'une autre page.
- **FR-032**: Modifier le statut, l'échéance ou la priorité d'une tâche MUST
  mettre à jour toutes ses vues et sa projection de recherche sans changer son
  identité.
- **FR-033**: Les cases à cocher d'un document MUST rester indépendantes des
  tâches structurées ; aucune création, suppression ou synchronisation croisée
  ne MUST se produire sans une action future explicitement spécifiée.

**Local-first, synchronisation et conflits**

- **FR-034**: Les schémas, valeurs, vues et configurations nécessaires à une
  base marquée disponible hors ligne MUST être conservés localement sous la
  même protection que les contenus privés existants.
- **FR-035**: Une base partiellement locale MUST indiquer la couverture de ses
  entrées et MUST NOT présenter un filtre, un groupe ou un total incomplet
  comme exhaustif.
- **FR-036**: Une modification de schéma, valeur ou vue confirmée localement
  MUST survivre à un arrêt inattendu et MUST être rejouable de manière
  idempotente.
- **FR-037**: Les changements de propriétés distinctes depuis un même état
  commun SHOULD converger automatiquement lorsqu'ils sont compatibles.
- **FR-038**: Une modification concurrente incompatible de la même valeur, du
  schéma qui la définit ou de la configuration d'une même vue MUST préserver
  toutes les versions et produire un conflit explicite.
- **FR-039**: Un appareil en retard MUST rattraper schémas, entrées, valeurs et
  vues dans un ordre qui ne crée pas d'état faussement valide ou de perte
  transitoire présentée comme définitive.
- **FR-040**: Un client incompatible MUST refuser les écritures structurées
  risquant une perte tout en conservant un accès en lecture lorsque celui-ci est
  sûr et explicable.

**Recherche, sécurité, durabilité et accessibilité**

- **FR-041**: La recherche propriétaire MUST indexer les valeurs textuelles
  actives des propriétés et les champs sémantiques de tâche pris en charge,
  sans créer de doublon pour une entrée visible dans plusieurs vues.
- **FR-042**: Les résultats de recherche de propriétés MUST conserver
  l'identité de la page d'entrée et indiquer la propriété correspondante sans
  révéler une valeur absente du périmètre ou du stockage local disponible.
- **FR-043**: Les bases, schémas, valeurs, vues, tâches et relations MUST être
  chiffrés au repos sur le serveur et localement, et MUST NOT apparaître en clair
  dans les journaux, diagnostics, URL ou erreurs techniques.
- **FR-044**: L'export, les sauvegardes et la restauration MUST préserver les
  identités, schémas, options, valeurs, vues, relations et associations de
  tâches dans un format versionné et vérifiable.
- **FR-045**: La mise à la corbeille d'une entrée MUST la retirer de toutes ses
  vues et la restauration MUST la rétablir avec ses valeurs. La mise à la
  corbeille d'une base MUST annoncer le nombre d'entrées affectées et placer la
  base et ses entrées actives dans la corbeille comme une opération atomique ;
  leur restauration MUST rétablir schéma, vues, valeurs, historique et
  relations sans ancienne copie résiduelle.
- **FR-046**: La suppression définitive MUST rester déléguée à la future
  orchestration de cycle de vie ; cette feature MUST seulement respecter son
  état canonique et retirer les données dérivées actives correspondantes.
- **FR-047**: Toutes les vues MUST être utilisables au clavier, annoncer le
  contexte, la sélection, les filtres, les tris, les groupes et les erreurs, et
  conserver un ordre de focus prévisible.
- **FR-048**: Le statut, la priorité, les groupes et les conflits MUST être
  compréhensibles sans dépendre uniquement de la couleur, de la position ou du
  glisser-déposer.
- **FR-049**: Les parcours essentiels MUST rester utilisables à 320 pixels et à
  200 % de zoom ; tout défilement bidimensionnel nécessaire MUST rester contenu
  dans la vue et ne pas masquer les actions principales.
- **FR-050**: Les libellés, erreurs, annonces, nombres, dates, heures et tris
  MUST suivre la langue active et des règles locales explicites. Toutes les
  copies de cette feature MUST pouvoir changer avec la langue globale sans
  migration des données. Une traduction isolée de la 009 est interdite : la
  première interface française complète reste un passage transversal de
  release, et les valeurs canoniques MUST rester indépendantes de la langue
  d'affichage.

### Key Entities *(include if feature involves data)*

- **Base de données**: conteneur structuré identifiable du workspace, possédant
  un schéma, des entrées et une ou plusieurs vues sans devenir une hiérarchie
  parallèle.
- **Propriété**: champ stable du schéma avec un type, un nom, un ordre et une
  configuration ; la propriété titre est unique et obligatoire.
- **Option de propriété**: valeur nommée et ordonnée utilisée par les statuts et
  sélections, avec une identité indépendante de son libellé.
- **Entrée**: page canonique appartenant à une base, portant des valeurs de
  propriétés et un document éditorial ordinaire.
- **Valeur de propriété**: valeur typée associant une entrée et une propriété,
  avec son état de révision, de disponibilité et de conflit.
- **Vue enregistrée**: projection nommée d'une base qui conserve type,
  propriétés visibles, filtres, tris, regroupement et options de présentation.
- **Critère de filtre**: comparaison typée et visible appliquée à une propriété,
  combinée aux autres selon une règle « tous » ou « au moins un ».
- **Critère de tri**: propriété, direction et priorité de tri participant à un
  ordre stable.
- **Tâche structurée**: page d'entrée d'une base de tâches dont certaines
  propriétés sont associées aux rôles statut, échéance et priorité.
- **Relation de propriété**: référence typée depuis une valeur vers une identité
  canonique, distincte d'un placement hiérarchique.
- **Conflit structuré**: versions concurrentes d'une valeur, d'un schéma ou
  d'une vue qui ne peuvent pas converger sans décision du propriétaire.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Le propriétaire peut créer une base, définir les huit types de
  propriétés obligatoires et enregistrer une première entrée complète en moins
  de cinq minutes sans documentation externe.
- **SC-002**: Sur une base de 100 000 entrées, les 100 premières entrées d'une
  vue enregistrée sont utilisables en moins d'une seconde dans au moins 95 % des
  mesures sur l'environnement de référence.
- **SC-003**: Une modification locale de valeur, de schéma ou de vue est visible
  et annoncée comme enregistrée localement en moins de 300 millisecondes dans
  au moins 95 % des mesures, indépendamment du réseau.
- **SC-004**: Une modification acceptée par le serveur apparaît dans la même
  base sur un autre appareil connecté en moins de deux secondes dans au moins
  95 % des mesures en conditions réseau normales.
- **SC-005**: Dix mille opérations générées de création, édition, changement de
  schéma, filtre, tri, regroupement, rejeu, corbeille et restauration produisent
  zéro entrée dupliquée, zéro identité remplacée et zéro valeur perdue
  silencieusement.
- **SC-006**: Pour un même état canonique, les cinq types de vues produisent le
  même ensemble d'identités attendu et les filtres, tris et groupes produisent
  le même résultat sur tous les clients compatibles testés.
- **SC-007**: Après des modifications concurrentes incompatibles, 100 % des
  versions originales restent consultables jusqu'à une résolution explicite et
  aucune vue n'annonce à tort un état convergé.
- **SC-008**: Une restauration de référence retrouve exactement les identités,
  schémas, options, valeurs, vues, relations, rôles de tâche et contenus
  attendus avant d'être annoncée saine.
- **SC-009**: Les audits d'autorisation, de stockage, d'erreur et de diagnostic
  trouvent zéro propriété privée, valeur, titre de tâche, clé ou secret dans
  une surface non autorisée ou un artefact de journalisation.
- **SC-010**: Les parcours clavier et lecteur d'écran permettent de créer une
  entrée, modifier une propriété, changer de vue, appliquer un filtre et
  déplacer une tâche entre deux statuts sans geste de pointeur obligatoire.
- **SC-011**: À 320 pixels et à 200 % de zoom, les cinq vues permettent d'ouvrir
  une entrée et d'accéder à leurs actions principales sans défilement horizontal
  de toute la page ni contrôle inaccessible.

## Assumptions

- Les features 001 à 008 sont fusionnées avant l'implémentation de la 009 et
  leurs contrats restent les seules autorités pour identité, chiffrement,
  édition, fichiers, synchronisation, sauvegarde et recherche.
- Une entrée appartient activement à une seule base. Elle peut être reliée ou
  affichée dans plusieurs vues sans duplication.
- La première livraison expose des bases ouvrables depuis la hiérarchie. Les
  vues liées ou intégrées dans une autre page seront spécifiées avec leur
  interaction éditoriale plutôt qu'ajoutées implicitement ici.
- Les filtres de cette livraison utilisent un ensemble plat de critères combiné
  par « tous » ou « au moins un ». Les groupes logiques imbriqués et un langage
  de formule sont différés.
- La priorité d'une tâche est portée par une propriété sélection associée à ce
  rôle ; aucune liste universelle de priorités n'est imposée au propriétaire.
- Les aperçus de galerie réutilisent seulement un aperçu de contenu ou de fichier
  déjà autorisé et disponible ; ils ne déclenchent pas d'extraction distante
  nouvelle.
- Les totaux simples d'entrées par groupe peuvent être affichés. Les formules,
  agrégations avancées et rollups ne sont pas nécessaires à cette feature.
- Jusqu'au passage transversal en français, cette feature suit la langue active
  de l'application afin de ne pas créer une interface bilingue. Ses copies sont
  regroupées derrière une frontière de langue et les valeurs persistées ne
  dépendent jamais des libellés affichés.

## Out of Scope

- Formules, rollups, agrégations avancées, graphiques et tableaux de bord.
- Propriétés personne, e-mail, téléphone, URL, fichier, bouton, identifiant
  automatique, heure de création ou auteur calculé.
- Modèles de base ou d'entrée, automatisations, dépendances de tâches,
  récurrence, rappels et notifications.
- Conversion automatique des cases à cocher éditoriales en tâches structurées.
- Vues liées ou bases intégrées dans le contenu d'une autre page.
- Backlinks, propriétés réciproques automatiques, traversal relationnel et
  visualisation du graphe — feature 010.
- Tableaux blancs — feature 011.
- Partage public des bases, vues et tâches — feature 012.
- Accès et permissions MCP — feature 013.
- Orchestration complète de la suppression définitive et de la rétention —
  future feature de cycle de vie.
- Collaboration multi-utilisateur, assignation à une autre personne, présence
  et coédition, incompatibles avec le produit mono-utilisateur.
