# Feature Specification: Recherche initiale du workspace

**Feature Branch**: codex/008-search

**Created**: 2026-08-19

**Status**: Draft

**Input**: User description: "Poursuivre la trajectoire produit avec la feature
008 de recherche V1, avant les bases structurées, le graphe, les tableaux
blancs, le partage public et MCP."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 6.1, 12, 17 à 21, 28, 29, 33, 42 et 43
du [canevas produit](../../docs/product/product-canvas.md). Elle fournit la
recherche initiale obligatoire de la V1 après les features 001 à 007.

Les fondations existantes restent propriétaires de leurs données : identités
canoniques et cycle de vie (001), chiffrement et propriétaire unique (002),
navigation et édition (003), conversion des items (004), fichiers et
disponibilité locale (005), synchronisation et conflits (006), sauvegarde et
restauration (007). La recherche est une vue dérivée et reconstruisible de ces
données ; elle ne devient jamais une seconde source de vérité.

Le périmètre V1 de cette feature couvre :

- le titre des pages, dossiers et fichiers actifs ;
- le contenu éditorial courant des pages ;
- le nom courant des fichiers ;
- le chemin, le type et l'état de disponibilité nécessaires pour identifier
  et ouvrir un résultat ;
- la recherche locale des données présentes sur l'appareil et la recherche
  complète du workspace lorsque le serveur est disponible.

Les propriétés et tâches structurées seront ajoutées avec la feature 009. Les
relations, backlinks et parcours de graphe appartiennent à la feature 010. Le
contenu extrait des PDF, images, archives ou autres pièces jointes, la recherche
publique, la recherche MCP, la recherche sémantique ou assistée par IA, ainsi
que les syntaxes de requête avancées sont hors périmètre de cette recherche
initiale.

Le produit reste strictement mono-utilisateur. Les résultats privés sont
accessibles au propriétaire authentifié uniquement. Les futures surfaces
publiques ou MCP devront réutiliser des projections séparées et explicitement
autorisées plutôt qu'élargir implicitement cette recherche.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Retrouver rapidement un contenu du workspace (Priority: P1)

En tant que propriétaire, je peux rechercher un mot ou plusieurs mots depuis
n'importe où dans l'application et retrouver une page, un dossier ou un fichier
par son titre, le contenu d'une page ou le nom d'un fichier.

**Why this priority**: Un workspace devient difficile à utiliser dès que son
contenu dépasse ce que la barre latérale permet de parcourir visuellement. La
recherche globale est le parcours minimal de cette feature.

**Independent Test**: Créer des pages, dossiers et fichiers aux noms distincts,
placer une expression uniquement dans le corps d'une page, lancer plusieurs
requêtes puis ouvrir chaque résultat attendu.

**Acceptance Scenarios**:

1. **Given** une page dont le titre contient les termes recherchés, **When** le
   propriétaire lance la recherche, **Then** la page apparaît avant les
   résultats où ces termes ne figurent que dans le contenu.
2. **Given** une expression présente uniquement dans le contenu courant d'une
   page, **When** elle est recherchée, **Then** la page apparaît avec un extrait
   qui permet de comprendre la correspondance.
3. **Given** un dossier ou un fichier dont le nom correspond, **When** le
   propriétaire le recherche, **Then** le résultat indique son type et son
   emplacement courant.
4. **Given** des différences de casse ou d'accents entre la requête et le
   contenu, **When** le propriétaire recherche les mêmes mots, **Then** les
   résultats pertinents restent trouvables.
5. **Given** un résultat visible, **When** le propriétaire l'ouvre, **Then**
   l'application navigue vers la même identité canonique sans créer de copie ni
   modifier sa position.
6. **Given** aucune correspondance, **When** la recherche se termine, **Then**
   un état vide explicite conserve la requête et ne présente pas l'absence de
   résultat comme une erreur.

---

### User Story 2 - Rechercher sans réseau sans surestimer le contenu local (Priority: P1)

En tant que propriétaire, je peux rechercher ce qui est réellement disponible
sur mon appareil lorsque le serveur est inaccessible, y compris mes changements
locaux non synchronisés, et je comprends immédiatement les limites du résultat.

**Why this priority**: La recherche ne doit pas annuler la promesse local-first
ni laisser croire qu'un résultat local représente tout le serveur.

**Independent Test**: Charger une partie du workspace, conserver une page
déchargée avec ses métadonnées, couper le réseau, modifier une page locale puis
rechercher les contenus locaux, les changements en attente et une expression
présente seulement dans le contenu déchargé.

**Acceptance Scenarios**:

1. **Given** un appareil hors ligne, **When** le propriétaire recherche un
   titre ou une métadonnée conservée localement, **Then** l'item reste trouvable
   même si son contenu complet a été déchargé.
2. **Given** une page disponible localement, **When** son contenu est modifié et
   confirmé localement, **Then** la nouvelle valeur devient recherchable sans
   attendre le serveur.
3. **Given** une expression présente seulement dans le contenu complet d'une
   page déchargée, **When** l'appareil est hors ligne, **Then** la recherche
   n'invente pas de correspondance et explique que les résultats sont limités
   aux données locales.
4. **Given** un résultat dont le contenu complet n'est pas local, **When** le
   propriétaire tente de l'ouvrir hors ligne, **Then** son titre et ses
   métadonnées restent visibles et l'indisponibilité du contenu est expliquée.
5. **Given** une recherche locale puis une reconnexion, **When** la recherche
   complète reprend, **Then** les résultats locaux et serveur sont réunis par
   identité stable sans doublon ni remplacement d'un changement local plus
   récent par une donnée distante obsolète.

---

### User Story 3 - Affiner et parcourir les résultats au clavier (Priority: P2)

En tant que propriétaire, je peux limiter une recherche à un type de contenu ou
à une branche de la hiérarchie, puis parcourir et ouvrir les résultats sans
quitter le clavier, sur écran large comme à 320 pixels.

**Why this priority**: Une longue liste non filtrable ralentit la recherche et
un parcours inaccessible au clavier rend une fonction centrale inutilisable.

**Independent Test**: Préparer des homonymes dans plusieurs branches et de
plusieurs types, ouvrir la recherche au clavier, appliquer chaque filtre,
parcourir les résultats, fermer puis recommencer à 320 pixels.

**Acceptance Scenarios**:

1. **Given** plusieurs résultats homonymes, **When** le propriétaire limite la
   recherche aux pages, dossiers ou fichiers, **Then** seuls les types choisis
   restent affichés et le filtre actif est visible.
2. **Given** une branche choisie, **When** le propriétaire limite la portée à
   cette branche, **Then** seuls l'élément racine et ses descendants actifs
   peuvent apparaître.
3. **Given** la recherche ouverte, **When** le propriétaire utilise uniquement
   le clavier, **Then** il peut saisir, choisir un filtre, parcourir, ouvrir un
   résultat et fermer la recherche avec un focus prévisible.
4. **Given** une largeur de 320 pixels ou un zoom à 200 %, **When** les résultats
   sont affichés, **Then** la requête, les filtres, les titres, les types et les
   actions essentielles restent utilisables sans défilement horizontal de la
   page.

---

### User Story 4 - Faire confiance à des résultats frais et récupérables (Priority: P2)

En tant que propriétaire, je peux faire confiance à la recherche après un
renommage, un déplacement, une synchronisation, une suppression, un
redémarrage ou une restauration, sans voir de contenu obsolète ou inaccessible.

**Why this priority**: Une recherche rapide mais fausse détériore la confiance
dans les données et peut révéler du contenu qui aurait dû disparaître.

**Independent Test**: Renommer, déplacer, modifier, mettre à la corbeille,
restaurer et supprimer définitivement des items sur plusieurs appareils,
redémarrer les services et restaurer une sauvegarde de référence, puis comparer
les résultats avec l'état canonique attendu.

**Acceptance Scenarios**:

1. **Given** un item renommé ou déplacé, **When** l'opération est acceptée,
   **Then** son résultat conserve la même identité et affiche le nouveau titre
   et le nouveau chemin sans ancienne entrée résiduelle.
2. **Given** un item placé dans la corbeille, **When** une recherche ordinaire
   est lancée, **Then** cet item n'apparaît plus parmi les contenus actifs ;
   après restauration, il redevient trouvable.
3. **Given** un item supprimé définitivement, **When** l'opération est acceptée,
   **Then** aucun titre, extrait ou résultat actif ne reste accessible par la
   recherche.
4. **Given** une mutation reçue ou rejouée plusieurs fois, **When** l'index est
   mis à jour, **Then** elle produit le même résultat final et aucune entrée en
   double.
5. **Given** un index absent, corrompu ou restauré depuis une sauvegarde, **When**
   la vérification détecte l'écart, **Then** l'index peut être reconstruit depuis
   les données canoniques sans modifier ces données ni perdre les changements
   en attente.
6. **Given** une erreur ou une reconstruction en cours, **When** le propriétaire
   recherche, **Then** l'interface conserve la requête et distingue clairement
   des résultats complets, locaux, incomplets ou temporairement indisponibles.

### Edge Cases

- Une requête est vide, composée uniquement d'espaces ou ne contient qu'un
  caractère visible.
- Une requête dépasse la longueur maximale documentée.
- Plusieurs items distincts portent exactement le même titre dans la même
  branche ou dans des branches différentes.
- Une correspondance chevauche deux blocs ou des caractères combinés.
- Le titre correspond exactement mais le contenu contient de très nombreuses
  occurrences.
- Une page est modifiée localement pendant qu'une réponse serveur plus ancienne
  arrive.
- Un conflit non résolu possède deux versions contenant des termes différents.
- Un item change de type entre page et dossier pendant qu'une recherche est
  ouverte.
- Un item est mis à la corbeille, restauré ou supprimé définitivement pendant
  l'affichage des résultats.
- Une branche profonde est déplacée alors qu'elle sert de filtre de portée.
- Une reconstruction est interrompue puis reprise après redémarrage.
- Le stockage local atteint sa limite pendant la mise à jour de l'index.
- Un contenu contient du HTML, du code, des caractères de contrôle ou une
  séquence ressemblant à un secret ; l'extrait reste du texte sûr et les
  journaux ne le recopient pas.

## Requirements *(mandatory)*

### Functional Requirements

**Recherche et correspondance**

- **FR-001**: Le propriétaire MUST pouvoir ouvrir une recherche globale depuis
  la navigation et par une action clavier documentée.
- **FR-002**: Toute requête contenant au moins un caractère visible MUST pouvoir
  rechercher les titres des pages et dossiers actifs ainsi que les noms des
  fichiers actifs.
- **FR-003**: La recherche MUST couvrir le contenu éditorial courant des pages
  dont le contenu est disponible dans la portée interrogée.
- **FR-004**: Les différences de casse et d'accents MUST NOT empêcher une
  correspondance portant sur les mêmes mots.
- **FR-005**: Une requête composée de plusieurs termes MUST privilégier les
  résultats qui satisfont tous les termes ; un titre exact ou commençant par la
  requête MUST précéder une correspondance trouvée uniquement dans le contenu.
- **FR-006**: L'ordre de résultats équivalents MUST être stable et explicable
  afin qu'une même requête sur le même état ne change pas arbitrairement.
- **FR-007**: Chaque résultat MUST identifier l'item canonique, son type, son
  titre courant, son chemin courant, le champ correspondant et son état de
  disponibilité locale.
- **FR-008**: Une correspondance dans le contenu MUST fournir un extrait textuel
  sûr centré sur un terme correspondant, sans exécuter ni interpréter le
  contenu.
- **FR-009**: Ouvrir un résultat MUST naviguer vers son identité canonique
  actuelle sans créer de copie ni altérer sa hiérarchie.
- **FR-010**: Le propriétaire MUST pouvoir limiter la recherche à un ou
  plusieurs types pris en charge et à l'ensemble d'une branche hiérarchique.

**Local-first, synchronisation et conflits**

- **FR-011**: Hors ligne, la recherche MUST interroger uniquement les titres,
  métadonnées et contenus réellement présents sur l'appareil.
- **FR-012**: Une page déchargée MUST rester trouvable localement par son titre
  et ses métadonnées conservées, sans prétendre que son contenu complet a été
  recherché.
- **FR-013**: Une modification confirmée localement MUST être reflétée dans la
  recherche locale sans attendre sa synchronisation.
- **FR-014**: Les changements locaux en attente, y compris une création, un
  renommage, un déplacement, une modification et une mise à la corbeille, MUST
  être appliqués à la vue de recherche de manière atomique avec l'état local
  annoncé comme enregistré.
- **FR-015**: L'interface MUST indiquer si les résultats couvrent le workspace
  complet, seulement les données locales, ou un ensemble incomplet en cours de
  récupération.
- **FR-016**: Après reconnexion, les résultats locaux et serveur MUST être
  réunis par identité stable, sans doublon et sans écraser une version locale
  plus récente ou un conflit non résolu.
- **FR-017**: Le traitement des changements synchronisés et de leurs reprises
  MUST être idempotent.
- **FR-018**: Un conflit non résolu MUST rester signalé sur le résultat
  concerné ; la recherche MUST NOT choisir silencieusement une version comme
  vérité finale.

**Cycle de vie, durabilité et sécurité**

- **FR-019**: Une recherche ordinaire MUST exclure les items placés dans la
  corbeille et MUST les réintégrer après restauration.
- **FR-020**: Une suppression définitive MUST retirer tout résultat, extrait et
  donnée dérivée active correspondante sans supprimer les références
  diagnostiques que les features de cycle de vie doivent conserver.
- **FR-021**: Renommer, déplacer ou convertir un item MUST conserver son
  identité de recherche et remplacer ses anciennes valeurs dérivées sans entrée
  fantôme.
- **FR-022**: Les index de recherche contenant des données sensibles MUST être
  chiffrés par l'application au repos sur le serveur et sur chaque appareil.
- **FR-023**: Les clés, requêtes, titres, extraits et contenus privés MUST NOT
  être écrits dans les journaux, diagnostics, métriques ou messages d'erreur.
- **FR-024**: La recherche privée MUST refuser toute requête qui n'est pas
  autorisée comme propriétaire de l'installation.
- **FR-025**: L'index MUST pouvoir être vérifié et reconstruit entièrement
  depuis les données canoniques compatibles sans les modifier.
- **FR-026**: Les sauvegardes et restaurations MUST préserver soit un index
  vérifiable compatible, soit toutes les informations et procédures nécessaires
  à sa reconstruction avant que la recherche soit déclarée complète.
- **FR-027**: Une reconstruction interrompue MUST reprendre ou recommencer
  proprement sans publier un mélange silencieux d'ancien et de nouvel index.
- **FR-028**: Une erreur de recherche, de déchiffrement ou d'intégrité MUST
  échouer explicitement sans exposer de contenu privé ni présenter des
  résultats partiels comme complets.

**Expérience et accessibilité**

- **FR-029**: La recherche MUST exposer des états distincts pour saisie vide,
  chargement, résultats, absence de résultat, portée locale, portée incomplète
  et erreur récupérable.
- **FR-030**: La requête et les filtres MUST rester visibles et modifiables
  pendant le chargement, après une erreur et dans l'état vide.
- **FR-031**: La saisie, les filtres, la liste, la sélection, l'ouverture et la
  fermeture MUST être utilisables au clavier avec un focus visible et des noms,
  rôles, états et annonces accessibles.
- **FR-032**: Le parcours essentiel MUST rester utilisable à partir de 320
  pixels de largeur, à 200 % de zoom et avec une préférence de réduction des
  animations.
- **FR-033**: Les résultats MUST être paginés ou chargés progressivement sans
  déplacer arbitrairement la sélection clavier ni bloquer l'ouverture des
  premiers résultats.
- **FR-034**: Une requête contenant jusqu'à 512 caractères Unicode MUST être
  acceptée ; une requête plus longue MUST être refusée avec un message
  exploitable, sans être tronquée silencieusement ni recopiée dans les
  journaux.

### Key Entities

- **Requête de recherche**: texte saisi par le propriétaire, termes normalisés,
  portée et filtres actifs, sans conservation implicite dans les journaux.
- **Document recherchable**: projection dérivée d'une identité canonique avec
  son type, son cycle de vie, son titre ou nom courant, son contenu textuel
  autorisé et son chemin courant.
- **Résultat de recherche**: identité canonique, informations d'identification,
  raison de la correspondance, extrait sûr, rang et disponibilité locale.
- **Portée de recherche**: workspace entier, données présentes localement ou
  branche hiérarchique choisie.
- **État d'index**: version, compatibilité, progression, dernier changement
  appliqué, intégrité et état de reconstruction d'une projection dérivée.
- **Conflit de contenu**: état déjà conservé par la synchronisation que la
  recherche signale sans le résoudre ni en supprimer une version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sur le jeu de référence de 100 000 pages et 1 000 000 de blocs,
  les 20 premiers résultats d'une recherche complète sont visibles en moins
  d'une seconde dans au moins 95 % des mesures sur l'environnement de référence.
- **SC-002**: Sur un appareil contenant 10 000 items locaux, les 20 premiers
  résultats locaux sont visibles en moins de 300 millisecondes dans au moins
  95 % des mesures.
- **SC-003**: Une modification confirmée localement devient trouvable localement
  en moins d'une seconde dans au moins 95 % des mesures, sans dépendre du réseau.
- **SC-004**: Une modification acceptée par le serveur devient trouvable sur un
  autre appareil connecté en moins de deux secondes dans au moins 95 % des
  mesures en conditions réseau normales.
- **SC-005**: Dix mille créations, modifications, renommages, déplacements,
  mises à la corbeille, restaurations et relectures idempotentes produisent zéro
  résultat en double, zéro identité remplacée et zéro extrait définitivement
  supprimé encore accessible.
- **SC-006**: Une reconstruction après interruption, redémarrage ou restauration
  retrouve exactement le même ensemble d'identités et de champs recherchables
  que l'état canonique attendu avant que la recherche soit annoncée complète.
- **SC-007**: Les tests d'autorisation, d'erreur et de diagnostic trouvent zéro
  contenu privé, requête, extrait, clé ou secret dans une réponse non autorisée
  ou un artefact de journalisation.
- **SC-008**: Les parcours clavier et lecteur d'écran permettent d'ouvrir un
  résultat ciblé en moins de 30 secondes à partir de la navigation, sur les
  viewports essentiels de la V1.

## Assumptions

- La feature 007 est fusionnée avant l'intégration finale de la 008 afin que la
  vérification et la restauration des données dérivées utilisent le contrat de
  sauvegarde approuvé.
- La recherche initiale porte sur les types déjà livrés : pages, dossiers et
  fichiers. Les champs structurés ajoutés plus tard étendront le même contrat
  sans redéfinir l'identité d'un résultat.
- Les items de la corbeille restent accessibles par leur parcours de corbeille,
  mais sont exclus de la recherche ordinaire jusqu'à leur restauration.
- Une requête vide ne lance pas de recherche et conserve les parcours de
  récents et favoris déjà fournis par la navigation.
- Les correspondances exactes ou de préfixe dans le titre sont considérées plus
  utiles que les correspondances dans le corps d'une page ; les autres égalités
  utilisent un ordre stable documenté lors de la planification.
- La langue française est la langue d'interface initiale. La normalisation de
  casse et d'accents ne doit pas empêcher l'ajout ultérieur d'autres règles
  linguistiques explicites.

## Out of Scope

- Propriétés, tâches structurées et vues de base de données — feature 009.
- Backlinks, recherche relationnelle et exploration du graphe — feature 010.
- Extraction ou OCR du contenu des pièces jointes ; seuls leurs noms et
  métadonnées d'identification sont couverts ici.
- Recherche dans les tableaux blancs — feature 011.
- Recherche publique — feature 012.
- Recherche et permissions MCP — feature 013.
- Recherche sémantique, embeddings, recommandations et génération par IA.
- Opérateurs avancés, langage de requête, recherches enregistrées et alertes.
