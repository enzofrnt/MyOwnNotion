# Feature Specification: Bases de données comme pages et vues

**Feature Branch**: `codex/029-database-pages-views`
**Created**: 2026-09-27
**Status**: Spécification prête pour la planification
**Input**: Trois concepts : source, vue et page. Une page est une base de données, un dossier ou une page classique. Une source naît dans une page de base, ou avec la base enfant créée par une base intégrée. Une page de base affiche une ou plusieurs vues ; chaque vue montre une source. Elle peut posséder plusieurs sources, ou n'en posséder aucune et seulement afficher des sources existantes. Une base intégrée montre, dans une page classique, les vues de la page de base enfant. Les entrées restent des pages ou dossiers.

## Product Direction, Dependencies, and Scope

Cette feature corrige la direction du [canevas produit](../../docs/product/product-canvas.md), surtout les sections 10, 11, 13, 14, 18–22, 27–33 et 42–44. Elle remplace les choix de cycle de vie de la [009](../009-databases-structured-tasks/spec.md) et de la [026](../026-linked-databases/spec.md) qui rendaient une source indépendante de tout élément de la hiérarchie et une entrée sans enfant hiérarchique. Le nouveau modèle distingue la page, les sources qui lui sont rattachées et les vues qui affichent une source. Une page de base peut posséder zéro, une ou plusieurs sources. Une source a une seule page d'origine, qui fixe son cycle de vie et la suit dans l'arborescence. Les propriétés, les cinq types de vues et les garanties de données créées sous ce nouveau modèle restent dans le périmètre. Le canevas et les artefacts directement touchés sont mis en cohérence avec cette spécification.

Le produit n'étant pas encore en V1, le propriétaire autorise une rupture des contrats, une remise à plat des migrations et l'effacement des bases et entrées de développement existantes pour repartir sur un modèle propre. Cette remise à zéro doit être annoncée explicitement ; aucune compatibilité avec les anciennes sauvegardes ou données structurées n'est promise pour cette phase. Les garanties de durabilité, export et restauration s'appliquent aux données créées après la remise à zéro.

Le propriétaire veut retrouver le parcours illustré par ses captures : une base ouverte affiche des onglets de vues comme Table et Kanban ; les lignes ou cartes représentent des entrées ; la navigation distingue la base de ses vues épinglées. Les captures servent de référence de parcours et de hiérarchie visuelle, sans imposer une copie pixel à pixel.

## Clarifications

### Session 2026-09-27

- Une vue liée peut exister comme bloc de page et comme élément de l'arborescence, avec une icône de base fléchée lorsque l'élément ne possède pas la source affichée.
- Seuls les enfants directs de la base sont des entrées avec ses propriétés ; les descendants d'un dossier entrée ne le deviennent pas automatiquement.
- Mettre une base source à la corbeille y place sa branche ; ses vues liées affichent un avertissement et ne sont plus éditables avant restauration.
- Chaque vue garde son format, ses filtres, tris et regroupements propres ; les propriétés et entrées sont partagées par sa source. Seul un conteneur pleine page présente plusieurs onglets.
- Avant la V1, le propriétaire autorise la remise à plat des migrations et l'effacement des bases et entrées de développement existantes pour repartir sur un modèle propre.

- Correction après consultation de Notion : changer la source d'une vue ne supprime pas la source créée avec son conteneur. Le conteneur peut conserver cette source même si aucune de ses vues ne l'affiche ; la source est supprimée avec son conteneur d'origine, et non lors d'un simple changement de vue.
- Un conteneur de base pleine page peut proposer plusieurs onglets, chacun avec sa propre source, son format et ses réglages. Une vue intégrée montre un seul format à la fois et peut changer de format sans ajouter d'onglet.
- Avec une seule vue, le changement de source est indisponible ; dès la deuxième vue, chaque vue peut changer de source. La source possédée reste récupérable même si toutes les vues affichent une autre source. Le conteneur propriétaire conserve son icône de base source.
- Les propriétés à états définis se présentent comme une seule « sélection multiple ». Chaque option a un libellé et une couleur choisie dans une palette fixe, et s'affiche comme une pastille avec un point coloré. Le libellé reste lisible sans la couleur. Les valeurs déjà enregistrées comme statut, sélection ou sélection multiple restent valides.
- Une base ne peut pas contenir directement une autre base. Une page ou un dossier qui est une entrée peut toutefois contenir une base parmi ses propres enfants.
- Une page ou un dossier déplacé hors d'une base puis replacé dans la même base retrouve ses valeurs de propriétés antérieures.
- Pour la navigation, les entrées de la source possédée restent visibles sous leur conteneur propriétaire, même lorsqu'aucune vue de celui-ci ne montre cette source. Ce choix peut être ajusté après vérification du fonctionnement.
- Vérification directe dans Notion : une base avec une seule vue affiche « Source » désactivé dans les réglages. Après duplication de la vue, les deux sources deviennent modifiables. Les deux vues d'une base de test ont été reliées à « Emmy » ; le panneau « Gérer les sources de données » montre toujours la source d'origine comme « Source » et « Emmy » comme « Liées — 2 vues ».
- Vérification directe dans Notion : la commande « Vue liée de la source de données » insérée dans une page crée un bloc et un élément enfant ouvrable en pleine page. Cet élément n'a pas de source propre et son gestionnaire ne montre que la source liée choisie. Un conteneur de base qui lie une source externe conserve, lui, sa source propre séparément.
- Décision du propriétaire : la première refonte prend en charge Table, Kanban, Galerie, Liste et Calendrier. Les autres formats observés dans Notion attendent une feature ultérieure.
- Décision du propriétaire : une commande distincte « Vue liée de base de données » insère dans une page une vue d'une source existante, sans créer ni dupliquer cette source.
- Décision du propriétaire du 27 septembre, remplacée le 30 septembre : un bloc intégré affichait une seule vue. Voir la session du 30 septembre.
- Décision du propriétaire du 27 septembre, remplacée le 30 septembre : chaque page de base possédait une seule source. Voir la session du 30 septembre.

### Session 2026-09-30

Le propriétaire décrit trois concepts — source, vue, page — et trois types de pages : base de données, dossier, page classique. Cette session remplace les décisions du 27 septembre qui limitaient une page de base à une seule source possédée, imposaient une vue unique dans un bloc intégré, et créaient toujours une source neuve avec chaque page de base.

- Une source ne se crée que depuis une page de base, ou par la création d'une base intégrée. Cette création pose de toute façon une page de base enfant sous la page classique, et la source y est rattachée.
- Créer une page de base offre deux issues : une nouvelle source, ou l'affichage d'une source existante. La nouvelle source a cette page pour origine. La page qui n'affiche qu'une source existante ne possède aucune source ; elle peut être nommée « Vue de [nom de la source] » et porte une flèche sur son icône tant qu'elle ne possède aucune source propre.
- Une page de base peut montrer plusieurs vues d'une même source, ou des vues de sources différentes. Avec une seule source affichée, le titre de la page est le titre de cette source. Avec plusieurs sources, le premier titre est le nom de la page et, en dessous, le nom de la source de la vue sélectionnée.
- Ajouter une vue propose d'afficher une source existante ou d'en créer une nouvelle. La création d'une source se place sous le choix du format déjà présent, et la nouvelle source est rattachée à la page de base courante.
- Une base intégrée dans une page classique est l'affichage des vues de sa page de base enfant. Elle se comporte comme l'interface habituelle de cette page, onglets compris.
- Supprimer une vue ne supprime pas la source. Depuis la page d'origine, supprimer la dernière vue d'une source demande : supprimer seulement la vue, ou supprimer la vue et la source. Si seule la vue part, la source reste sur sa page d'origine et peut servir à une nouvelle vue. Une vue d'une source née sur une autre page ne propose jamais de supprimer cette source.
- Supprimer une page de base qui possède des sources indique leur nombre et demande une confirmation explicite. Exemple : « Cette page contient 3 sources de données. Sa suppression entraînera également la suppression de ces sources et pourra affecter les vues qui les utilisent ailleurs. Voulez-vous continuer ? » Les vues ailleurs restent ; elles affichent « Aucun résultat : la source de données demandée n'existe plus. »
- Déplacer la page d'origine déplace ses sources avec elle. Une source ne se déplace pas seule vers une autre page.

### Écarts assumés après le tour d'horizon de Notion

Les essais directs sont consignés dans [research.md](research.md) et les huit captures du propriétaire sont conservées dans [references](references/README.md). Notion permet aussi de déplacer une source vers une autre page sans déplacer sa page d'origine. Ce déplacement indépendant reste hors périmètre : la source suit sa page d'origine. Le reste du modèle du 30 septembre — plusieurs sources sur une page, page sans source propre, base intégrée qui reprend les vues de sa page enfant — est dans le périmètre.

## User Scenarios & Testing

### User Story 1 — Créer une base pleine page (Priority: P1)

Depuis une page, le propriétaire insère « Base de données - pleine page » ; la nouvelle base est un enfant de cette page, un lien de sous-page est ajouté au contenu au point de commande et l'interface ouvre immédiatement la nouvelle base en pleine page. Ce lien d'enfant utilise l'icône de base sans flèche de raccourci. Les menus `+` de Notes et des éléments pouvant contenir des enfants proposent aussi « Base de données », à côté de « Page » et « Dossier ».

**Independent Test**: Créer la base depuis une page et depuis chacun des deux `+`, vérifier l'ouverture immédiate en pleine page, puis la renommer, la déplacer et revenir à la page de départ par son lien.

**Acceptance Scenarios**:

1. **Given** une page éditable, **When** le propriétaire choisit « Base de données - pleine page », **Then** une base enfant est créée, un lien de sous-page sans flèche de raccourci est inséré au point de commande et la nouvelle base s'ouvre en pleine page.
2. **Given** le `+` au-dessus des Notes ou sur une page ou un dossier, **When** le propriétaire l'ouvre, **Then** « Dossier », « Page » et « Base de données » sont disponibles et créent un enfant du bon parent.
3. **Given** une page ordinaire, **When** elle est affichée, **Then** aucun bouton systématique « Ajouter une base » n'apparaît sous son contenu.
4. **Given** une base ouverte depuis l'arborescence ou un lien, **When** elle apparaît en pleine page, **Then** elle possède son propre onglet dans la bande du workspace, avec son icône et son titre ; revenir à cet onglet rouvre la même base.
5. **Given** la création d'une page de base, **When** le propriétaire choisit une source existante, **Then** la page ne possède aucune source, peut se nommer « Vue de [nom de la source] » et affiche une flèche sur son icône.

### User Story 2 — Créer une base intégrée (Priority: P1)

Depuis le contenu d'une page classique, « Base de données - intégrée » crée une page de base enfant et une nouvelle source rattachée à cette page. Le bloc dans la colonne de lecture affiche les vues de cette page enfant, comme son interface habituelle, sans ajouter de lien de page redondant.

**Independent Test**: Insérer une base intégrée entre deux paragraphes, vérifier la base enfant, naviguer vers elle, puis recharger et retrouver texte et vue à la même place.

**Acceptance Scenarios**:

1. **Given** un curseur dans une page classique, **When** le propriétaire choisit « Base de données - intégrée », **Then** une page de base enfant et sa source sont créées, le bloc affiche les vues de cette page et aucun lien supplémentaire n'est inséré.
2. **Given** une base intégrée existante, **When** le propriétaire ouvre la page de base enfant ou ajoute une vue dans le bloc, **Then** le bloc et la page enfant montrent les mêmes vues et les mêmes entrées.
3. **Given** une création interrompue ou refusée, **When** l'interface revient à l'édition, **Then** ni base orpheline ni vue rompue ne sont présentées comme une création réussie ; la saisie et le point d'insertion restent récupérables.
4. **Given** une vue intégrée avec plusieurs colonnes, **When** la page est affichée sur écran normal ou étroit, **Then** la vue reste alignée avec le texte et son contenu large défile dans la vue sans élargir la page.
5. **Given** cette base intégrée, **When** le propriétaire ajoute une vue Kanban à côté de Table, **Then** le bloc et la page enfant présentent les deux onglets, sans copier les entrées.

### User Story 3 — Gérer des entrées comme enfants de la base (Priority: P1)

Chaque nouvelle ligne, carte ou entrée de vue est une page ou un dossier canonique rangé directement sous sa base. Le propriétaire peut lui attribuer les propriétés de la base, l'ouvrir et le retrouver dans la branche de la base. Les descendants d'un dossier ne deviennent pas automatiquement des entrées. Une base ne contient directement aucune autre base.

**Independent Test**: Créer une page et un dossier depuis Table et Kanban, les ouvrir, les renommer, modifier leurs propriétés et vérifier leur placement sous la base après rechargement ; tenter de créer une base sous cette base et constater le refus.

**Acceptance Scenarios**:

1. **Given** une base ouverte, **When** le propriétaire crée une page ou un dossier depuis une vue, **Then** la nouvelle entrée apparaît dans la vue et comme enfant de la base avec une seule identité.
2. **Given** plusieurs vues de la même base, **When** une entrée ou une propriété change, **Then** toutes les vues concernées reflètent la même donnée.
3. **Given** une entrée mise à la corbeille puis restaurée, **When** sa base existe toujours, **Then** son contenu et son appartenance à la base reviennent sans duplication.
4. **Given** une base, **When** le propriétaire tente d'y créer ou déplacer une autre base, **Then** l'opération est refusée avec une explication et aucune branche partielle n'est créée.
5. **Given** un dossier qui est une entrée de base, **When** il contient une sous-page, **Then** ce dossier garde ses propriétés d'entrée et sa sous-page ne reçoit pas automatiquement ces propriétés ni l'appartenance à la base.
6. **Given** une page ou un dossier qui est une entrée, **When** le propriétaire crée une base sous cette entrée, **Then** la base est un enfant de cette page ou de ce dossier sans devenir elle-même une entrée de la source parente.
7. **Given** une entrée avec des propriétés renseignées, **When** elle est déplacée hors de sa base puis replacée dans cette même base, **Then** ses valeurs antérieures réapparaissent sans nouvelle identité.
8. **Given** une vue liée à la source A affichée depuis une autre page ou un autre conteneur, **When** le propriétaire y crée une page ou un dossier, **Then** l'entrée est créée directement sous le conteneur propriétaire de A et apparaît dans toutes les vues de A concernées, sans devenir l'enfant de la vue liée.
9. **Given** un import Notion compatible avec le nouveau modèle, **When** le propriétaire en applique l'aperçu sur une installation de test, **Then** chaque source importée possède une page de base et ses entrées importées sont placées sous cette page, sans source orpheline ni entrée placée à la racine par défaut.

### User Story 4 — Multiplier les vues d'une base (Priority: P1)

Le propriétaire ajoute des onglets Table, Kanban, Galerie, Liste ou Calendrier dans un conteneur de base pleine page. Le libellé automatique et l’icône d’un onglet suivent son format ; un nom choisi depuis Renommer dans le menu de la vue reste celui de l’onglet. Un nom encore automatique s’affiche dans le champ comme une indication plus discrète : le champ est vide tant qu’on n’écrit rien, et le vider après un nom choisi rend le nom automatique. Chaque onglet pointe vers une source précise : la source possédée par ce conteneur ou une source externe. Deux onglets d'un même conteneur peuvent ainsi montrer des ensembles de pages différents, tandis que deux vues d'une même source partagent les entrées et propriétés de cette source. Les filtres, tris, regroupements et formats restent propres à chaque vue.

**Independent Test**: Ajouter Table et Kanban sur la source A, puis une vue de la source B dans le même conteneur ; modifier A et B séparément, recharger et vérifier les sources et réglages de chaque onglet.

**Acceptance Scenarios**:

1. **Given** une source A et une vue Table, **When** le propriétaire ajoute une vue Kanban de A, **Then** deux onglets distincts montrent les mêmes entrées avec des présentations différentes.
2. **Given** des sources A et B, **When** le propriétaire ajoute dans le conteneur de A une vue de B, **Then** ce conteneur affiche des onglets de sources différentes, sans déplacer ni dupliquer B.
3. **Given** deux vues de la même source, **When** leurs filtres, tris, groupes ou formats sont modifiés séparément, **Then** chacune conserve ses réglages après rechargement et synchronisation sans changer les entrées communes.
4. **Given** un élément de vue liée dans l'arborescence, **When** le propriétaire l'ouvre, **Then** il voit la source choisie avec ses réglages propres et son icône de base munie d'une flèche qui le distingue d'un conteneur propriétaire de source.
5. **Given** un conteneur qui n'a que sa vue initiale, **When** le propriétaire ouvre ses réglages, **Then** le changement de source de cette vue n'est pas proposé. Après l'ajout d'une deuxième vue, chaque onglet peut choisir sa source sans supprimer celle que le conteneur possède.
6. **Given** une page ordinaire et une source existante, **When** le propriétaire insère une vue liée à cette source, **Then** un bloc de vue est ajouté au point d'insertion et peut être ouvert en pleine page comme élément enfant de type « vue de base », sans devenir propriétaire de la source ni copier ses entrées.
7. **Given** cet élément de vue liée, **When** le propriétaire consulte sa navigation et ses sources, **Then** son icône fléchée le distingue d'une base propriétaire et la source choisie apparaît comme liée, sans source propre implicite.
8. **Given** une page de base qui possède la source A, **When** le propriétaire ajoute une vue de B, **Then** A reste rattachée à cette page ; B reste rattachée à sa propre page d'origine.
9. **Given** un élément de vue liée vers A, **When** le propriétaire retire son bloc ou met cet élément à la corbeille, **Then** la source A et ses entrées restent sous leur conteneur propriétaire et les autres vues de A continuent de fonctionner.
10. **Given** une page de base dont la seule vue restante affiche B, **When** le propriétaire supprime un autre onglet, **Then** cette vue continue d'afficher B ; l'interface empêche seulement de changer sa source tant qu'elle est seule.
11. **Given** une page de base sans source propre ouverte depuis l'arborescence ou un lien, **When** elle apparaît en pleine page, **Then** elle possède son propre onglet dans la bande du workspace ; fermer cet onglet ne supprime ni la page ni la source affichée. Le bloc intégré reprend les vues de sa page enfant et ne crée pas d'onglet de workspace par sa simple présence.
12. **Given** le choix d'une nouvelle vue, **When** le propriétaire crée une nouvelle source sous le choix de format, **Then** cette source est rattachée à la page de base courante et une vue de cette source est ajoutée.
13. **Given** une page de base qui affiche une seule source, **When** elle est ouverte, **Then** son titre est le titre de cette source. **When** ses vues affichent plusieurs sources, **Then** le nom de la page est le premier titre et le nom de la source de la vue sélectionnée apparaît en dessous, dans un titre secondaire plus grand qu’une légende.
14. **Given** ce titre secondaire, **When** la source de la vue sélectionnée est rattachée à la page courante, **Then** il se modifie sur place comme le titre de page. **When** cette source est née sur une autre page, **Then** le titre secondaire reste en lecture seule et se distingue par une flèche.
15. **Given** un onglet de vue, **When** le propriétaire fait un clic droit ou ouvre le menu contextuel au clavier, **Then** un menu propose Renommer, Modifier la vue, Source, Dupliquer la vue et Supprimer la vue, avec une icône alignée sur chaque libellé. Le clic droit n’ouvre pas l’édition du nom. Supprimer la vue ne devient rouge, texte et icône, qu’au survol ou au focus. Renommer ouvre le panneau de réglages de la vue, le curseur dans le champ du nom. Dupliquer ajoute une vue de la même source : un nom choisi devient « nom (1) », puis « nom (2) » si ce nom est déjà pris ; un nom automatique prend le prochain nom libre de son format. Supprimer suit les règles de la dernière vue d’une source sur sa page d’origine.
16. **Given** ce menu, **When** le propriétaire choisit Modifier la vue, **Then** un panneau latéral d’environ 290 px s’ouvre sur les réglages de cette vue : nom, disposition, visibilité des propriétés, filtres, tri, puis la source et ses propriétés. **When** il choisit Source, **Then** le même panneau s’ouvre directement sur le choix de source. Les propriétés se modifient dans un sous-écran de ce panneau, pas dans un formulaire séparé. La roue des options de la vue ouvre le même panneau.

### User Story 5 — Cycle de vie d'une source (Priority: P1)

Supprimer une vue ne supprime pas sa source. Si la dernière vue d'une source est retirée depuis sa page d'origine, le propriétaire choisit de ne supprimer que la vue, ou la vue et la source. Une vue d'une source née ailleurs ne propose jamais de supprimer la source. Supprimer la page d'origine indique le nombre de sources rattachées et, après confirmation, supprime ces sources. Les vues ailleurs restent et indiquent que la source n'existe plus. Déplacer la page d'origine emmène ses sources.

**Independent Test**: Créer A sur sa page, l'afficher ailleurs, retirer la dernière vue de A sur sa page en ne gardant que la source, puis la réafficher ; recommencer en supprimant la page d'origine et lire le message sur la vue externe.

**Acceptance Scenarios**:

1. **Given** une source A sur sa page d'origine, **When** toutes les vues de cette page affichent ensuite B, **Then** A reste sur sa page d'origine, sans vue, et peut être choisie pour une nouvelle vue.
2. **Given** la dernière vue de A sur sa page d'origine, **When** le propriétaire la supprime, **Then** l'application demande de supprimer seulement la vue, ou la vue et la source.
3. **Given** ce choix « vue seule », **When** il est confirmé, **Then** A existe encore sur sa page d'origine.
4. **Given** une vue de A ouverte depuis une autre page de base, **When** le propriétaire supprime cette vue, **Then** seule la vue disparaît ; A n'est pas proposée à la suppression.
5. **Given** une page de base qui possède trois sources, **When** le propriétaire la supprime, **Then** la confirmation énonce ce nombre et prévient que les sources partent avec la page et peuvent affecter les vues ailleurs.
6. **Given** cette suppression confirmée, **When** une vue ailleurs affichait une de ces sources, **Then** la vue reste et indique « Aucun résultat : la source de données demandée n'existe plus. »
7. **Given** une page d'origine déplacée dans l'arborescence, **When** le déplacement est terminé, **Then** ses sources sont toujours rattachées à cette page.

### Edge Cases

- Création hors ligne ; interruption entre conteneur, source et vue ; deux appareils créant ou modifiant des vues ; conteneur déplacé ou renommé ; entrée déplacée hors de sa source ; source possédée mais non affichée ; conteneur source mis à la corbeille puis purgé pendant que des vues liées subsistent ; vue de source externe dans le conteneur d'origine ; source ou entrée seulement partiellement disponible localement ; nombreux enfants sans ralentir la navigation ; nouvelles données exportées puis restaurées ; remise à zéro explicite des anciennes données de développement.

## Requirements

### Functional Requirements

- **FR-001**: Une page de base est un élément canonique de la hiérarchie, avec identité, titre et placement uniques, sans corps de texte éditorial. Elle possède zéro, une ou plusieurs sources. Chaque source a exactement une page d'origine.
- **FR-002**: « Base de données - pleine page » crée une page de base enfant. Le propriétaire choisit une nouvelle source, rattachée à cette page, ou l'affichage d'une source existante, sans source propre. La pleine page insère un lien de sous-page sans flèche de raccourci, puis ouvre la page. « Base de données - intégrée » crée une page de base enfant, une source qui lui est rattachée, et un bloc qui affiche les vues de cette page.
- **FR-003**: Les `+` de Notes, pages et dossiers permettent de créer une page, un dossier ou une base sous le parent choisi.
- **FR-004**: Le bouton permanent « Ajouter une base » sous chaque page disparaît. Le choix ou le changement de source appartient à l'élément de vue ou à la commande explicite de liaison, pas à un ajout automatique en fin de page.
- **FR-005**: Chaque entrée créée dans une source est une page ou un dossier canonique enfant direct du conteneur propriétaire de cette source, y compris si la création part d'une vue liée ailleurs ; son appartenance et son placement ne produisent pas deux identités. Un conteneur de base n'accepte directement que des pages et dossiers, jamais un autre conteneur de base ni un élément de vue liée.
- **FR-006**: Une page de base prend en charge plusieurs vues aux formats Table, Kanban, Galerie, Liste et Calendrier. Chaque vue référence une source et possède son format et ses réglages. Le bouton d'ajout ouvre le choix du format, puis permet d'afficher une source existante ou d'en créer une nouvelle rattachée à la page courante. Ajouter une vue ne copie pas les entrées. Créer une source n'est possible que depuis une page de base.
- **FR-007**: Une source existante peut être affichée par plusieurs pages de base. Une base intégrée reste dans la colonne de lecture, montre les vues de sa page de base enfant et fait défiler son contenu large dans sa propre surface.
- **FR-008**: Chaque vue conserve un lien vérifiable vers sa source. La source reste rattachée à sa page d'origine même lorsqu'aucune vue ne l'affiche. Supprimer cette page supprime ses sources ; les vues ailleurs restent et indiquent que la source demandée n'existe plus.
- **FR-009**: La remise à zéro des données de développement antérieures à la V1 est explicite, bornée et documentée avant exécution. Les bases et entrées créées sous le nouveau modèle bénéficient ensuite des garanties ordinaires de chiffrement, disponibilité hors ligne, export, sauvegarde, restauration et synchronisation.
- **FR-010**: Création, déplacement, changement de source d'une vue, suppression, restauration et synchronisation gardent les conteneurs, sources, entrées et vues cohérents sur les appareils, y compris hors ligne et après conflit.
- **FR-011**: Les menus, onglets et états vide, chargement, erreur et source supprimée restent utilisables au clavier, en thèmes clair/sombre et à 320 px ; l'interface suit la hiérarchie visuelle des captures sans en copier les détails arbitraires.
- **FR-012**: Le conteneur créé par une insertion intégrée est un enfant visible de la page hôte dans l'arborescence, distinct du bloc de vue intégré dans son contenu.
- **FR-013**: Supprimer une page de base qui possède des sources indique leur nombre et demande une confirmation explicite avant de supprimer ces sources avec la page. Les vues situées ailleurs ne sont pas supprimées. Elles affichent « Aucun résultat : la source de données demandée n'existe plus. »
- **FR-014**: Chaque vue possède ses propres format, filtres, tris, regroupements et propriétés visibles. Les vues qui référencent la même source partagent les propriétés définies par cette source et ses entrées ; celles qui référencent des sources différentes restent distinctes.
- **FR-015**: Une base expose un schéma de propriétés extensible et partagé par ses pages et dossiers enfants ; les types existants, dont texte, nombre, date, sélection multiple et case à cocher, restent disponibles sans nombre de propriétés arbitrairement limité par l'interface. Une propriété à états définis est une sélection multiple : chaque option porte une couleur d'une palette fixe et s'affiche en pastille, le libellé restant lisible sans cette couleur.
- **FR-016**: Une vue est distincte d'une source et ne possède pas les entrées. Une page de base qui ne possède aucune source propre et n'affiche que des sources existantes a une flèche sur son icône. Une page qui possède au moins une source garde l'icône de base sans cette flèche, même si certaines vues montrent d'autres sources.
- **FR-017**: Seules les pages et dossiers placés directement sous une base sont ses entrées avec propriétés. Les descendants d'un dossier entrée ne reçoivent automatiquement ni appartenance ni propriétés de cette base. Une page ou un dossier entrée peut contenir une base parmi ses propres enfants.
- **FR-018**: Changer la source d'une vue modifie seulement la source référencée par cette vue ; la source possédée par son conteneur et ses entrées ne sont ni déplacées ni supprimées par ce changement, même si elle n'a plus de vue active dans ce conteneur.
- **FR-019**: Une page de base peut afficher plusieurs onglets de sources différentes. Une base intégrée affiche les mêmes vues que sa page de base enfant.
- **FR-020**: Tant qu'une page de base n'a qu'une seule vue, la source de cette vue ne peut pas être changée. Dès qu'elle comporte plusieurs vues, la source de chaque vue peut être choisie indépendamment. Changer la source d'une vue ne supprime aucune source.
- **FR-021**: Une source sans vue reste sur sa page d'origine et peut être choisie pour une nouvelle vue.
- **FR-022**: Avec une seule source affichée, le titre visible de la page de base est le titre de cette source. Avec plusieurs sources, le premier titre est le nom de la page et le nom de la source de la vue sélectionnée est affiché en dessous, comme un titre secondaire. Si cette source est rattachée à la page courante, ce titre se modifie sur place comme le titre de page. Une source née ailleurs reste en lecture seule, précédée d’une flèche.
- **FR-023**: Supprimer la dernière vue d'une source depuis sa page d'origine demande de supprimer seulement la vue, ou la vue et la source. Supprimer une vue d'une source née sur une autre page ne propose pas de supprimer la source. Supprimer une page de base qui possède des sources utilise une confirmation qui énonce leur nombre, par exemple « Cette page contient 3 sources de données. Sa suppression entraînera également la suppression de ces sources et pourra affecter les vues qui les utilisent ailleurs. Voulez-vous continuer ? »
- **FR-024**: Les entrées directes de la source possédée restent visibles et ouvrables dans la branche du conteneur propriétaire même si aucune vue de ce conteneur ne les affiche.
- **FR-025**: Les valeurs de propriétés d'une entrée sont conservées par couple entrée-source lorsque l'entrée quitte une base ; si elle revient dans cette même source, ses valeurs antérieures sont restaurées. Cette conservation ne fait pas de l'entrée un membre actif pendant son absence.
- **FR-026**: Dans le menu de commandes d'une page, « Vue liée de base de données » demande une source existante et insère à l'emplacement du curseur un bloc qui l'affiche. Cette insertion ne crée ni source ni copie d'entrée ; l'élément de vue lié est ouvrable en pleine page et identifiable dans l'arborescence.
- **FR-027**: Une nouvelle source est créée depuis une page de base et lui est rattachée. Une page créée seulement pour afficher une source existante n'a aucune source propre ; elle peut se nommer « Vue de [nom de la source] ». Déplacer la page d'origine déplace les sources qui lui sont rattachées. Une source ne change pas de page d'origine par le seul changement d'une vue.
- **FR-028**: Retirer une vue liée ou son bloc ne supprime ni sa source ni ses entrées. Un élément de vue liée n'a pas d'enfants hiérarchiques directs et sa mise à la corbeille ne cascade pas dans le conteneur propriétaire de la source.
- **FR-029**: L'import Notion local destiné à la V1 adapte son aperçu et son application au nouveau modèle : chaque source importée a une page de base propriétaire, les pages et dossiers membres deviennent ses enfants directs, et les vues importées ou reconstruites comme choix par défaut ne créent aucune source orpheline. Les garanties de prévisualisation, sauvegarde préalable, provenance chiffrée et reprise restent applicables.
- **FR-030**: Le clic droit ou le menu contextuel d’un onglet de vue ouvre Renommer, Modifier la vue, Source, Dupliquer la vue et Supprimer la vue. Les icônes sont alignées sur les libellés. Supprimer la vue ne rougit, texte et icône, qu’au survol ou au focus. Renommer ouvre le même panneau, le curseur dans le champ du nom. Un nom encore automatique y apparaît en indication : le champ reste vide, et le vider après un nom choisi rétablit le nom automatique du format. L’icône de ce champ suit les icônes des rangées et ouvre un choix d’icône pour la vue ; la retirer rétablit l’icône du format. Le panneau propose aussi de gérer les sources de données de la page courante, sans les sources nées ailleurs. Modifier la vue ouvre un panneau latéral des réglages de cette vue. Source ouvre directement son sous-écran. Ce panneau regroupe le nom, la disposition, la visibilité, les filtres, le tri, la source et les propriétés. La source et les propriétés sont des sous-écrans du panneau. La commande d’options de la vue ouvre le même panneau. Dupliquer crée une vue de la même source, nommée « nom (1) » lorsque le nom a été choisi. Supprimer reste soumis au choix de la dernière vue d’une source sur sa page d’origine, et au verrou qui empêche de changer la source d’une vue unique.

### Key Entities

- **Page de base**: Élément canonique sans corps éditorial. Elle possède zéro, une ou plusieurs sources et affiche une ou plusieurs vues.
- **Source de données**: Ensemble de pages ou dossiers directs et de propriétés, rattaché à une seule page d'origine, y compris lorsqu'aucune vue ne l'affiche.
- **Entrée de source**: Page ou dossier canonique enfant direct de la page d'origine de la source, avec ses valeurs de propriétés ; les descendants d'un dossier ne sont pas des entrées implicites.
- **Vue**: Affiche une source et définit son format, son icône éventuelle, ses filtres, son tri, son regroupement et ses propriétés visibles.
- **Page de base sans source propre**: Page qui n'affiche que des sources existantes, nommable « Vue de [nom de la source] », avec une flèche sur l'icône.
- **Base intégrée**: Affichage, dans une page classique, des vues de la page de base enfant créée avec elle.
- **Lien interne**: Référence explicite insérée lors d'une création pleine page, distincte du placement hiérarchique.

## Success Criteria

### Measurable Outcomes

- **SC-001**: La pleine page et l'intégrée créent chacune une page de base sous la page courante. La pleine page ouvre cette page après un lien d'enfant. L'intégrée affiche dans la page classique les vues de la page enfant.
- **SC-002**: Les trois choix du `+` sont disponibles aux emplacements demandés ; aucune page ordinaire n'affiche le bouton « Ajouter une base » sous son contenu.
- **SC-003**: Dans les parcours Table et Kanban, 100 % des nouvelles entrées, pages ou dossiers, ont une seule identité et un placement enfant sous leur base ; la création d'une base enfant est refusée.
- **SC-004**: Une modification d'entrée se retrouve dans toutes les vues de sa source après rechargement et synchronisation, sans doublon ; les vues conservent des sources, filtres, tris et formats propres.
- **SC-005**: Une installation de développement réinitialisée démarre avec le nouveau modèle ; les bases et entrées créées ensuite passent un aller-retour d'export/restauration sans perte d'identité ni de valeur.
- **SC-006**: Retirer la dernière vue d'une source sur sa page d'origine sans supprimer la source conserve ses entrées. Supprimer la page d'origine après la confirmation enlève ses sources, et chaque vue ailleurs affiche exactement « Aucun résultat : la source de données demandée n'existe plus. »
- **SC-007**: Sur écran de 320 px et sur desktop, une vue intégrée reste dans la largeur du texte ; ses colonnes larges défilent à l'intérieur de la vue.
- **SC-008**: Une entrée déplacée hors de sa base puis replacée dans celle-ci retrouve toutes ses valeurs de propriétés précédemment enregistrées pour cette source.
- **SC-009**: La commande dédiée insère une vue d'une source existante sans créer de nouvelle source ; les cinq formats retenus peuvent être choisis pour les vues de la première refonte.
- **SC-010**: Une page de base peut posséder plusieurs sources ou aucune. Une base intégrée montre les mêmes onglets que sa page de base enfant. Une page sans source propre porte la flèche ; une page qui possède une source ne la porte pas.
- **SC-011**: Un import Notion de test avec deux sources et des entrées produit deux pages de base propriétaires et aucune entrée de source à la racine ; l'aperçu et l'application décrivent les mêmes placements.

## Assumptions

- Le propriétaire unique et les garanties existantes de chiffrement, disponibilité hors ligne, synchronisation, sauvegarde et export restent applicables.
- Les types de propriétés déjà livrés ne sont pas redéfinis par cette feature ; les cinq formats de vue retenus sont Table, Kanban, Galerie, Liste et Calendrier.
- « Sous la page courante » désigne un placement hiérarchique enfant ; « lien » désigne un élément dans le contenu éditorial, distinct de ce placement. Les éléments enfants sont visibles dans l'arborescence.
- Le propriétaire autorise la suppression des anciennes bases et entrées de développement avant la V1. La procédure de remise à zéro est explicite et bornée ; elle ne doit pas se déclencher silencieusement lors d'une simple ouverture du client.

## Out of Scope

- Une copie exacte des pixels, couleurs ou intitulés de Notion ; formules, automatisations, nouvelles familles de propriétés et nouveaux formats de vue au-delà des cinq retenus.
- La création d'une base sans élément canonique dans la hiérarchie.
- Le déplacement d'une source vers une autre page sans déplacer sa page d'origine.
- Le partage public ou un nouveau modèle de permission entre propriétaires.
