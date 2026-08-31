# Feature Specification: Journaux serveur lisibles et actionnables

**Feature Branch**: `codex/021-readable-server-logs`

**Created**: 2026-08-31

**Status**: Draft — ready for product review

**Input**: User description: "Modifier les logs du serveur, aujourd'hui
illisibles, expliquer leur état actuel et poser les bases d'une amélioration
avant la convergence finale de la V1."

## Product Direction, Dependencies, and Scope

Cette feature affine la section 35 du
[canevas produit](../../docs/product/product-canvas.md), ainsi que les critères
d'exploitation et de sortie V1 des sections 43 à 47. Elle transforme une
promesse déjà présente — des journaux structurés, expurgés et lisibles par un
opérateur — en comportements vérifiables dans les conditions réelles
d'utilisation de la stack locale et auto-hébergée.

La feature 002 reste propriétaire de la fondation de sécurité, de
l'expurgation, de l'audit, des sorties standard des conteneurs et du contrat
Compose. Les features 006, 007, 008, 009, 010, 017 et 018 restent propriétaires
des opérations métier qu'elles exposent. La présente feature ne redéfinit ni
ces opérations ni leurs données : elle établit un vocabulaire d'événements,
une présentation humaine, une présentation machine et une politique de bruit
communes à tous les processus serveur maintenus.

La feature 008 conserve la responsabilité de la validation de release. La
présente feature devient une condition de sortie de la V1 : la release ne peut
pas être déclarée exploitable tant que la commande locale documentée affiche
par défaut un flot illisible ou que les erreurs ne donnent pas une piste
d'action sûre.

### Problème observé

Le comportement existant privilégie correctement la collecte automatique :
une sortie non interactive reçoit des événements structurés sans codes de
terminal. Or les conteneurs sont justement non interactifs. La commande de
suivi des journaux utilisée pendant le développement expose donc directement
la représentation destinée aux machines, avec de nombreux champs techniques
sur une ligne et des préfixes ajoutés par l'orchestrateur.

Le choix de présentation humaine est en outre lié au choix des couleurs. Il
n'existe pas de demande indépendante pour obtenir une présentation humaine
monochrome sur une sortie non interactive. Les événements automatiques de
début et de fin de chaque requête rendent enfin les opérations routinières,
notamment les contrôles de santé, plus visibles que les événements qui
expliquent réellement un échec.

Ces choix sont cohérents avec la collecte machine et la protection des données,
mais ils ne satisfont pas l'usage humain quotidien. La solution doit préserver
la structure et l'expurgation existantes, et améliorer la couche de
présentation, la qualité sémantique des événements et la maîtrise du bruit.

### Scope Boundaries

#### Included

- Présentation humaine compacte et présentation machine structurée d'un même
  événement serveur.
- Sélection du format, de la couleur et du niveau de verbosité comme décisions
  indépendantes.
- Vue locale lisible par défaut pour le suivi des conteneurs, sans retirer la
  sortie structurée requise par les collecteurs.
- Champs communs, identifiants de corrélation et codes diagnostiques sûrs.
- Réduction ou déclassement du bruit des requêtes et contrôles routiniers.
- Résumés d'erreur actionnables sans contenu privé, secret, requête utilisateur
  ni trace brute.
- Filtrage documenté par niveau, composant, opération et corrélation.
- Compatibilité de migration, documentation opérateur et tests de non-fuite.

#### Excluded

- Service externe de centralisation, tableau de bord hébergé ou dépendance à
  une plateforme d'observabilité.
- Conservation et rotation de fichiers de journaux dans les conteneurs.
- Modification du journal d'audit de sécurité ou mélange entre audit et
  diagnostic opérationnel.
- Journalisation du contenu des pages, noms, recherches, fichiers, messages
  d'erreur bruts, secrets ou données chiffrées.
- Traçage distribué vers un service tiers, profilage permanent ou télémétrie
  sortante.
- Surface de diagnostic détaillée dans l'espace de travail principal.
- Correction des erreurs métier révélées par les journaux ; chaque défaut
  fonctionnel reste traité dans la feature qui en est propriétaire.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Comprendre rapidement une panne locale (Priority: P1)

En tant que propriétaire ou développeur qui exploite l'installation, je peux
suivre le serveur avec la commande locale documentée et distinguer
immédiatement ce qui s'est passé, où, avec quel résultat et quelle action sûre
essayer ensuite.

**Why this priority**: Un journal structuré mais illisible ne permet pas de
diagnostiquer une installation. La première valeur de cette feature est de
rendre les pannes compréhensibles sans outil externe.

**Independent Test**: Démarrer la stack locale avec ses réglages par défaut,
provoquer une requête réussie puis trois échecs sûrs connus, et demander à une
personne qui ne connaît pas l'implémentation d'identifier le composant,
l'opération, le résultat et l'identifiant à communiquer pour chaque échec.

**Acceptance Scenarios**:

1. **Given** une stack locale démarrée avec sa configuration documentée,
   **When** l'opérateur suit les journaux avec la commande standard, **Then**
   chaque ligne utile est lisible sans décodeur externe et les erreurs se
   distinguent des événements normaux sans dépendre uniquement de la couleur.
2. **Given** une opération serveur qui échoue, **When** son événement principal
   est affiché, **Then** l'opérateur voit au minimum l'instant, le niveau, le
   composant, l'opération, un code diagnostique sûr, le résultat, la possibilité
   de réessayer, une piste d'action et un identifiant de corrélation.
3. **Given** une erreur qui contient une valeur privée dans son message ou sa
   cause interne, **When** elle est journalisée dans n'importe quelle
   présentation, **Then** la valeur privée et la trace brute restent absentes
   tout en conservant une catégorie et une piste d'action exploitables.
4. **Given** une sortie sans prise en charge des couleurs, **When** la
   présentation humaine monochrome est demandée, **Then** le texte reste aussi
   compréhensible et aucun code de contrôle n'est émis.

---

### User Story 2 - Conserver une sortie fiable pour les collecteurs (Priority: P1)

En tant qu'administrateur de l'hébergement, je peux envoyer les mêmes
événements à un collecteur sous une forme structurée stable, sans décoration
de terminal ni divergence avec ce qu'une personne voit.

**Why this priority**: La lisibilité humaine ne doit pas dégrader la capacité
de filtrer, rechercher, conserver ou traiter automatiquement les événements.

**Independent Test**: Émettre un corpus fixe d'événements en présentation
humaine et machine, comparer leurs champs sémantiques, parser toutes les lignes
machine et vérifier l'absence de codes de contrôle et de données privées.

**Acceptance Scenarios**:

1. **Given** une destination configurée pour la collecte, **When** le serveur
   émet des événements, **Then** chaque ligne est directement analysable par
   une machine et ne contient aucun code de terminal.
2. **Given** le même événement rendu dans les deux présentations, **When** les
   résultats sont comparés, **Then** niveau, instant, composant, opération,
   résultat, code, durée et corrélation ont la même signification.
3. **Given** une configuration qui force le format machine et désactive les
   couleurs, **When** la sortie est redirigée ou collectée, **Then** le résultat
   ne dépend pas de la présence d'un terminal.
4. **Given** une valeur de configuration inconnue, **When** le processus
   démarre, **Then** il refuse la configuration avec une explication sûre au
   lieu de choisir silencieusement un comportement différent.

---

### User Story 3 - Voir le signal plutôt que le bruit (Priority: P2)

En tant qu'opérateur, je peux laisser la stack active pendant un parcours
normal sans que les contrôles de santé et les détails répétitifs masquent les
changements d'état, les ralentissements et les erreurs.

**Why this priority**: Une belle présentation reste inutilisable si deux lignes
automatiques par requête et des sondes permanentes noient les événements
importants.

**Independent Test**: Exécuter un parcours V1 représentatif avec contrôles de
santé, synchronisation, recherche, sauvegarde et un échec volontaire ; mesurer
les événements au niveau d'exploitation standard et vérifier que l'échec et
les changements d'état restent immédiatement repérables.

**Acceptance Scenarios**:

1. **Given** un contrôle de vie ou de disponibilité réussi et répétitif,
   **When** le niveau d'exploitation standard est utilisé, **Then** il ne
   produit pas de ligne informative individuelle.
2. **Given** une requête ordinaire réussie, **When** elle se termine, **Then**
   elle produit au plus un résumé informatif et aucun événement informatif de
   début distinct.
3. **Given** une opération lente, refusée ou échouée, **When** elle se termine,
   **Then** son événement est conservé au niveau approprié même si les
   événements routiniers similaires sont réduits.
4. **Given** plusieurs événements liés à une requête, une tâche de fond ou une
   session temps réel, **When** l'opérateur filtre leur identifiant de
   corrélation, **Then** il obtient une chronologie cohérente de l'opération.

---

### User Story 4 - Ajuster la vue sans modifier le serveur (Priority: P3)

En tant que développeur ou administrateur, je peux filtrer une sortie existante
par niveau, composant, opération, code ou corrélation, sans changer les
événements produits ni installer un service externe.

**Why this priority**: La vue par défaut doit suffire au quotidien, mais une
investigation plus longue exige de réduire rapidement le corpus à une seule
opération.

**Independent Test**: À partir d'un corpus mêlant plusieurs composants et
requêtes, isoler successivement une erreur, toutes les étapes de sa corrélation
et les événements d'un composant avec les actions documentées.

**Acceptance Scenarios**:

1. **Given** des événements de plusieurs niveaux et composants, **When** un
   filtre documenté est appliqué, **Then** seules les lignes correspondantes
   sont affichées sans modifier leur contenu.
2. **Given** un identifiant montré dans une erreur de l'application ou du
   serveur, **When** l'opérateur le recherche, **Then** toutes les étapes
   disponibles de cette opération sont retrouvées.
3. **Given** une ancienne configuration encore acceptée pendant la migration,
   **When** elle est utilisée, **Then** son résultat est déterministe et sa
   correspondance avec les nouveaux réglages est documentée.

### Edge Cases

- La sortie est redirigée vers un fichier, un tube ou un collecteur alors que
  l'opérateur a explicitement demandé une présentation humaine.
- Un terminal prétend gérer les couleurs mais ne les affiche pas correctement.
- Plusieurs processus écrivent simultanément et l'orchestrateur ajoute son
  propre préfixe de service et d'horodatage.
- Un événement n'a pas de requête HTTP, par exemple une migration, une tâche de
  sauvegarde, un démarrage ou une fermeture de session temps réel.
- Une erreur survient avant la création d'un contexte de corrélation.
- Un code diagnostique est inconnu d'une version plus ancienne de l'outil de
  lecture.
- Une opération comporte des milliers d'étapes, se répète rapidement ou dure
  au-delà de la fenêtre de suivi courante.
- L'écriture de la sortie ralentit, échoue ou est interrompue ; le serveur ne
  doit pas transformer un problème de journalisation en perte de données.
- Une donnée privée est placée dans un champ inattendu, un tableau, une cause
  imbriquée ou le texte libre d'une erreur tierce.
- L'horloge change, les services utilisent des fuseaux différents ou deux
  événements partagent le même instant affiché.

## Requirements *(mandatory)*

### Functional Requirements

**Présentations et configuration**

- **FR-001**: Tous les processus serveur maintenus MUST produire un événement
  sémantique commun pouvant être rendu en présentation humaine ou machine sans
  modifier sa signification.
- **FR-002**: Le format de sortie, l'usage des couleurs et le niveau minimal de
  verbosité MUST être configurables indépendamment.
- **FR-003**: Le suivi local standard de la stack de développement MUST
  présenter par défaut une vue humaine compacte, y compris lorsque les
  conteneurs eux-mêmes écrivent vers une sortie non interactive.
- **FR-004**: La stack officielle et chaque processus serveur MUST conserver une
  présentation machine structurée, directement collectable sur les sorties
  standard des conteneurs, comme réglage explicite et documenté.
- **FR-005**: La sélection automatique MUST être documentée ; un choix explicite
  de format ou de couleur MUST prendre le pas sur la détection de terminal.
- **FR-006**: La présentation monochrome et la présentation machine MUST
  contenir zéro code de contrôle de terminal. La couleur MUST rester un signal
  secondaire doublé par un libellé textuel.
- **FR-007**: Une configuration invalide MUST arrêter le processus avant qu'il
  n'accepte du trafic et MUST identifier le réglage invalide sans exposer de
  secret.
- **FR-008**: La migration depuis les réglages existants MUST avoir une
  correspondance déterministe, une période de compatibilité explicitement
  bornée et une procédure de retour au comportement antérieur.

**Événement commun et lisibilité**

- **FR-009**: Chaque événement MUST porter un instant non ambigu, un niveau
  textuel, un composant émetteur, un nom d'événement stable et un message humain
  bref ; il MUST porter opération, résultat, durée, code diagnostique et
  corrélation lorsqu'ils s'appliquent.
- **FR-010**: La présentation humaine MUST placer niveau, composant, opération
  ou événement, résultat et durée avant les détails secondaires, sur une seule
  ligne pour un événement ordinaire.
- **FR-011**: Les champs permanents ou ajoutés par l'environnement
  d'hébergement MUST NOT être répétés dans la partie humaine lorsqu'ils
  n'apportent aucune information discriminante, sans être supprimés de
  l'événement machine.
- **FR-012**: Les noms d'événements, codes diagnostiques, niveaux et résultats
  MUST former un vocabulaire stable et documenté ; un changement incompatible
  MUST être versionné ou accompagné d'une migration.
- **FR-013**: Une erreur ou un refus actionnable MUST identifier une catégorie
  sûre, l'étape concernée, son caractère réessayable, une piste d'action
  bornée et un identifiant de corrélation copiable.
- **FR-014**: Une piste d'action MUST décrire une action sûre telle que
  réessayer, vérifier la disponibilité d'une dépendance, contrôler une
  configuration nommée ou consulter une procédure ; elle MUST NOT afficher de
  commande destructive prête à exécuter ni inventer une cause non établie.
- **FR-015**: Une erreur sans corrélation disponible MUST recevoir un identifiant
  d'incident local avant son émission afin de pouvoir être retrouvée sans
  fabriquer une fausse relation avec une autre opération.

**Bruit et corrélation**

- **FR-016**: Au niveau d'exploitation standard, une requête réussie ordinaire
  MUST produire au plus un résumé informatif ; son début et ses étapes internes
  MUST rester disponibles uniquement à un niveau plus détaillé.
- **FR-017**: Les contrôles de vie et de disponibilité réussis et répétitifs
  MUST être absents du niveau informatif standard. Un changement d'état, un
  ralentissement au-delà du seuil documenté ou un échec MUST rester visible.
- **FR-018**: Les opérations longues ou répétitives, notamment synchronisation,
  indexation, sauvegarde, migration et restauration, MUST privilégier des
  événements de début, changement d'état, résumé et échec plutôt qu'une ligne
  informative par élément traité.
- **FR-019**: Un identifiant de corrélation stable MUST relier, lorsqu'ils
  existent, la requête, les tâches de fond déclenchées, la session temps réel,
  les événements opérationnels et la réponse d'erreur sûre.
- **FR-020**: La réduction, l'échantillonnage ou le déclassement du bruit MUST
  NOT masquer un échec, un avertissement, un changement d'état, une violation
  de sécurité ou une opération administrative sensible.

**Confidentialité, fiabilité et exploitation**

- **FR-021**: Toutes les présentations et tous les niveaux MUST appliquer la
  même politique d'expurgation avant écriture ; aucun mode de débogage ne peut
  autoriser implicitement le contenu privé ou les secrets.
- **FR-022**: Les corps de requête, paramètres de recherche, noms et contenus,
  en-têtes d'authentification, cookies, sessions, clés, données chiffrées,
  messages et traces d'erreur bruts MUST NOT apparaître dans les journaux.
- **FR-023**: Les diagnostics d'erreur MUST être construits à partir de champs
  sûrs autorisés, notamment catégories, codes, compteurs, états et classes de
  dépendance, plutôt que par copie d'un message libre provenant d'une donnée ou
  d'un composant tiers.
- **FR-024**: L'échec ou le ralentissement de la destination de journaux MUST
  NOT provoquer de perte ou de corruption des données utilisateur ; les
  conséquences d'une saturation MUST être bornées et documentées dans le plan.
- **FR-025**: Les événements machine MUST rester une ligne structurée par
  événement, ordonnables, analysables indépendamment et compatibles avec les
  collecteurs de conteneurs.
- **FR-026**: Une action locale documentée MUST permettre de suivre et filtrer
  les événements par niveau, composant, opération, code diagnostique ou
  corrélation sans service externe obligatoire.
- **FR-027**: La documentation MUST expliquer le format humain, le format
  machine, les réglages, les niveaux, la politique de bruit, les champs sûrs,
  les filtres, la corrélation, la migration et trois procédures de diagnostic
  représentatives.
- **FR-028**: Les tests MUST couvrir la parité sémantique des présentations, les
  sorties avec et sans terminal, la couleur forcée ou désactivée, les
  configurations invalides, le bruit routinier, la corrélation et des charges
  privées injectées dans chaque forme d'erreur supportée.
- **FR-029**: Le journal d'audit MUST rester une preuve distincte avec sa propre
  politique de durabilité ; l'amélioration des journaux opérationnels MUST NOT
  modifier, réduire ou dupliquer les événements d'audit obligatoires.
- **FR-030**: La validation V1 MUST exercer la commande de suivi locale dans une
  vraie stack, la sortie machine d'un conteneur et au moins un parcours avec
  requête, temps réel, tâche de fond, échec sûr et contrôle de santé.

### Key Entities

- **Événement opérationnel**: fait serveur ponctuel possédant une identité
  sémantique stable, un instant, un niveau, un composant, un résultat et les
  champs sûrs nécessaires à son diagnostic.
- **Présentation**: transformation sans perte sémantique d'un événement vers
  une vue humaine compacte ou une vue machine structurée.
- **Contexte de corrélation**: identité qui relie les étapes appartenant à une
  même opération sans contenir d'identité privée ni servir de secret.
- **Code diagnostique sûr**: code stable qui classe un état ou un échec sans
  recopier le message brut de sa cause.
- **Piste d'action**: recommandation courte, sûre et bornée associée à un code
  diagnostique établi.
- **Politique de bruit**: règles qui déterminent le niveau et la fréquence des
  événements routiniers tout en préservant échecs, alertes et changements
  d'état.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Lors d'un essai avec cinq échecs représentatifs, au moins 90 % des
  participants identifient en moins de 30 secondes le composant, l'opération,
  le résultat et l'identifiant à communiquer depuis la vue locale par défaut.
- **SC-002**: 100 % des erreurs et refus du corpus d'acceptation possèdent un
  niveau, un composant, une opération ou un événement, un code diagnostique
  sûr, un résultat, un caractère réessayable, une piste d'action et une
  corrélation ou un incident local.
- **SC-003**: 100 % des lignes machine du corpus sont analysables
  indépendamment et zéro ligne machine ou monochrome contient un code de
  contrôle de terminal.
- **SC-004**: Pour 100 % des événements comparés, les présentations humaine et
  machine conservent les mêmes niveau, composant, événement, résultat, code,
  durée et corrélation applicables.
- **SC-005**: Un parcours V1 normal produit au plus une ligne informative par
  requête réussie et zéro ligne informative par contrôle de santé réussi, tout
  en conservant 100 % des échecs, avertissements et changements d'état du
  scénario.
- **SC-006**: Le corpus de sécurité injecte des sentinelles privées dans corps,
  en-têtes, requêtes, noms, contenus, erreurs imbriquées et causes tierces ; zéro
  sentinelle apparaît dans une sortie, quel que soit le format ou le niveau.
- **SC-007**: À partir de la documentation seule, une personne peut isoler en
  moins de deux minutes les événements d'un composant, d'un code et d'une
  corrélation, sans service externe.
- **SC-008**: 100 % des réglages anciens couverts par la période de
  compatibilité produisent le comportement documenté, et 100 % des valeurs
  invalides refusent le démarrage avant acceptation de trafic.
- **SC-009**: La vraie stack de validation expose une vue humaine lisible par la
  commande locale standard et une sortie machine collectable, sans changement
  manuel du code ni divergence d'événements.

## Assumptions

- L'opérateur principal est le propriétaire auto-hébergeur ou un développeur
  local ; il ne dispose pas nécessairement d'un outil de collecte spécialisé.
- La sortie structurée actuelle et la protection stricte des données sont des
  acquis à préserver, pas des causes à supprimer.
- La vue humaine locale peut être produite au moment de l'émission ou de la
  lecture ; le plan choisira l'approche la plus simple qui maintient une source
  sémantique unique.
- Les seuils précis de durée par type d'opération seront définis dans le plan à
  partir de mesures reproductibles, sans figer de technologie dans cette spec.
- Les processus tiers non maintenus par le projet conservent leur propre
  format ; la vue locale peut les identifier et les séparer, mais ne garantit
  pas de réécrire leurs événements.
- La rétention et la rotation restent la responsabilité de l'hôte ou du
  collecteur ; cette feature porte la lisibilité et la qualité des événements.
- La conception détaillée commence après stabilisation du correctif en cours
  sur `main`, puis suit clarification, plan, tâches, analyse et implémentation.
