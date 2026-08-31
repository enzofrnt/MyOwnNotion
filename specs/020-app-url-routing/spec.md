# Feature Specification: URLs canoniques de l’application

**Feature Branch**: `codex/app-url-routing`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Le front ne doit plus tout afficher sur `/`. Chaque page de l’application ainsi que chaque page ou dossier de notes doit posséder sa propre URL. La séparation entre pages et composants doit rester claire, et les tests/CI doivent être surveillés par des sous-agents économiques. Partir de `main`."

## Product Direction, Dependencies, and Scope

Cette feature affine les sections 2.13, 6.1, 7, 10, 11, 12, 12.1, 18, 39, 42, 43.4, 43.6 et 47 du canevas produit `docs/product/product-canvas.md`.

- **Direction produit** : l’espace principal reste réservé aux contenus de connaissance, tandis que les réglages et opérations vivent dans des destinations dédiées. Les pages, dossiers et entrées de base conservent leur identité stable après renommage, déplacement ou conversion.
- **Dépendances** : modèle canonique et identifiants stables (001/004), sécurité mono-propriétaire (002), navigation et workspace V1 (017), stockage local et fonctionnement hors ligne (005/006/018), bases dont les entrées sont des pages (009).
- **Périmètre** : adressage URL du setup, de la connexion, du workspace, des pages/dossiers/entrées de base, de chaque section de réglages et des états introuvables ; navigation directe, rechargement et historique du navigateur.
- **Exclusions** : partage public, URLs fondées sur le titre, migration de données canonique, changement du modèle de permissions, transformation de la recherche modale en page, nouvelle surface autonome pour les fichiers et choix de bibliothèque de routage.

## Canonical Destination Contract

Les destinations utilisateur utilisent les formes suivantes. Les noms techniques des routes ne font pas partie du modèle de contenu et peuvent être traduits en composants sans dupliquer les données.

| Destination | URL canonique |
| --- | --- |
| Entrée de l’application | `/` redirige vers la destination autorisée pertinente |
| Initialisation du propriétaire | `/setup` |
| Connexion | `/login` |
| Workspace sans sélection | `/notes` |
| Page, dossier, base ou entrée de base | `/notes/:itemId` |
| Réglages par défaut | `/settings` redirige vers `/settings/security` |
| Sécurité et appareils | `/settings/security` |
| Présentation de la navigation | `/settings/navigation` |
| Sauvegardes | `/settings/backups` |
| Stockage et synchronisation | `/settings/storage-sync` |
| Corbeille | `/settings/trash` |
| Détails d’une page ou d’un dossier | `/settings/page/:itemId` |

Les paramètres d’une vue de base peuvent rester dans la partie requête de l’URL. L’identité de la page ou de l’entrée reste portée par `:itemId`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ouvrir et retrouver une note par son URL (Priority: P1)

Le propriétaire peut copier l’adresse d’une page, d’un dossier, d’une base ou d’une entrée de base, la recharger et la rouvrir plus tard sur un appareil autorisé. Renommer, déplacer ou convertir l’élément ne casse pas cette adresse parce qu’elle repose sur son identité canonique.

**Why this priority**: Une URL propre à chaque contenu est le besoin principal et supprime la sélection cachée derrière `/`.

**Independent Test**: Créer une page et un dossier, ouvrir chacun depuis la barre latérale, vérifier leur URL, recharger puis utiliser précédent/suivant ; chaque étape doit afficher le contenu désigné sans perdre les changements locaux.

**Acceptance Scenarios**:

1. **Given** une page active, **When** le propriétaire l’ouvre depuis l’arbre, un favori, un récent, la recherche ou un lien interne, **Then** l’URL devient `/notes/:itemId` et la page correspondant exactement à cet identifiant s’affiche.
2. **Given** un dossier actif, **When** le propriétaire l’ouvre, **Then** l’URL devient `/notes/:itemId` et le canevas de ce dossier s’affiche.
3. **Given** une URL de note valide, **When** le navigateur recharge la page, **Then** l’application rouvre cette identité après hydratation locale sans revenir silencieusement au dernier élément visité.
4. **Given** plusieurs notes ouvertes successivement, **When** le propriétaire utilise précédent puis suivant, **Then** la sélection, le fil d’Ariane et le contenu suivent chaque entrée d’historique dans le bon ordre.
5. **Given** une page renommée, déplacée ou convertie en dossier, **When** son ancienne adresse est rechargée, **Then** la même identité s’ouvre avec son nom, son emplacement et son type actuels.
6. **Given** une entrée de base ouverte depuis une vue, **When** elle devient la destination active, **Then** son identité de page figure dans `/notes/:itemId`, et le retour permet de retrouver la base et son contexte de vue.

---

### User Story 2 - Naviguer entre les vraies pages de l’application (Priority: P1)

Le propriétaire voit dans l’adresse s’il se trouve dans ses notes, dans la sécurité, dans les sauvegardes, dans la navigation, dans le stockage, dans la corbeille ou dans les détails d’un contenu. Il peut recharger ou partager une destination interne entre ses appareils sans dépendre d’un état React invisible.

**Why this priority**: Les surfaces de réglages sont déjà visuellement séparées ; leur donner des routes explicites achève leur séparation fonctionnelle et simplifie le code.

**Independent Test**: Ouvrir chaque destination depuis le workspace et depuis son URL directe, vérifier son URL, son titre, son contenu et les retours arrière/avant.

**Acceptance Scenarios**:

1. **Given** le workspace, **When** le propriétaire ouvre les réglages, **Then** il arrive sur `/settings/security` et le workspace n’est pas rendu comme contenu de cette page.
2. **Given** les réglages ouverts, **When** le propriétaire choisit une autre section, **Then** l’URL, le titre principal et la section active changent ensemble.
3. **Given** une URL directe de réglages valide, **When** elle est rechargée, **Then** la section demandée s’affiche sans passage visible par une autre section.
4. **Given** les détails d’un contenu ouverts, **When** la destination est chargée directement, **Then** l’identité concernée est portée par `/settings/page/:itemId` et les détails correspondent à cet élément.
5. **Given** un retour du réglage vers une note encore disponible, **When** le propriétaire utilise le bouton de retour ou l’historique, **Then** la note, son ancre de lecture et un focus pertinent sont restaurés.
6. **Given** `/settings`, **When** la route est résolue, **Then** elle est remplacée par `/settings/security` sans ajouter un détour inutile à l’historique.

---

### User Story 3 - Atteindre sûrement une destination protégée ou indisponible (Priority: P1)

Une adresse directe continue à représenter l’intention du propriétaire pendant la vérification de session, la connexion, l’initialisation, le hors-ligne ou une erreur de résolution. L’application ne remplace jamais silencieusement une destination inconnue par une autre note.

**Why this priority**: Les liens directs seraient peu fiables s’ils perdaient leur destination pendant l’authentification ou s’ils cachaient les erreurs derrière le dernier élément visité.

**Independent Test**: Ouvrir une note directe sans session, se connecter et vérifier le retour ; répéter hors ligne avec contenu local, avec contenu absent et avec identifiant invalide.

**Acceptance Scenarios**:

1. **Given** une URL protégée sans session valide, **When** le serveur refuse la session, **Then** le propriétaire est conduit à `/login` avec une destination de retour interne sûre, puis revient à l’URL demandée après connexion.
2. **Given** une installation sans propriétaire, **When** une destination protégée est demandée, **Then** `/setup` s’affiche et la destination interne sûre peut être reprise après initialisation.
3. **Given** un appareil hors ligne dont la session ne peut pas être vérifiée, **When** une note présente localement est demandée, **Then** elle reste accessible à son URL sans redirection vers la connexion.
4. **Given** un identifiant valide mais absent du stockage local hors ligne, **When** son URL est ouverte, **Then** un état d’indisponibilité locale explicite s’affiche à cette même adresse.
5. **Given** un identifiant mal formé, supprimé définitivement ou une route inconnue, **When** l’application la résout, **Then** elle affiche un état introuvable explicite avec une action vers `/notes`, sans ouvrir le dernier élément visité.
6. **Given** un paramètre de retour externe, absolu ou mal formé, **When** la connexion réussit, **Then** l’application l’ignore et revient à une destination interne sûre.

### Edge Cases

- Le contenu ciblé est supprimé ou restauré pendant que son URL est ouverte.
- La route est ouverte avant que le stockage local et l’arbre soient hydratés.
- L’identité existe mais son type passe de page à dossier entre deux ouvertures.
- Deux onglets naviguent vers des notes différentes et synchronisent simultanément leur contenu.
- Un événement précédent/suivant arrive pendant le chargement d’une base ou d’une entrée.
- Une URL de base contient un identifiant de vue obsolète ; la page reste valide et choisit une vue active sûre.
- Un lien interne pointe vers la corbeille ; l’état explique que la cible n’est pas active sans la restaurer.
- Le navigateur refuse une écriture History API ; le contenu courant reste monté et utilisable, et une erreur exploitable est observable en test.
- Un chemin contient un slash final, une casse inattendue, un segment supplémentaire ou un encodage invalide.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Chaque destination listée dans le contrat canonique MUST posséder une URL distincte et déterministe.
- **FR-002**: Toute page, tout dossier, toute base et toute entrée de base active MUST être adressable par `/notes/:itemId` à partir de son identifiant canonique stable.
- **FR-003**: Le renommage, déplacement, réordonnancement ou changement page ↔ dossier MUST conserver l’URL d’un élément.
- **FR-004**: La route active MUST être la source de vérité de la destination affichée ; l’application MUST NOT conserver une seconde sélection de page ou section susceptible de diverger de l’URL.
- **FR-005**: Toutes les ouvertures d’un contenu — arbre, favoris, récents, recherche, fil d’Ariane, lien interne, création et entrée de base — MUST utiliser le même mécanisme de navigation.
- **FR-006**: Une navigation utilisateur vers une nouvelle destination MUST créer une entrée d’historique ; une canonicalisation ou redirection automatique MUST remplacer l’entrée courante.
- **FR-007**: Les actions précédent et suivant MUST restaurer la destination exacte, la sélection visuelle, le contenu et le contexte de lecture disponible.
- **FR-008**: Un rechargement direct MUST afficher la destination demandée après résolution de l’état d’installation et de session.
- **FR-009**: `/` MUST conduire à une destination autorisée pertinente et MUST NOT rester l’URL durable d’une page de l’application.
- **FR-010**: `/settings` MUST conduire à `/settings/security` par remplacement d’historique.
- **FR-011**: Chaque section de réglages actuellement livrée MUST être accessible par son URL canonique, y compris les détails liés à un item.
- **FR-012**: L’ouverture des réglages MUST conserver un contexte de retour vers la note active sans rendre le workspace comme contenu des réglages.
- **FR-013**: L’application MUST préserver une destination protégée demandée pendant la connexion ou l’initialisation et la reprendre après succès.
- **FR-014**: Une destination de retour MUST être limitée aux chemins internes reconnus ; une URL externe ou mal formée MUST être refusée.
- **FR-015**: Une indisponibilité réseau pendant la vérification de session MUST préserver l’accès aux notes présentes localement conformément au comportement local-first existant.
- **FR-016**: Une note demandée mais absente localement hors ligne MUST afficher un état d’indisponibilité explicite sans changer l’URL.
- **FR-017**: Un identifiant mal formé, un item introuvable, une section inconnue ou un chemin inconnu MUST afficher un état explicite et MUST NOT sélectionner le dernier item visité.
- **FR-018**: Les redirections et erreurs de route MUST NOT entraîner de mutation, restauration, suppression ou synchronisation de contenu.
- **FR-019**: Les paramètres de vue d’une base MAY rester dans la requête, mais l’identité de la base ou de l’entrée MUST rester dans le chemin canonique.
- **FR-020**: Les routes MUST fonctionner lors d’un chargement direct avec le serveur de développement et l’image Web Compose officielle.
- **FR-021**: Le shell hors ligne et ses ressources MUST reconnaître les routes canoniques comme des navigations d’application et rester disponibles après mise en cache initiale.
- **FR-022**: La route interne de laboratoire UI `/__ui-lab` MUST rester isolée du démarrage API/CRDT et ne constitue pas une destination utilisateur.
- **FR-023**: La recherche modale et les dialogues contextuels MUST conserver la route de leur page sous-jacente tant qu’ils ne deviennent pas des destinations produit dédiées.
- **FR-024**: Le code de routage MUST séparer la reconnaissance des chemins, la protection de session et le rendu des pages afin que les composants métier ne reconstruisent pas manuellement des URLs.
- **FR-025**: Les parcours modifiés MUST avoir des tests unitaires/composant et Playwright couvrant le rechargement direct, précédent/suivant, desktop et viewport étroit sur les navigateurs pris en charge.
- **FR-026**: Les contrôles locaux complets et la CI de pull request MUST rester bloquants ; leur exécution peut être surveillée par des sous-agents économiques, mais leur résultat réel reste l’autorité de validation.

### Key Entities

- **Destination applicative**: représentation d’un chemin reconnu, de ses paramètres validés et de son niveau d’accès (public d’installation ou propriétaire).
- **Destination de contenu**: destination applicative qui référence un item canonique stable et dont le rendu dépend de son type actuel.
- **Destination de réglages**: section opérationnelle distincte du workspace, éventuellement liée à une identité de contenu.
- **Contexte de retour**: chemin interne sûr, ancre de lecture et cible de focus permettant de revenir d’une destination secondaire.
- **Entrée d’historique**: instantané de navigation propre à un onglet ; elle ne constitue jamais une donnée canonique ni synchronisée.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % des pages, dossiers, bases et entrées de base créés par les parcours automatisés obtiennent une URL `/notes/:itemId` qui rouvre la même identité après rechargement.
- **SC-002**: 100 % des sections de réglages livrées sont accessibles directement par une URL distincte et affichent le bon titre et contenu sans détour visible.
- **SC-003**: Les parcours précédent/suivant sur au moins cinq destinations successives restituent leur ordre et leur contenu sans divergence entre URL, arbre, fil d’Ariane et canevas.
- **SC-004**: 100 % des tests de renommage, déplacement et conversion conservent l’adresse de l’item et ouvrent son état actuel.
- **SC-005**: Un lien direct protégé reprend la destination demandée après connexion dans tous les scénarios automatisés, tandis que 100 % des destinations de retour externes sont refusées.
- **SC-006**: Un rechargement hors ligne d’une note mise en cache reste utilisable ; une note non disponible affiche un état explicite sans perte ni redirection trompeuse.
- **SC-007**: Les chemins inconnus, identifiants invalides et éléments introuvables n’ouvrent jamais un autre contenu dans les tests négatifs.
- **SC-008**: Les routes directes réussissent sur les cinq profils Playwright maintenus, en viewport desktop et étroit selon la matrice existante.
- **SC-009**: Les tests de routage vérifient qu’aucune destination utilisateur ne reste durablement sur `/` après résolution de l’application.
- **SC-010**: Le contrôle local obligatoire du dépôt réussit sans test ignoré, et chaque phase longue de test/CI surveillée rapporte explicitement succès ou échec.

## Assumptions

- L’identifiant canonique est préféré à un titre ou slug pour garantir la stabilité après renommage, déplacement et conversion.
- Une entrée de base est une page et utilise donc la même famille de routes `/notes/:itemId`.
- La sélection d’un fichier autonome n’est pas transformée en nouvelle page dans cette feature ; une future surface de fichier pourra recevoir sa propre famille de routes.
- La recherche reste un dialogue global et conserve l’URL de la destination sous-jacente.
- Les détails de page utilisent l’identité explicite du chemin et ne dépendent pas d’une sélection conservée uniquement en mémoire.
- Le stockage local, la synchronisation, le chiffrement, les cookies et les identifiants canoniques existants ne nécessitent aucune migration de données.
- Le choix d’un routeur et la stratégie de découpage des composants appartiennent au plan technique.

## Out of Scope

- URLs publiques ou partageables sans authentification.
- Slugs lisibles dérivés des titres, alias historiques et redirections après changement de titre.
- Transformation de la recherche, des menus, popovers ou dialogues en pages dédiées.
- Nouvelle prévisualisation autonome pour les fichiers hiérarchiques.
- Modification des règles de session, du protocole de synchronisation ou du modèle canonique.
- Déclenchement de CI sur le push de la branche de travail ; la première CI automatisée reste celle de la pull request.
