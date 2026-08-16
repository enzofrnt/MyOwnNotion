# Feature Specification: Applications Desktop Electron Windows et macOS

**Feature Branch**: `014-desktop-clients`

**Created**: 2026-08-16

**Status**: Ready for planning

**Input**: User description: "Planifier la création des applications Electron Windows et macOS à la suite de la trajectoire prévue, en réutilisant les fondations et le workflow Spec Kit du dépôt."

## Product Direction, Dependencies, and Scope

Cette feature concrétise la section 7 du
[`docs/product/product-canvas.md`](../../docs/product/product-canvas.md) et la
feature 014 de la roadmap. Elle transforme le client Web existant en
applications de bureau distribuables pour Windows et macOS, sans créer une
seconde source de vérité métier.

Elle dépend des fondations et capacités livrées par les features 001 à 013 :
modèle canonique, sécurité du propriétaire, expérience workspace, conversion
des items, fichiers, synchronisation, sauvegarde/récupération, recherche,
bases structurées, graphe, tableaux blancs, partage public et MCP. Les
features métier restent propriétaires de leurs contrats et parcours ; cette
feature fournit leur hôte desktop commun.

Le produit reste strictement mono-utilisateur : une installation possède un
seul propriétaire, un seul workspace canonique et plusieurs appareils
autorisés. L’application desktop ne contient pas de serveur embarqué, ne crée
pas de compte supplémentaire et ne contourne ni l’authentification, ni la
révocation, ni la compatibilité de protocole.

## User Scenarios & Testing

### User Story 1 — Installer et connecter le client desktop (Priority: P1)

En tant que propriétaire, je peux installer l’application Windows ou macOS,
indiquer l’URL de mon serveur auto-hébergé et m’authentifier comme nouvel
appareil, afin d’utiliser mon workspace dans une fenêtre dédiée.

**Why this priority**: C’est le parcours minimal qui donne une valeur autonome
au client desktop et permet de vérifier qu’il respecte le serveur existant.

**Independent Test**: Installer un artefact de test sur une machine propre,
saisir une URL locale puis une URL distante HTTPS, terminer l’autorisation de
l’appareil et ouvrir une page déjà présente. Vérifier aussi les messages pour
une URL inaccessible, une URL HTTP non locale et un protocole incompatible.

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
Windows ou macOS pour gérer la fenêtre, les raccourcis, les fichiers et les
liens, sans que l’application donne à son contenu distant des privilèges
locaux arbitraires.

**Why this priority**: Une fenêtre installée doit se comporter comme une
application fiable, tout en conservant la frontière de sécurité du client Web.

**Independent Test**: Ouvrir, redimensionner, minimiser, restaurer et fermer
la fenêtre ; utiliser les raccourcis principaux, sélectionner un fichier à
importer, ouvrir un lien externe et relancer l’application. Vérifier les mêmes
parcours sur Windows et macOS avec clavier seul.

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

En tant que propriétaire, je peux télécharger un installateur Windows ou
macOS identifiable, vérifiable et adapté à ma plateforme, puis constater que
le système ne le traite pas comme un logiciel non identifié.

**Why this priority**: La distribution est nécessaire pour rendre les clients
utilisables, mais elle vient après les parcours fonctionnels et la sécurité
locale.

**Independent Test**: Produire les artefacts de publication depuis un tag,
vérifier leurs signatures et métadonnées, les installer sur les plateformes
cibles et exécuter un smoke test de connexion, de lecture hors ligne et de
mise à jour.

**Acceptance Scenarios**:

1. **Given** une version publiée, **When** le propriétaire télécharge
   l’artefact correspondant à son système, **Then** l’installateur s’installe
   sans étape de contournement de sécurité normalement évitable.
2. **Given** un artefact altéré, incomplet ou provenant d’un canal non autorisé,
   **When** le propriétaire tente de l’installer ou de le mettre à jour,
   **Then** l’opération est refusée ou clairement signalée comme non fiable.
3. **Given** une publication Windows ou macOS, **When** le pipeline de release
   s’exécute, **Then** il produit les artefacts, empreintes, provenance et
   informations de version attendus sans exposer les secrets de signature.

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
  desktop prévisibles, et des fenêtres restaurables sur Windows et macOS.
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
- **FR-013**: Les releases MUST produire des artefacts installables et
  identifiables pour Windows et macOS, avec signatures adaptées à chaque
  plateforme, empreintes, provenance et informations de version vérifiables.
- **FR-014**: Le support initial MUST couvrir Windows 10/11 x64 et macOS 12 ou
  ultérieur sur Intel et Apple Silicon via des artefacts clairement
  différenciés ; toute autre plateforme est hors périmètre de cette feature.
- **FR-015**: Les vérifications automatisées MUST couvrir au minimum
  l’installation, le premier démarrage, la connexion, le refus d’un canal
  dangereux, le stockage local chiffré, le hors-ligne après redémarrage, la
  révocation, la mise à jour et l’échec de mise à jour sur les deux systèmes
  cibles.

### Key Entities

- **Profil serveur desktop** : URL, libellé, état de compatibilité, dernier
  contact, identifiant d’appareil associé et préférences de connexion.
- **Coffre local desktop** : projection chiffrée, outbox, conflits, index et
  métadonnées nécessaires au fonctionnement hors ligne d’un appareil.
- **Capacité native** : opération explicitement exposée au rendu, comme le
  choix d’un fichier, l’ouverture d’un lien ou la gestion de fenêtre, avec
  validation de l’origine et des paramètres.
- **Artefact de release** : installateur ou paquet, plateforme, architecture,
  version, empreinte, signature, provenance et canal de mise à jour.
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
- **SC-007**: Chaque release candidate fournit un artefact vérifiable pour
  Windows x64, macOS Intel et macOS Apple Silicon ; aucun artefact non signé,
  non traçable ou contenant un secret de signature n’est publié.
- **SC-008**: Les parcours desktop principaux sont réalisables au clavier et
  aucune violation d’accessibilité critique ou grave n’est détectée sur les
  écrans d’onboarding, workspace, connexion, sécurité et mise à jour.
- **SC-009**: Les tests de sécurité confirment que le rendu ne dispose d’aucun
  accès direct au système de fichiers ou au shell, que les URLs non autorisées
  sont bloquées et que les diagnostics générés par 100 % des scénarios ne
  contiennent aucune donnée sensible.

## Assumptions

- Les features 001 à 013 livrent leurs contrats stables et leurs parcours
  nécessaires avant l’implémentation de 014 ; si une dépendance reste ouverte,
  elle doit être isolée comme tâche bloquante plutôt que contournée.
- Le client desktop embarque l’interface locale et communique avec le serveur
  auto-hébergé ; il ne remplace pas le serveur et ne fournit pas de mode
  autonome séparé.
- Le support Windows initial cible x64. Le support Windows ARM64, Linux et le
  Mac App Store sont hors périmètre initial mais ne doivent pas être rendus
  impossibles par les choix de packaging.
- Les certificats, identifiants Apple, secrets de signature et secrets de
  publication sont fournis uniquement par l’environnement de release et ne
  sont jamais committés.
- Les mises à jour sont distribuées depuis les artefacts de release officiels
  du projet ; les stores et les canaux tiers ne sont pas nécessaires pour le
  premier parcours.
- Le mécanisme de stockage chiffré du cœur client reste la source de vérité ;
  la couche native fournit la protection de clé et les capacités plateforme
  nécessaires, sans déplacer le modèle de contenu dans le processus principal.

## Out of Scope

- Nouvelles fonctions métier de pages, éditeur, bases de données, fichiers,
  recherche, graphe, tableaux blancs, partage ou MCP.
- Serveur local embarqué, base de données indépendante, synchronisation
  propriétaire ou seconde identité de propriétaire.
- Application iOS native, application Android, client Linux ou version Mac App
  Store.
- Télémétrie distante, publicité, collecte de contenu ou analytics non
  consentis.
- Système de plugins desktop arbitraires ou exécution de scripts provenant du
  serveur.
