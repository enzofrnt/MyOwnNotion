# Feature Specification: Synchronisation éditoriale temps réel, durable et auto-réparable

**Feature Branch**: `codex/018-durable-realtime-sync`

**Created**: 2026-08-25

**Status**: Ready for review; full local gate passed, pull request pending

**Input**: User description: "Faire de la synchronisation multi-appareils la
fondation prioritaire de l'application. Un même propriétaire doit pouvoir
écrire sur plusieurs appareils ou onglets, connecté ou hors ligne, retrouver
rapidement les changements distants et converger au retour du réseau sans
remplacement complet, perte silencieuse ni faux conflit. Les anciens états
locaux doivent s'auto-réparer et le statut affiché doit rester honnête. Une
refonte pré-V1 est autorisée si elle permet une solution réellement robuste."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 2, 4 à 6, 9, 10, 17 à 20, 28, 30 à 32
et 42 à 47 du
[canevas produit](../../docs/product/product-canvas.md). Elle transforme la
promesse local-first et multi-appareils en garanties mesurables : durabilité
locale, transport incrémental, convergence causale, rattrapage après une longue
absence, état compréhensible et restauration vérifiable.

Elle devient la source de vérité active pour le transport du contenu
éditorial, les sessions de synchronisation, la reprise après incident, la
migration des anciens conflits de page et le statut global de synchronisation.
Elle affine et remplace donc ces parties de la feature 017 sans rouvrir son
périmètre d'éditeur, de shell ou de design. La représentation opérationnelle
convergente et la projection canonique indépendante de l'éditeur livrées par la
017 restent des prérequis à préserver tant que les preuves de convergence de
cette feature restent satisfaites.

Les garanties historiques restent applicables : données locales chiffrées
(001), authentification et appareils autorisés (002), fichiers (005), journal
et rattrapage du workspace (006), sauvegarde et restauration (007). Lorsque
leur ancien chemin de remplacement complet contredit cette feature pour le
corps d'une page, le nouveau chemin incrémental prévaut et l'ancien contenu doit
être migré ou conservé comme branche récupérable.

Le produit reste mono-utilisateur : une installation possède un seul
propriétaire, mais ce propriétaire peut utiliser plusieurs appareils et
plusieurs onglets. La collaboration entre personnes, les curseurs de présence
et les permissions entre membres restent hors périmètre.

Cette feature ne prétend pas terminer l'interface proche de Notion. Elle ne
modifie l'interface que pour rendre les états de synchronisation fiables,
compacts et actionnables. La finition de l'arborescence, l'insertion simple
d'une page dans un dossier et la commande `/page` restent la prochaine étape
produit après validation de cette fondation.

## Clarifications

### Session 2026-08-25

- Q: Un changement de protocole ou une migration incompatible est-il autorisé
  avant la V1 ? → R: Oui. La compatibilité indéfinie avec un protocole de
  synchronisation insuffisant n'est pas requise, mais tout contenu récupérable
  doit être conservé ou migré explicitement.
- Q: Plusieurs appareils du même propriétaire doivent-ils pouvoir modifier la
  même page hors ligne ? → R: Oui, y compris le même paragraphe, les mêmes
  blocs et leur ordre, puis se reconnecter dans n'importe quel ordre.
- Q: Un document complet peut-il être choisi comme version gagnante dans le
  parcours normal ? → R: Non. Les gestes compatibles doivent converger sous
  forme incrémentale. Une décision humaine est réservée aux intentions
  réellement incompatibles et ne doit jamais faire disparaître l'autre
  contenu.
- Q: Être connecté signifie-t-il être synchronisé ? → R: Non. Connexion,
  durabilité locale, envoi, persistance serveur, rattrapage et ambiguïté sont
  des états distincts.
- Q: Un accusé réseau suffit-il pour afficher « synchronisé » ? → R: Non. Le
  serveur doit avoir durablement validé la mise à jour et l'état permettant de
  la reconstruire avant que le client puisse la considérer synchronisée.
- Q: Le refus de `durable storage` par le navigateur est-il un conflit ? → R:
  Non. C'est un risque d'éviction local à présenter dans les réglages ou les
  diagnostics, jamais dans le libellé d'un conflit éditorial.
- Q: Faut-il ajouter un service externe ou un nouveau conteneur dédié ? → R:
  Non. La stack V1 reste limitée aux composants nécessaires à l'application.
  Aucun serveur Draw.io, service de collaboration hébergé ou fournisseur
  obligatoire n'est introduit.
- Q: Deux profils authentifiés peuvent-ils partager l'identité du premier
  appareil créé pendant le bootstrap ? → R: Non. Chaque profil navigateur
  possède une identité locale stable et non secrète, partagée par ses onglets
  mais distincte des autres profils. Une authentification valide enrôle ou
  retrouve exactement cet appareil ; elle ne choisit jamais arbitrairement le
  premier appareil du propriétaire.
- Q: Une simple obtention de challenge suffit-elle à une connexion passkey ? →
  R: Non. Le navigateur doit exécuter intégralement `navigator.credentials.get`,
  transmettre l'assertion au serveur et ne créer la session qu'après sa
  vérification. Un appareil révoqué reste terminal et ne peut pas être réactivé
  silencieusement par ce parcours.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Voir les changements connectés immédiatement (Priority: P1)

En tant que propriétaire utilisant deux appareils ou onglets connectés, je
vois les changements d'une page ouverte apparaître rapidement sur l'autre
écran, sans rechargement, remplacement de document ni message de conflit.

**Why this priority**: Le parcours connecté est le cas quotidien. S'il dépend
d'un rechargement ou crée déjà des conflits avec un seul propriétaire, aucune
promesse hors ligne ne sera crédible.

**Independent Test**: Ouvrir la même page dans deux profils de navigateur
indépendants, écrire et déplacer des blocs alternativement sur chacun, puis
mesurer la propagation et comparer les deux contenus sans recharger.

**Acceptance Scenarios**:

1. **Given** deux appareils connectés affichant la même page, **When** le
   propriétaire saisit du texte sur le premier, **Then** le second reçoit le
   changement en moins de deux secondes dans le cas normal et aucun conflit
   n'est créé.
2. **Given** une page modifiée sur un appareil pendant que l'autre onglet est
   en arrière-plan, **When** cet onglet redevient actif, **Then** il rattrape
   automatiquement tous les changements manquants sans perdre sa sélection ou
   un geste local déjà durable.
3. **Given** plusieurs pages ayant des mises à jour en attente, **When** la
   connexion temps réel devient disponible, **Then** chaque page est reprise
   sans obliger le propriétaire à l'ouvrir.
4. **Given** un changement accepté par le serveur, **When** d'autres appareils
   autorisés sont connectés, **Then** ils sont avertis d'un nouvel état durable
   et récupèrent le contenu par le chemin de synchronisation autorisé.

---

### User Story 2 - Converger après des modifications hors ligne (Priority: P1)

En tant que propriétaire, je peux continuer sur plusieurs appareils hors ligne
pendant des heures, des semaines ou des mois, puis les reconnecter dans
n'importe quel ordre et retrouver automatiquement toutes les intentions
compatibles.

**Why this priority**: « Mono-utilisateur » ne signifie pas
« mono-appareil ». La conservation de deux copies divergentes pendant une
longue déconnexion est le risque central du produit local-first.

**Independent Test**: Couper réellement le réseau de deux profils, modifier le
même paragraphe et l'ordre des blocs, fermer l'un des profils, puis reconnecter
les appareils dans différents ordres avec répétition et réordonnancement des
messages.

**Acceptance Scenarios**:

1. **Given** deux appareils hors ligne modifiant des blocs différents,
   **When** ils se reconnectent dans n'importe quel ordre, **Then** les deux
   modifications apparaissent sur tous les appareils sans décision manuelle.
2. **Given** deux appareils hors ligne insérant ou formatant du texte dans le
   même paragraphe, **When** ils se reconnectent, **Then** les caractères et
   marques compatibles convergent vers le même résultat sur chaque appareil.
3. **Given** un appareil qui déplace un bloc pendant qu'un autre en modifie le
   contenu, **When** les mises à jour sont échangées, **Then** l'identité du
   bloc, son contenu et son déplacement sont tous conservés.
4. **Given** deux déplacements concurrents ou des insertions à la même
   position, **When** les appareils convergent, **Then** l'ordre final est
   déterministe et identique partout, indépendamment de l'ordre de livraison.
5. **Given** un appareil qui supprime un bloc pendant qu'un autre le modifie,
   **When** les intentions ne peuvent pas être affichées ensemble, **Then** le
   document courant reste cohérent et le contenu modifié demeure récupérable
   jusqu'à une décision explicite.
6. **Given** des messages dupliqués, retardés ou reçus après une reconnexion,
   **When** ils sont retraités, **Then** aucun geste n'est appliqué deux fois et
   tous les appareils atteignent le même état.

---

### User Story 3 - Survivre aux coupures et redémarrages sans mentir (Priority: P1)

En tant que propriétaire, je peux fermer brutalement le navigateur, perdre le
réseau ou subir un redémarrage du serveur sans perdre une modification déjà
confirmée localement et sans voir « synchronisé » avant sa persistance réelle.

**Why this priority**: Une synchronisation rapide qui reconnaît trop tôt les
écritures est plus dangereuse qu'une synchronisation lente : elle donne une
fausse assurance de sécurité.

**Independent Test**: Injecter une interruption à chaque frontière entre saisie,
écriture locale, envoi, transaction serveur, réponse, projection et réception
distante, puis redémarrer et comparer l'état durable attendu.

**Acceptance Scenarios**:

1. **Given** une modification affichée comme enregistrée sur l'appareil,
   **When** le navigateur est tué immédiatement, **Then** la modification
   réapparaît au prochain lancement et repart automatiquement vers le serveur.
2. **Given** une mise à jour envoyée mais non encore confirmée durablement,
   **When** la connexion tombe, **Then** elle reste en attente et est retentée
   sans duplication.
3. **Given** une transaction serveur validée mais sa réponse perdue, **When** le
   client renvoie la même mise à jour, **Then** le serveur la reconnaît et
   confirme l'état déjà durable sans créer une seconde opération.
4. **Given** une erreur de stockage serveur, **When** la transaction échoue,
   **Then** aucun client ne reçoit de confirmation de synchronisation ni
   d'annonce d'un état inexistant.
5. **Given** le retour du réseau ou le redémarrage de l'application, **When**
   des pages ont du travail en attente, **Then** la reprise commence
   automatiquement et progresse sans bouton de sauvegarde.

---

### User Story 4 - Auto-réparer un navigateur hérité (Priority: P1)

En tant que propriétaire ayant déjà testé d'anciennes versions, je peux ouvrir
la nouvelle application sans rester bloqué par des conflits de remplacement
complet, des mutations obsolètes ou un refus de stockage persistant sans lien
avec mon contenu.

**Why this priority**: L'erreur observée montre que les anciens états locaux
peuvent rendre le nouveau système inutilisable même quand un seul appareil
écrit. Une migration fiable fait partie de la fonctionnalité, pas du support
manuel.

**Independent Test**: Charger des bases locales représentatives de chaque
ancienne version, avec mutations en attente, conflits, envois interrompus et
stockage persistant refusé, puis démarrer et vérifier la récupération.

**Acceptance Scenarios**:

1. **Given** un ancien conflit de remplacement complet contenant un brouillon
   récupérable, **When** l'application migre sa base locale, **Then** le
   brouillon rejoint le chemin incrémental ou une branche récupérable et
   l'ancien conflit cesse d'empoisonner le statut global.
2. **Given** une ancienne mutation déjà intégrée à l'état opérationnel,
   **When** la migration l'identifie, **Then** elle est archivée de façon
   idempotente sans réappliquer son contenu.
3. **Given** une entrée illisible ou incompatible, **When** elle ne peut pas
   être migrée sûrement, **Then** ses octets et métadonnées minimales sont
   conservés dans une quarantaine exportable et une seule action claire est
   demandée.
4. **Given** que le navigateur refuse le stockage persistant, **When** aucun
   conflit éditorial n'existe, **Then** l'espace de travail n'affiche pas
   « Conflict » ; le risque d'éviction apparaît séparément dans une surface de
   diagnostic.
5. **Given** uniquement des opérations normales provenant du même appareil,
   **When** elles sont synchronisées et confirmées, **Then** le compteur de
   conflit revient à zéro sans intervention manuelle.

---

### User Story 5 - Rester sûr lors des changements d'appareil et restaurations (Priority: P2)

En tant que propriétaire, je peux révoquer un appareil, restaurer une sauvegarde
ou rattraper une très longue absence sans qu'un ancien client réécrive
silencieusement l'installation ou contourne les protections existantes.

**Why this priority**: Les garanties de synchronisation ne doivent pas affaiblir
l'authentification, le chiffrement, les sauvegardes ou la récupération déjà
livrés.

**Independent Test**: Révoquer un appareil connecté, restaurer un état serveur
antérieur avec des appareils possédant encore des opérations locales, puis
vérifier autorisation, récupération et convergence.

**Acceptance Scenarios**:

1. **Given** un appareil connecté qui est révoqué, **When** la révocation est
   validée, **Then** sa session temps réel est interrompue et aucune nouvelle
   opération n'est acceptée.
2. **Given** un appareil autorisé absent pendant quatre-vingt-dix jours,
   **When** il revient avec des mises à jour valides, **Then** le temps écoulé
   seul ne provoque ni perte ni rejet de sa lignée.
3. **Given** une sauvegarde serveur restaurée alors qu'un appareil possède des
   gestes plus récents, **When** il se reconnecte, **Then** le système distingue
   les lignées et préserve les gestes sans remplacement silencieux.
4. **Given** un bloc de fichier ajouté hors ligne, **When** le document est
   repris avant la fin du transfert des octets, **Then** l'état global ne dit
   pas « synchronisé sur tous les appareils » avant la durabilité du document
   et du fichier.

### Edge Cases

- La connexion tombe juste avant, pendant ou juste après la validation de la
  transaction serveur.
- Le serveur redémarre après avoir persisté une mise à jour mais avant d'avoir
  averti les autres appareils.
- Un onglet passe en arrière-plan, est gelé par le système puis revient avec une
  session expirée.
- Deux onglets du même profil utilisent la même base locale et tentent de
  reprendre la même opération.
- Une notification est perdue, dupliquée ou arrive avant la réponse à l'auteur
  du changement.
- Un lot dépasse la taille admise ou contient une mise à jour valide suivie
  d'une mise à jour corrompue.
- Un appareil ancien utilise une version de protocole devenue incompatible.
- La frontière locale affirme connaître une opération absente du serveur ou
  inversement.
- Une restauration réutilise un identifiant de page avec une lignée
  opérationnelle différente.
- Le quota local est presque plein, une écriture locale échoue ou le navigateur
  refuse la garantie de stockage persistant.
- Un proxy HTTPS coupe les connexions inactives ou ne transmet pas une reprise
  de session.
- Une page absente du cache local reçoit une annonce pendant que d'autres pages
  possèdent une file d'attente importante.
- Un appareil est révoqué pendant qu'une requête est en vol.
- Une pièce jointe est référencée avant que ses octets soient disponibles sur
  le serveur ou un appareil destinataire.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Toute transaction éditoriale MUST être écrite dans le stockage
  local chiffré avant d'être présentée comme enregistrée sur l'appareil.
- **FR-002**: Le parcours normal d'édition MUST synchroniser des mises à jour
  causales incrémentales ; il MUST NOT remplacer le document canonique complet
  pour enregistrer une frappe, un formatage, une insertion, une suppression ou
  un déplacement.
- **FR-003**: Lorsqu'un réseau est disponible, chaque instance active MUST
  maintenir une session bidirectionnelle authentifiée capable de transporter
  les échanges de plusieurs pages sans ouvrir une session par frappe.
- **FR-004**: Une session disponible MUST permettre à l'auteur d'envoyer une
  mise à jour et aux autres appareils autorisés d'être avertis rapidement d'un
  nouvel état serveur durable.
- **FR-005**: Le serveur MUST confirmer une mise à jour uniquement après
  validation atomique de ses opérations, de la frontière causale, de la
  projection canonique et des métadonnées nécessaires à leur reconstruction.
- **FR-006**: Les mises à jour MUST posséder des identifiants immuables et être
  retraitables au moins une fois sans duplication d'effet.
- **FR-007**: Une réponse perdue après validation serveur MUST pouvoir être
  remplacée par la confirmation idempotente de la même mise à jour.
- **FR-008**: La file locale chiffrée MUST rester l'autorité du travail non
  confirmé ; une file uniquement en mémoire MUST NOT être la seule copie d'un
  changement propriétaire.
- **FR-009**: Le lancement de l'application, le retour en ligne, la reprise
  d'une session et le réveil d'un onglet MUST relancer automatiquement les pages
  en attente, y compris celles qui ne sont pas ouvertes.
- **FR-010**: Une annonce temps réel MUST être un signal de rattrapage et non
  une seconde source de contenu ; un appareil MUST pouvoir reconstruire tout
  changement manqué à partir de sa frontière durable.
- **FR-011**: Texte, marques, insertions, identités de blocs, imbrication et
  déplacements compatibles MUST converger vers le même état indépendamment de
  l'ordre, du découpage ou de la duplication des livraisons.
- **FR-012**: Un déplacement concurrent avec une édition MUST conserver la même
  identité de bloc, son nouvel emplacement et son contenu modifié.
- **FR-013**: Les insertions et déplacements concurrents MUST produire un ordre
  déterministe commun à tous les appareils.
- **FR-014**: Une suppression concurrente avec une édition MUST préserver le
  contenu édité dans une forme récupérable lorsqu'il ne peut pas rester visible
  dans le document courant.
- **FR-015**: Une décision manuelle MUST être créée uniquement pour des
  intentions incompatibles que le système ne peut satisfaire ensemble ; elle
  MUST être limitée au contenu ambigu et ne jamais demander de choisir un
  document complet.
- **FR-016**: Connexion réseau, durabilité locale, envoi, confirmation serveur,
  rattrapage distant et ambiguïté MUST être des états distincts et observables.
- **FR-017**: Le libellé « synchronisé sur tous les appareils » MUST apparaître
  uniquement quand aucun travail local, en vol, bloqué, non confirmé, fichier
  incomplet ou décision active ne subsiste.
- **FR-018**: Le refus du stockage persistant par le navigateur MUST être
  présenté comme un avertissement de résilience séparé et MUST NOT augmenter le
  nombre de conflits éditoriaux.
- **FR-019**: Les anciens conflits et mutations de remplacement de page MUST
  être migrés de manière idempotente vers une mise à jour incrémentale, une
  branche récupérable ou une quarantaine explicite.
- **FR-020**: Une migration MUST conserver les octets récupérables et la
  provenance minimale de toute entrée qu'elle ne peut interpréter sûrement ;
  elle MUST NOT supprimer silencieusement un brouillon.
- **FR-021**: Une entrée historique déjà reflétée dans l'état courant MUST être
  archivée sans réappliquer son contenu ni maintenir un faux conflit global.
- **FR-022**: Le compteur global de conflits MUST représenter uniquement les
  décisions propriétaire encore actives et non des diagnostics, erreurs
  transitoires ou entrées obsolètes.
- **FR-023**: La session distante MUST vérifier l'installation, la session du
  propriétaire, l'origine attendue, la protection anti-rejeu intersite, la
  version du protocole et l'autorisation de l'appareil avant tout échange de
  contenu.
- **FR-024**: La révocation d'un appareil MUST interrompre ses sessions actives
  et empêcher ses échanges ultérieurs, y compris après une reconnexion.
- **FR-025**: Les appareils utilisant un protocole d'écriture incompatible MUST
  être refusés explicitement ; ils MUST NOT pouvoir produire des remplacements
  historiques silencieux.
- **FR-026**: Taille des messages, fréquence, nombre de requêtes en vol et temps
  d'inactivité MUST être bornés ; leur dépassement MUST échouer sans perdre la
  file locale ni bloquer les autres appareils.
- **FR-027**: Journaux et métriques MUST exposer connexion, reconnexion,
  latence, lots, rattrapage et erreurs corrélées sans enregistrer le contenu,
  les clés ou les charges chiffrées propriétaires.
- **FR-028**: Une longue absence d'un appareil encore autorisé MUST NOT, par le
  seul effet du temps, rendre ses mises à jour impossibles à intégrer.
- **FR-029**: Sauvegarde, restauration et migration MUST inclure ou reconstruire
  la représentation opérationnelle, les frontières, les projections et les
  informations nécessaires à un rattrapage sûr.
- **FR-030**: Après restauration serveur, les opérations plus récentes d'un
  appareil MUST être rapprochées de la lignée restaurée sans écrasement
  silencieux ; toute divergence irréconciliable MUST rester récupérable.
- **FR-031**: Un contenu référençant un fichier MUST distinguer la durabilité de
  l'opération documentaire de celle des octets et MUST attendre les deux avant
  d'annoncer une synchronisation complète.
- **FR-032**: Le chemin temps réel MUST fonctionner dans le déploiement officiel
  derrière un proxy HTTPS et reprendre après une coupure ou expiration de
  connexion sans intervention du propriétaire.
- **FR-033**: Un chemin de rattrapage borné MAY rester disponible lorsque la
  session persistante ne peut pas être établie, mais il MUST partager la même
  autorité opérationnelle et ne pas devenir un second écrivain concurrent.
- **FR-034**: La solution MUST fonctionner dans les processus applicatifs et la
  stack auto-hébergée existants sans service externe obligatoire ni nouveau
  conteneur de collaboration.
- **FR-035**: Les comportements de convergence, durabilité, reprise, migration
  et sécurité MUST être testés avec au moins deux profils de navigateur
  réellement isolés ainsi qu'avec des permutations déterministes au niveau du
  domaine et du serveur.
- **FR-036**: Le fonctionnement hors ligne d'une page déjà disponible localement
  MUST rester possible lorsque la session distante est absente, en échec ou en
  cours de reprise.
- **FR-037**: Chaque profil navigateur MUST conserver une identité d'appareil
  stable, non secrète et indépendante du contenu ; ses onglets MUST partager
  cette identité, tandis que deux profils isolés MUST obtenir deux identités et
  deux lignes d'appareil autorisé distinctes.
- **FR-038**: Le bootstrap et chaque connexion MUST lier la session à l'identité
  d'appareil présentée par ce profil après preuve valide du propriétaire. Le
  serveur MUST créer un nouvel appareil actif, retrouver l'appareil actif ou
  terminer une réautorisation explicitement demandée ; il MUST NOT se rabattre
  sur le premier appareil du propriétaire ni réactiver une ligne révoquée.
- **FR-039**: La connexion passkey MUST exécuter la cérémonie WebAuthn complète
  dans le navigateur, vérifier l'assertion côté serveur et échouer sans session
  si la cérémonie est annulée, invalide ou liée à une origine incorrecte.

### Key Entities

- **Session de synchronisation**: Connexion authentifiée d'une instance de
  l'application, avec appareil, version de protocole, état de vie et requêtes
  corrélées en cours.
- **Mise à jour éditoriale durable**: Intention causale immuable, d'abord
  conservée localement puis validée de manière idempotente par le serveur.
- **Frontière causale**: Résumé durable de ce qu'un appareil ou le serveur a
  déjà intégré, utilisé pour demander uniquement le rattrapage manquant.
- **Annonce d'avancement**: Signal compact indiquant qu'une page possède un
  nouvel état serveur durable, sans porter lui-même l'autorité du contenu.
- **Projection canonique**: Représentation durable indépendante de l'éditeur,
  reconstruite depuis l'état opérationnel pour lecture, export, recherche,
  historique et sauvegarde.
- **Décision propriétaire**: Cas réellement ambigu contenant toutes les
  intentions récupérables et restant actif jusqu'à résolution explicite.
- **Entrée historique récupérable**: Mutation ou conflit d'une ancienne version
  à convertir, archiver ou mettre en quarantaine sans perte silencieuse.
- **État de synchronisation**: Composition des états local, transport, serveur,
  fichier et décision, utilisée pour produire un statut utilisateur honnête.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Dans un environnement connecté normal, 95 % des changements d'une
  page ouverte sont visibles sur un second appareil autorisé en moins de deux
  secondes, sans rechargement.
- **SC-002**: Mille permutations générées de découpage, ordre, duplication et
  reconnexion convergent vers le même document et la même frontière sur tous
  les appareils.
- **SC-003**: Cent scénarios indépendants où deux appareils modifient hors ligne
  le même paragraphe conservent toutes les insertions et marques compatibles
  sans décision manuelle.
- **SC-004**: Cent scénarios de déplacement avec édition concurrente, et cent
  scénarios de déplacements concurrents, conservent les identités et convergent
  vers un ordre identique.
- **SC-005**: Cent scénarios de suppression avec édition concurrente ne perdent
  aucun contenu édité ; toute intention non visible reste récupérable.
- **SC-006**: Une matrice d'interruption couvrant chaque frontière locale et
  serveur ne produit aucune modification confirmée perdue et aucun faux état
  « synchronisé ».
- **SC-007**: Après validation serveur suivie d'une perte de réponse, cent
  nouvelles tentatives produisent exactement une opération durable et une
  confirmation correcte.
- **SC-008**: Un appareil simulé absent quatre-vingt-dix jours et en retard de
  dix mille mises à jour rattrape l'état par lots bornés sans remplacement
  complet ni expiration arbitraire de sa lignée.
- **SC-009**: Après retour du réseau, 95 % des instances reprennent leur session
  et commencent à drainer le travail en attente en moins de cinq secondes dans
  un environnement normal.
- **SC-010**: Toutes les bases locales historiques de la matrice de migration
  terminent avec zéro faux conflit ; chaque contenu non migrable possède une
  branche ou quarantaine exportable.
- **SC-011**: Les parcours automatisés de frappe, formatage, insertion,
  suppression et déplacement n'émettent aucun remplacement de document complet
  sur leur chemin normal.
- **SC-012**: Une erreur injectée dans chaque écriture serveur empêche toujours
  la confirmation et l'annonce correspondantes.
- **SC-013**: Les parcours critiques passent sur Chromium ordinateur et mobile,
  Firefox ordinateur, WebKit ordinateur et mobile avec deux contextes isolés
  lorsque le scénario est multi-appareils.
- **SC-014**: La stack officielle validée ne contient aucun serveur Draw.io,
  service de collaboration externe ni conteneur supplémentaire requis par
  cette feature.
- **SC-015**: Quand un seul appareil effectue des modifications ordinaires et
  que le serveur les confirme, le statut revient automatiquement à zéro élément
  en attente et zéro décision non résolue.
- **SC-016**: Deux profils vierges authentifiés sur la même installation
  produisent deux `deviceId`, deux bases locales et deux sessions attribuées
  correctement ; une reconnexion du même profil réutilise son `deviceId`, et la
  révocation de l'un n'interrompt ni ne réattribue l'autre.

## Assumptions

- Une installation conserve exactement un propriétaire et un workspace ; les
  différents clients représentent ses appareils ou onglets autorisés.
- Le modèle canonique version 3 et la représentation opérationnelle convergente
  existante restent les formats de départ ; le plan peut les faire évoluer si
  les preuves requises restent satisfaites et si la migration est explicite.
- Les données de page et files locales existantes sont chiffrées ; cette
  feature conserve cette exigence et ne confie pas le contenu propriétaire à
  une file volatile.
- Le flux de métadonnées du workspace peut continuer à utiliser son mécanisme
  actuel tant qu'il ne concurrence pas l'autorité du contenu éditorial.
- Le navigateur peut refuser la garantie de stockage persistant. L'application
  doit alors expliquer le risque d'éviction, mais ne peut pas promettre une
  garantie que la plateforme refuse.
- Les changements incompatibles de protocole sont acceptables avant la V1 ; la
  préservation des données utilisateur reste obligatoire.
- Une application complètement fermée ne peut pas compter sur une exécution en
  arrière-plan universelle. Elle doit reprendre automatiquement au prochain
  lancement.

## Out of Scope

- Collaboration entre plusieurs personnes, présence, curseurs distants,
  commentaires temps réel et permissions d'équipe.
- Nouvelle migration d'éditeur ou remplacement de l'interface de blocs déjà
  choisie uniquement pour obtenir le transport.
- Finition générale Notion-like, refonte de l'arborescence, insertion dans un
  dossier et commande `/page`, qui suivent cette fondation.
- Refonte globale des bases structurées ou de tous les objets métier tant que
  leur fonctionnement ne compromet pas le contenu éditorial.
- Service de synchronisation hébergé, serveur de collaboration séparé, nouveau
  conteneur, serveur Draw.io, tableau blanc ou canevas.
- Garantie de synchronisation en arrière-plan lorsque le navigateur et le
  système d'exploitation ont complètement arrêté l'application.
