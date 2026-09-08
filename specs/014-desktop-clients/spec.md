# Feature Specification: Applications Desktop Electron Windows, macOS et Linux

**Feature Branch**: `014-desktop-clients`

**Created**: 2026-08-16

**Status**: Next implementation — start now

**Input**: User description: "Planifier la création des applications Electron Windows, macOS et Linux à la suite de la trajectoire prévue, en réutilisant les fondations et le workflow Spec Kit du dépôt. Chaque artefact est natif à sa plateforme et à son architecture ; GitHub Actions construit et publie les trois familles."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 6.1, 7 et 47 du
[`docs/product/product-canvas.md`](../../docs/product/product-canvas.md) et la
feature 014 de la roadmap. Depuis la clarification du 3 septembre 2026, elle
est le **prochain travail d'implémentation**, avant la clôture formelle de la
V1 : le Web responsive ne suffit plus ; le propriétaire doit aussi pouvoir
installer un hôte desktop Windows, macOS ou Linux, chacun fourni comme un
paquet propre à son système et à son architecture. Les journaux serveur (021), le
journey Playwright 022 T040 et la convergence finale 017 T319 attendent la
livraison de cette feature. Elle transforme le client Web existant en
applications de bureau distribuables, sans créer une seconde source de vérité
métier.

La chaîne d'outils exclusive est déjà Bun 1.4.0 (feature 019, fusionnée) :
`bun ci`, `bun.lock`, scripts et images. Cette feature ne réintroduit ni
pnpm, ni npm, ni Yarn, ni un runtime Node.js first-party. Electron packagé
reste l'hôte natif de la fenêtre, pas un second gestionnaire de paquets.

Elle dépend des fondations V1 du client Web déjà livrées ou en cours : modèle
canonique (001), sécurité (002), workspace et éditeur (003, 017), conversion
(004), fichiers (005), synchronisation (006, 018), sauvegarde (007), recherche
(008), bases déjà livrées (009), graphe (010), chaîne Bun (019) et routage
(020, 022). Les features métier restent propriétaires de leurs contrats ; cette
feature fournit leur hôte desktop commun.

Elle ne dépend pas des tableaux blancs, du partage public ni de MCP (011 à
013). Ces capacités restent après la V1 ; le même hôte les accueillera plus
tard sans seconde application. La feature 021 (journaux serveur) reste une
condition de sortie V1 distincte : son implémentation commence **après** la
014. Elle ne bloque pas le démarrage du desktop.

Le produit reste strictement mono-utilisateur : une installation possède un
seul propriétaire, un seul workspace canonique et plusieurs appareils
autorisés. L’application desktop ne contient pas de serveur embarqué, ne crée
pas de compte supplémentaire et ne contourne ni l’authentification, ni la
révocation, ni la compatibilité de protocole.

## User Scenarios & Testing

### User Story 1 — Installer et connecter le client desktop (Priority: P1)

En tant que propriétaire, je peux installer l’application Windows, macOS ou
Linux correspondant à ma machine, indiquer l’URL de mon serveur auto-hébergé
et m’authentifier comme nouvel appareil, afin d’utiliser mon workspace dans
une fenêtre dédiée.

**Why this priority**: C’est le parcours minimal qui donne une valeur autonome
au client desktop et permet de vérifier qu’il respecte le serveur existant.

**Independent Test**: Installer l’artefact de test de la plateforme et de
l’architecture de la machine (Windows, macOS ou Linux), saisir une URL locale
puis une URL distante HTTPS, terminer l’autorisation de l’appareil et ouvrir
une page déjà présente. Vérifier aussi les messages pour une URL
inaccessible, une URL HTTP non locale et un protocole incompatible.

**Acceptance Scenarios**:

1. **Given** une installation neuve, **When** le propriétaire saisit une URL de
   serveur valide et s’authentifie, **Then** l’application crée ou autorise un
   appareil unique et ouvre le workspace sans créer de second propriétaire.
2. **Given** une URL HTTP locale ou explicitement déclarée sûre, **When** le
   client se connecte, **Then** il permet la connexion et indique le niveau de
   sécurité du canal.
3. **Given** une URL HTTP non locale, **When** le client tente de se
   connecter, **Then** il affiche un avertissement explicite et ne présente
   pas le canal comme sécurisé.
4. **Given** un serveur inaccessible ou incompatible, **When** le client
   vérifie la connexion, **Then** il explique l’état et ne lance aucune
   synchronisation d’écriture risquée.
5. **Given** une application redémarrée, **When** le propriétaire revient,
   **Then** le profil serveur, la session autorisée et l’état de synchronisation
   sont retrouvés sans réafficher de secret en clair.

### User Story 2 — Travailler hors ligne avec des données protégées (Priority: P1)

En tant que propriétaire, je peux lire et modifier les contenus déjà chargés
quand le serveur est indisponible, puis reprendre la synchronisation après un
redémarrage, tout en sachant que les données locales sont protégées.

**Why this priority**: Le desktop doit renforcer la promesse local-first du
produit, pas devenir une simple fenêtre dépendante du réseau.

**Independent Test**: Charger une page, couper le réseau, la modifier, créer
une page et provoquer un conflit contrôlé ; fermer et rouvrir l’application,
puis reconnecter le serveur. Vérifier la conservation de chaque mutation, les
états visibles et l’absence d’écrasement silencieux.

**Acceptance Scenarios**:

1. **Given** des contenus déjà disponibles localement, **When** le serveur est
   hors ligne, **Then** le propriétaire peut les consulter et les modifier,
   tandis que l’interface distingue clairement local, en attente, conflit et
   synchronisé.
2. **Given** des changements locaux non synchronisés, **When** l’application
   est fermée brutalement puis relancée, **Then** les changements et leur état
   de synchronisation sont récupérés sans doublon ni perte silencieuse.
3. **Given** une projection locale verrouillée ou une clé d’appareil
   indisponible, **When** le propriétaire tente une écriture, **Then**
   l’application refuse l’écriture et explique comment réautoriser l’appareil.
4. **Given** un appareil déconnecté, révoqué ou déconnecté explicitement,
   **When** ses clés locales sont invalidées, **Then** les contenus protégés ne
   sont plus lisibles par l’application et les données non synchronisées ne
   sont pas supprimées automatiquement.
5. **Given** un conflit détecté à la reconnexion, **When** la synchronisation
   reprend, **Then** les versions locales et distantes restent récupérables et
   le parcours de résolution existant est utilisé.

### User Story 3 — Profiter d’une intégration desktop prévisible (Priority: P2)

En tant que propriétaire, je peux utiliser les conventions de mon système
Windows, macOS ou Linux pour gérer la fenêtre, les raccourcis, les fichiers et
les liens, sans que l’application donne à son contenu distant des privilèges
locaux arbitraires.

**Why this priority**: Une fenêtre installée doit se comporter comme une
application fiable, tout en conservant la frontière de sécurité du client Web.

**Independent Test**: Ouvrir, redimensionner, minimiser, restaurer et fermer
la fenêtre ; utiliser les raccourcis principaux, sélectionner un fichier à
importer, ouvrir un lien externe et relancer l’application. Vérifier les mêmes
parcours sur Windows, macOS et Linux avec clavier seul.

**Acceptance Scenarios**:

1. **Given** une fenêtre ouverte, **When** le propriétaire la ferme puis
   relance l’application, **Then** une seule instance est utilisée et la
   dernière taille, position et page utile sont restaurées sans exposer de
   contenu dans les journaux.
2. **Given** un lien externe ou un fichier sélectionné depuis l’application,
   **When** le propriétaire demande son ouverture, **Then** l’action passe par
   le comportement système attendu et le contenu distant n’obtient pas accès
   au système de fichiers ou au shell sans autorisation explicite.
3. **Given** une fonctionnalité métier ajoutée au client Web, **When** elle
   utilise les contrats client partagés, **Then** elle est disponible dans le
   desktop sans réimplémenter ses règles métier ni son stockage.
4. **Given** une opération sensible ou une erreur de synchronisation, **When**
   le propriétaire consulte les diagnostics locaux, **Then** les messages sont
   actionnables et expurgés des secrets, contenus et clés.

### User Story 4 — Recevoir une mise à jour sans perdre le travail (Priority: P2)

En tant que propriétaire, je peux recevoir une mise à jour signée de
l’application, la reporter si nécessaire et la redémarrer au moment choisi,
avec la garantie que le workspace local et les changements en attente restent
compatibles ou sont préservés.

**Why this priority**: Une application desktop distribuée sans mise à jour
fiable deviendrait rapidement un risque de sécurité et de compatibilité.

**Independent Test**: Installer une version N, préparer des données locales et
une mutation hors ligne, proposer une version N+1 signée, la reporter puis
l’installer. Simuler un échec de téléchargement ou de démarrage et vérifier le
retour à la version précédente sans suppression du coffre local.

**Acceptance Scenarios**:

1. **Given** une version compatible disponible, **When** le client la détecte,
   **Then** il présente sa version, son origine, son intégrité et laisse le
   propriétaire choisir quand redémarrer.
2. **Given** des écritures locales en attente, **When** une mise à jour est
   proposée, **Then** le client avertit le propriétaire et ne prétend pas que
   les données sont sauvegardées sur le serveur.
3. **Given** une mise à jour interrompue ou invalide, **When** l’application
   redémarre, **Then** elle conserve ou restaure une version fonctionnelle et
   le coffre local, sans perte de données.
4. **Given** une version cliente incompatible avec le serveur, **When** le
   propriétaire ouvre l’application, **Then** le client refuse les écritures
   incompatibles et indique la mise à jour requise.

### User Story 5 — Installer des artefacts de confiance (Priority: P3)

En tant que propriétaire, je peux télécharger l’installateur Windows, macOS
ARM ou Linux correspondant à ma machine, vérifiable et prévu pour cette
architecture, puis l’installer depuis ce fichier plutôt que depuis un store.

**Why this priority**: La distribution est nécessaire pour rendre les clients
utilisables, mais elle vient après les parcours fonctionnels et la sécurité
locale.

**Independent Test**: Produire depuis un tag via GitHub Actions les
installateurs Windows et macOS plus, pour chaque Linux, AppImage, deb et rpm ;
vérifier empreintes, confirmer l’absence de store, installer sur les cibles
et exécuter un smoke test de connexion, hors ligne et mise à jour.

**Acceptance Scenarios**:

1. **Given** une version publiée, **When** le propriétaire télécharge
   l’artefact correspondant à son système, **Then** l’installateur s’installe
   sans étape de contournement de sécurité normalement évitable.
2. **Given** un artefact altéré, incomplet ou provenant d’un canal non autorisé,
   **When** le propriétaire tente de l’installer ou de le mettre à jour,
   **Then** l’opération est refusée ou clairement signalée comme non fiable.
3. **Given** une publication desktop, **When** le pipeline de release
   s’exécute, **Then** il attache les fichiers de la matrice (Windows x64 et
   ARM, macOS ARM, Linux x64 et ARM chacun en AppImage, deb et rpm), avec
   empreintes et version, sans secret de signature, sans store et sans
   artefact hors matrice (Intel Mac, paquet universel).
4. **Given** un artefact destiné à un système et une architecture, **When** on
   inspecte son contenu, **Then** il ne contient que le runtime et les
   ressources nécessaires à cette cible, pas ceux d’un autre OS ni d’une
   autre architecture.

## Edge Cases

- Le serveur est configuré en HTTP sur une adresse privée non reconnue comme
  locale : le client demande une déclaration explicite et ne masque pas le
  risque.
- Le même serveur est ajouté deux fois avec des variantes d’URL : le client
  évite de créer deux appareils ou deux coffres pour le même appareil sans
  confirmation explicite.
- Le propriétaire révoque l’appareil depuis le Web pendant que l’application
  desktop est hors ligne : les données locales restent intactes, mais les
  nouvelles opérations sont bloquées dès que la révocation est connue.
- Le coffre local est corrompu, inaccessible ou incompatible après une mise à
  jour : l’application refuse de lire ou d’écrire en clair et propose le
  parcours de récupération prévu.
- Une mise à jour arrive alors qu’un fichier est en cours d’import ou qu’une
  mutation est en conflit : l’opération est terminée, reportée ou reprise avec
  un état explicite ; elle n’est jamais déclarée synchronisée prématurément.
- Une URL de serveur redirige vers une autre origine ou tente de charger du
  code distant : l’application bloque la navigation ou l’exécution non prévue.
- Le système ne fournit temporairement pas de coffre de clés utilisable : le
  client peut rester en lecture si les garanties le permettent, mais ne doit
  pas écrire des données sensibles non chiffrées.
- L’utilisateur ouvre plusieurs fenêtres ou lance deux fois le programme :
  une seule instance coordonne l’accès au profil local et les autres demandes
  sont traitées sans corruption.
- Le propriétaire télécharge l’artefact d’un autre système ou d’une autre
  architecture : l’installateur ou le système refuse clairement ; le produit
  ne fournit pas de lanceur universel qui masquerait l’erreur.
- Un canal de mise à jour propose un artefact d’une autre plateforme : le
  client refuse l’installation et conserve la version déjà en place.

## Requirements

### Functional Requirements

- **FR-001**: Le client desktop MUST réutiliser le client Web, le cœur client,
  les contrats et le modèle canonique existants ; aucune règle métier ou copie
  concurrente du stockage ne doit être introduite dans la couche desktop.
- **FR-002**: Le client MUST permettre de configurer une URL de serveur, vérifier
  son accessibilité, sa compatibilité de protocole, l’état d’authentification et
  la sécurité du canal avant d’autoriser les opérations d’écriture.
- **FR-003**: Le client MUST conserver les profils de serveur, sessions,
  préférences et états locaux nécessaires après redémarrage, avec séparation
  explicite entre chaque appareil autorisé et chaque serveur configuré.
- **FR-004**: Le client MUST utiliser le parcours d’autorisation d’appareil et
  de révocation défini par la fondation de sécurité ; il ne doit créer ni
  deuxième propriétaire, ni permission implicite.
- **FR-005**: Le client MUST rendre disponibles hors ligne les contenus déjà
  présents localement, les mutations et conflits conservés par le cœur client,
  y compris après fermeture inattendue et redémarrage.
- **FR-006**: Les contenus, index sensibles, sessions persistantes, mutations
  en attente et secrets locaux MUST être chiffrés avant leur stockage durable ;
  les clés MUST être protégées par le mécanisme sécurisé de la plateforme et ne
  doivent pas être exportables en clair.
- **FR-007**: La perte, la révocation, la déconnexion ou le verrouillage d’une
  clé MUST empêcher les nouvelles lectures/écritures protégées selon l’état
  défini par la sécurité, sans supprimer automatiquement les mutations locales
  non synchronisées.
- **FR-008**: Le client MUST fonctionner avec une interface clavier complète,
  des états de chargement/hors-ligne/erreur visibles, des menus et raccourcis
  desktop prévisibles, et des fenêtres restaurables sur Windows, macOS et
  Linux.
- **FR-009**: Le client MUST limiter les privilèges de la fenêtre de rendu,
  bloquer l’exécution de code fourni par un serveur distant et valider toute
  demande d’accès système, d’URL externe ou de communication native.
- **FR-010**: Le client MUST produire des diagnostics locaux expurgés, sans
  contenu utilisateur, secret, clé, jeton ou donnée d’authentification, et
  permettre au propriétaire d’identifier les erreurs de connexion, stockage,
  chiffrement et mise à jour.
- **FR-011**: Le client MUST vérifier les mises à jour contre un canal de
  publication autorisé, leur version, leur intégrité et leur compatibilité,
  puis laisser le propriétaire reporter ou lancer le redémarrage.
- **FR-012**: Une mise à jour MUST préserver le coffre local, les identités,
  l’historique, les conflits et les mutations en attente ; une migration locale
  interrompue doit être reprenable ou réversible sans écrasement silencieux.
- **FR-013**: Les releases MUST attacher à la GitHub Release, et MUST NOT
  publier sur un store : un installateur Windows x64, un installateur
  Windows ARM64, un DMG macOS Apple Silicon, et pour chaque architecture
  Linux (x64 et ARM64) un AppImage, un `.deb` et un `.rpm`. Chaque fichier
  porte une empreinte et une version vérifiables, plus une signature ou un
  équivalent de confiance adapté à la plateforme. Omettre un de ces fichiers
  ou ajouter un artefact hors matrice rend la release incomplète.
- **FR-014**: Les cinq cibles MUST être : Windows 10/11 x64, Windows 10/11
  ARM64, macOS 13 ou ultérieur Apple Silicon, Linux de bureau glibc x64, et
  Linux de bureau glibc ARM64. Pour Linux, les trois formats AppImage, deb
  et rpm sont tous requis par architecture. Un installateur macOS Intel, un
  binaire universel, un paquet multi-OS, iOS, Android et toute boutique
  d’applications sont hors périmètre.
- **FR-015**: Les vérifications automatisées MUST couvrir au minimum
  l’installation, le premier démarrage, la connexion, le refus d’un canal
  dangereux, le stockage local chiffré, le hors-ligne après redémarrage, la
  révocation, la mise à jour et l’échec de mise à jour sur les trois systèmes
  cibles, pour chaque architecture publiée de ce système.
- **FR-016**: Chaque installateur publié MUST n’embarquer que le runtime, les
  modules natifs et les ressources nécessaires à son système et à son
  architecture. Il MUST NOT inclure le runtime d’un autre OS, une tranche
  d’architecture inutilisée, ni des installateurs destinés à une autre
  cible. Dans la limite de ce qu’un hôte desktop packagé permet, le fichier
  MUST rester le plus léger possible pour cette cible.

### Key Entities

- **Profil serveur desktop** : URL, libellé, état de compatibilité, dernier
  contact, identifiant d’appareil associé et préférences de connexion.
- **Coffre local desktop** : projection chiffrée, outbox, conflits, index et
  métadonnées nécessaires au fonctionnement hors ligne d’un appareil.
- **Capacité native** : opération explicitement exposée au rendu, comme le
  choix d’un fichier, l’ouverture d’un lien ou la gestion de fenêtre, avec
  validation de l’origine et des paramètres.
- **Artefact de release** : un fichier installable pour un seul système, une
  seule architecture, et un format autorisé (Windows : installateur ; macOS :
  DMG ; Linux : AppImage, deb ou rpm). Ce n’est ni un store, ni un bundle
  universel.
- **État de migration desktop** : version du coffre local, état avant/après,
  progression, reprise et résultat d’une migration ou d’un retour arrière.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Sur chaque plateforme cible, au moins 19 installations propres
  sur 20 atteignent la connexion à un serveur de test et l’ouverture d’un
  contenu existant en moins de 5 minutes, sans intervention technique non
  documentée.
- **SC-002**: Les parcours métier déjà validés pour le client Web — lecture,
  édition, navigation, sauvegarde, synchronisation, fichiers, recherche et
  fonctions livrées avant cette feature — passent dans le client desktop sans
  divergence fonctionnelle bloquante.
- **SC-003**: Dans 100 % des scénarios de test hors ligne, les contenus chargés,
  mutations, conflits et états de synchronisation restent récupérables après
  fermeture inattendue puis redémarrage.
- **SC-004**: Les tests de stockage trouvent zéro titre, corps, jeton ou clé
  utilisable en clair dans les données persistées du coffre local ; 100 % des
  tentatives de lecture ou d’écriture sans clé valide échouent explicitement.
- **SC-005**: 100 % des scénarios de révocation et de déconnexion empêchent une
  nouvelle synchronisation protégée, tout en conservant les données locales
  non synchronisées pour récupération ou export prévu.
- **SC-006**: 100 % des mises à jour acceptées conservent les identités et
  mutations locales d’un scénario de référence ; 100 % des téléchargements ou
  démarrages invalides testés reviennent à un état fonctionnel sans perte du
  coffre.
- **SC-007**: Chaque release candidate fournit les fichiers vérifiables de la
  matrice : Windows x64, Windows ARM64, macOS Apple Silicon, et pour Linux
  x64 comme ARM64 un AppImage, un deb et un rpm. Ils sont attachés à la
  GitHub Release. Aucun fichier hors matrice, aucun store, aucun paquet
  universel, et aucun secret de signature n’est publié.
- **SC-008**: Les parcours desktop principaux sont réalisables au clavier et
  aucune violation d’accessibilité critique ou grave n’est détectée sur les
  écrans d’onboarding, workspace, connexion, sécurité et mise à jour.
- **SC-009**: Les tests de sécurité confirment que le rendu ne dispose d’aucun
  accès direct au système de fichiers ou au shell, que les URLs non autorisées
  sont bloquées et que les diagnostics générés par 100 % des scénarios ne
  contiennent aucune donnée sensible.

## Assumptions

- Les fondations V1 du client Web (001 à 010, 016 à 020, 022) et la chaîne Bun
  019 livrent leurs contrats stables avant ou en parallèle de 014. Les
  features 011 à 013 ne sont pas des prérequis. Si une dépendance V1 encore
  ouverte touche le hôte (par exemple une nouvelle route), elle doit être
  isolée comme tâche plutôt que contournée.
- Le client desktop embarque l’interface locale et communique avec le serveur
  auto-hébergé ; il ne remplace pas le serveur et ne fournit pas de mode
  autonome séparé.
- La matrice V1 est fermée : Windows x64, Windows ARM64, macOS Apple Silicon,
  Linux glibc x64, Linux glibc ARM64. Linux publie AppImage, deb et rpm par
  architecture, en fichiers GitHub, sans dépôt de distribution. macOS Intel
  et les stores (Mac App Store, Microsoft Store, Snap, Flathub) sont hors
  périmètre. Linux cible un bureau glibc courant (classe Ubuntu LTS /
  Debian stable).
- Les certificats, identifiants Apple, secrets de signature Windows et
  secrets de publication sont fournis uniquement par l’environnement de
  release et ne sont jamais committés.
- Les mises à jour sont les installateurs de la même GitHub Release, pour le
  même système et la même architecture que l’installation déjà en place.
- Le mécanisme de stockage chiffré du cœur client reste la source de vérité ;
  la couche native fournit la protection de clé et les capacités plateforme
  nécessaires, sans déplacer le modèle de contenu dans le processus principal.

## Out of Scope

- Nouvelles fonctions métier de pages, éditeur, bases de données, fichiers,
  recherche, graphe, tableaux blancs, partage ou MCP.
- Serveur local embarqué, base de données indépendante, synchronisation
  propriétaire ou seconde identité de propriétaire.
- Application iOS native, application Android, installateur macOS Intel.
- Publication sur Mac App Store, Microsoft Store, Snap, Flatpak/Flathub ou
  tout autre store.
- Artefact universel, paquet multi-OS, ou archive qui embarque plusieurs
  runtimes desktop.
- Télémétrie distante, publicité, collecte de contenu ou analytics non
  consentis.
- Système de plugins desktop arbitraires ou exécution de scripts provenant du
  serveur.

## Convergence de compatibilité — 2026-09-05

L'implémentation reprise épingle Electron 44.1.1. Le minimum macOS est aligné
sur macOS 13, car Electron 44 retire macOS 12. Décision technique provisoire
conservant le runtime choisi dans le travail repris ; la compatibilité macOS 12
nécessiterait une autre branche de runtime et de nouvelles validations.
Source : [changements Electron 44](https://www.electronjs.org/blog/electron-44-0).
