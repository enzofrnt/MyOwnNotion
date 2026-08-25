# Research: Synchronisation éditoriale temps réel durable

Recherche consolidée le 25 août 2026 à partir des documentations officielles,
des sources des bibliothèques candidates et des preuves déjà exécutées dans la
feature 017. Les retours communautaires ont servi à découvrir des pistes, mais
aucune décision ci-dessous ne dépend d'une affirmation Reddit.

## Decision 1 — Conserver le modèle Loro par blocs stables

**Decision**: Garder `@myownnotion/page-state` comme autorité opérationnelle :
un `LoroTree` représente la hiérarchie mobile et un `LoroText` représente le
texte riche de chaque bloc identifié. Le document canonique v3 reste une
projection vérifiée.

**Rationale**: Le défaut à corriger est surtout le transport et la reprise, pas
la convergence déjà prouvée. Les tests de la 017 couvrent édition concurrente
du même paragraphe, déplacement avec édition, déplacements concurrents et
suppression avec contenu récupérable. Remplacer ce modèle par le document
ProseMirror/Yjs natif de BlockNote ferait régresser l'identité d'un bloc déplacé.

Loro fournit des updates commutatifs, des version vectors, du texte riche et un
arbre dont les nœuds peuvent être déplacés sans être supprimés puis recréés.
Cette combinaison correspond directement aux UUID stables du format canonique.

**Alternatives considered**:

- **BlockNote + Yjs natif**: excellente intégration de collaboration et de
  traitement serveur, mais le binding ProseMirror représente un déplacement
  structurel comme suppression/insertion. Le prototype 017 a pu rattacher une
  édition concurrente au bloc voisin. Yjs reste un bon CRDT ; son binding natif
  n'exprime simplement pas l'identité de déplacement exigée ici.
- **Hocuspocus/Yjs**: serveur WebSocket mature, mais il réintroduit le modèle
  Yjs écarté et impose de réadapter chiffrement, projection, historique,
  ambiguïtés, fichiers et transaction PostgreSQL.
- **Loro ProseMirror binding**: MIT et utile pour un document ProseMirror
  générique, mais son adaptation des enfants supprime et recrée les nœuds non
  appariés. Elle n'apporte pas les moves sémantiques déjà présents dans le
  modèle MyOwnNotion.
- **Automerge Repo**: transport et stockage pair-à-pair solides, mais pas de
  binding BlockNote stable par identité ; un pont spécifique reste nécessaire.
- **BlockSuite Store**: modèle Yjs par blocs plus proche du besoin, mais son
  adoption remplacerait éditeur, store et frontières documentaires, avec une
  surface de migration bien plus grande que le défaut à corriger.

**Sources**:

- Loro, synchronisation et version vectors :
  https://www.loro.dev/docs/tutorial/sync
- Loro, arbre mobile : https://www.loro.dev/docs/tutorial/tree
- Loro, texte riche : https://www.loro.dev/docs/tutorial/text
- BlockNote, collaboration Yjs :
  https://www.blocknotejs.org/docs/features/collaboration
- BlockNote, traitement serveur :
  https://www.blocknotejs.org/docs/features/server-processing
- Loro ProseMirror, sources et licence :
  https://github.com/loro-dev/loro-prosemirror
- BlockSuite Store : https://blocksuite.io/guide/store
- Automerge Repo : https://github.com/automerge/automerge-repo

## Decision 2 — WebSocket typé dans le processus Fastify existant

**Decision**: Ajouter `@fastify/websocket` 11.3.x à l'API et utiliser le
WebSocket natif du navigateur. Une connexion par instance Web multiplexe toutes
les pages. Aucun serveur Hocuspocus, Y-Sweet, Loro WebSocket ou fournisseur
externe n'est ajouté.

**Rationale**: Le besoin est une session bidirectionnelle persistante avec
requêtes corrélées et notifications faibles latences. Le service
`PageOperationService.sync()` et ses DTO existent déjà ; un adaptateur
WebSocket peut les réutiliser sans créer une seconde logique de synchronisation.
Le plugin Fastify suit les hooks, décorateurs et cycle d'arrêt du serveur actuel
et utilise la bibliothèque `ws` côté Node. Le navigateur n'a besoin d'aucune
dépendance de reconnexion si l'automate reste petit et testé.

Le gestionnaire `message` sera attaché synchroniquement dès l'ouverture, comme
l'exige la documentation du plugin : toute autorisation asynchrone se déroule
ensuite derrière un état `awaiting-hello`, afin de ne pas perdre les premiers
messages.

**Alternatives considered**:

- **Continuer HTTP + SSE**: protège déjà les données, mais multiplie les cycles
  annonce → requête, possède deux automates de reconnexion et explique la
  latence et les états incohérents observés. SSE reste temporairement utile pour
  les métadonnées du workspace, pas pour le corps des pages.
- **WebTransport**: API et déploiement HTTP/3 moins universels, sans bénéfice
  nécessaire pour des lots fiables et ordonnés.
- **Socket.IO**: reconnexion et fallback fournis, mais protocole supplémentaire,
  dépendances cliente/serveur et fonctionnalités de rooms non nécessaires pour
  dix appareils d'un seul propriétaire.
- **Protocole officiel Loro WebSocket**: multiplexage, fragments, ACK,
  authentification et reconnexion intéressants comme référence. Son adaptateur
  envoie toutefois les commits directement depuis le document en mémoire et son
  ACK générique ne prouve ni l'écriture IndexedDB préalable ni la transaction
  PostgreSQL, la projection canonique et les ambiguïtés MyOwnNotion.

**Sources**:

- Fastify WebSocket, hooks, attachement synchrone et options :
  https://github.com/fastify/fastify-websocket
- WebSocket API du navigateur :
  https://developer.mozilla.org/docs/Web/API/WebSocket
- Protocole Loro, multiplexage et ACK :
  https://github.com/loro-dev/protocol/blob/main/protocol.md
- Client officiel `loro-websocket` :
  https://github.com/loro-dev/protocol/tree/main/packages/loro-websocket

## Decision 3 — L'accusé applicatif est le commit PostgreSQL

**Decision**: Le message `sync-result` n'est envoyé qu'après le retour réussi de
la transaction de `PageOperationService.sync()`. Cette transaction conserve
ensemble updates, enveloppes, frontières, projection canonique, révision et
séquence. Une erreur ou une coupure avant ce point n'est jamais confirmée.

**Rationale**: Le transport ne peut pas définir la durabilité. Un frame reçu ou
un document appliqué en mémoire ne garantit pas que le serveur saura le
reconstruire après crash. Le service actuel possède déjà la bonne frontière :
il retourne après la transaction, annonce ensuite la séquence commitée, met à
jour la recherche en best effort et seulement alors remet sa réponse à la
route.

Si le commit réussit mais que la réponse disparaît, le client renvoie les mêmes
`updateId`. Le service distingue déjà `accepted` et `repeated`, ce qui fournit
un protocole at-least-once sans double effet.

**Alternatives considered**:

- **ACK dès réception du frame**: rapide mais faux après crash serveur.
- **ACK après application CRDT en mémoire**: convergent mais non durable.
- **Persistance périodique/debounced d'un serveur collaboratif**: adaptée à la
  présence temps réel, mais ne permet pas d'afficher immédiatement
  « synchronisé sur tous les appareils » selon la définition produit.
- **Deux ACK, mémoire puis disque**: utile dans un produit collaboratif à
  latence extrême, mais ajoute un état sans valeur ici ; l'édition est déjà
  instantanée et durable localement.

**Sources**:

- Hocuspocus, cycle des hooks :
  https://tiptap.dev/docs/hocuspocus/server/hooks
- Hocuspocus, guide de persistance :
  https://tiptap.dev/docs/hocuspocus/guides/persistence

## Decision 4 — Notification après commit, rattrapage par frontière

**Decision**: Après un commit de page, publier `page-advanced` avec `pageId` et
`latestPageSequence` indépendamment de l'envoi de la réponse à l'auteur. Toutes
les sessions peuvent le recevoir et ignorer une séquence déjà dominée. Le
destinataire appelle le même échange `sync` depuis sa frontière locale. Au
`ready`, au retour réseau et au réveil, le client draine aussi toutes les pages
en attente ou ouvertes.

**Rationale**: Une notification est par nature perdable : crash entre commit et
publish, proxy, onglet gelé ou socket fermé. En faire le contenu ou le curseur
appliqué créerait une perte dès qu'un événement manque. Le journal serveur et
la frontière locale sont durables ; le signal ne fait que réduire la latence.

Le notifier en mémoire est suffisant pour une API mono-processus. Si plusieurs
réplicas API deviennent un jour nécessaires, son interface est le point de
remplacement par une notification PostgreSQL ou un bus ; aucune infrastructure
inutilisée n'est ajoutée en V1.

**Alternatives considered**:

- **Pousser les octets dans `page-advanced`**: deuxième chemin d'entrée sans la
  validation et l'atomicité du réconciliateur.
- **S'abonner à chaque page côté serveur**: plus de messages join/leave et de
  risques de manquer une page fermée. Dix appareils peuvent recevoir un signal
  compact et ignorer les séquences déjà connues.
- **Polling seul**: bon filet de sécurité, insuffisant pour l'objectif de deux
  secondes.

## Decision 5 — Session cookie à l'upgrade, CSRF dans `hello`

**Decision**: Vérifier l'origine exacte et la session cookie pendant le
handshake. Le premier message contient le token CSRF lié à la session, la
version temps réel et la version page. Le token n'est jamais placé dans l'URL,
un sous-protocole, un stockage persistant ou un journal. L'appareil est contrôlé
au `hello`, périodiquement et avant chaque écriture sensible.

**Rationale**: Le constructeur WebSocket du navigateur ne permet pas d'ajouter
un en-tête arbitraire. Une query string survivrait dans historiques et logs. Un
premier message sur un socket déjà authentifié permet la même comparaison HMAC
à temps constant que les routes HTTP, sans exposer le secret. Aucun échange de
contenu n'est accepté avant `ready`.

L'en-tête `Origin` exact protège contre le WebSocket cross-site avec cookie. La
limite de message couvre le lot 1 MiB encodé et son enveloppe, la concurrence
est bornée et la révocation ferme la session avec un code stable. Les écritures
revalident en plus l'appareil sous le même verrou transactionnel que sa
révocation : une prévalidation de socket seule laisserait une course entre les
deux commits.

**Sources**:

- OWASP, Cross-Site WebSocket Hijacking et validation d'origine :
  https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- MDN, constructeur WebSocket :
  https://developer.mozilla.org/docs/Web/API/WebSocket/WebSocket

## Decision 6 — Repli HTTP exclusif, pas de double écriture

**Decision**: Garder la route HTTP `/v1/page-operations/:pageId/sync` comme
repli de compatibilité et récupération. Pour une invocation donnée, le
transport choisit WebSocket ou HTTP, jamais les deux en parallèle. Une coupure
après envoi rejette l'invocation ; le réconciliateur reprend ensuite le même lot
sur n'importe quel transport.

**Rationale**: Le repli permet l'usage derrière un proxy momentanément mal
configuré et un rollback du canal temps réel sans changement de format. La
sélection exclusive évite deux réponses concurrentes qui tenteraient de
committer la même progression locale. L'idempotence serveur traite le seul cas
inévitable : le client ignore si une requête perdue avait été commitée.

**Alternative considered**: supprimer immédiatement HTTP. Cela réduit une route
mais transforme une mauvaise directive proxy en panne totale et rend le rollback
plus risqué sans supprimer de logique métier, puisque le service reste requis.

## Decision 7 — Migration après déverrouillage, preuve chiffrée conservée

**Decision**: Ajouter un index local v9 de récupération. Ne jamais déchiffrer
dans le callback de migration Dexie : il ajoute seulement la table et les
index. Après établissement de la clé, un service idempotent classe chaque ancien
conflit de page, produit une branche sémantique lorsque possible et ne retire la
preuve chiffrée qu'après installation durable du résultat.

**Rationale**: Les migrations Dexie s'exécutent à l'ouverture, avant que la clé
locale soit nécessairement disponible. Déchiffrer à cet endroit rendrait la base
impossible à ouvrir après un simple verrouillage. Une table de routage claire
peut indiquer l'état sans dupliquer le contenu ; le conflit chiffré existant est
la quarantaine la plus sûre jusqu'à conversion.

Les conflits `page.document.replace` ne sont plus des décisions actives du
nouveau modèle. Les compter avec les ambiguïtés Loro crée exactement le faux
message observé. Ils sont donc comptés comme récupérations historiques et non
comme conflits, avec une surface de diagnostic dédiée si une preuve manque.

**Alternatives considered**:

- **Effacer les conflits historiques au changement de protocole**: perte de
  brouillons potentiels, interdite.
- **Les laisser dans le compteur global**: bloque indéfiniment un appareil même
  après activation opérationnelle.
- **Réutiliser la résolution “choisir local ou distant”**: restaure le
  remplacement complet que cette feature supprime.

## Decision 8 — Aucun moteur de réplication de base externe

**Decision**: Ne pas ajouter ElectricSQL, PowerSync, RxDB Cloud ou une base
local-first tierce pour le corps des pages.

**Rationale**: Ces outils excellent à transporter des lignes et requêtes
locales, mais la difficulté produit est la convergence d'un paragraphe riche et
d'un arbre mobile. MyOwnNotion possède déjà le journal causal, le chiffrement,
les files, les checkpoints, la projection et les sauvegardes. Remplacer toute
la réplication agrandirait fortement la migration sans résoudre seul le modèle
de blocs.

Ils pourraient être réévalués pour des bases structurées volumineuses dans une
feature distincte, avec leur propre autorité et leurs propres tests.

**Sources**:

- ElectricSQL, architecture et sync partielle : https://electric-sql.com/docs
- PowerSync, architecture local-first : https://docs.powersync.com
- RxDB, réplication : https://rxdb.info/replication.html

## Decision 9 — Heartbeat applicatif et proxy officiel explicite

**Decision**: Envoyer un heartbeat applicatif régulier, fermer une session muette
après une fenêtre bornée et configurer Vite/nginx pour l'upgrade. Le proxy HTTPS
administrateur reçoit un exemple avec timeouts supérieurs au heartbeat.

**Rationale**: Le navigateur n'expose pas les frames ping/pong bas niveau. Un
message applicatif détecte une demi-connexion que `online` ne voit pas et garde
les proxies informés. Le client reconnecte avec exponentielle, jitter et plafond
court ; le serveur libère abonnements, timers et requêtes au close.

**Sources**:

- nginx, WebSocket proxying :
  https://nginx.org/en/docs/http/websocket.html
- Vite, options de proxy : https://vite.dev/config/server-options#server-proxy

## Decision 10 — La finition UI suit la preuve de synchronisation

**Decision**: Limiter les changements visibles de cette feature au statut de
synchronisation et aux diagnostics. L'arborescence, l'insertion dans un dossier,
la commande `/page` et le reste de la finition Notion-like reprennent après
validation de la matrice multi-appareils.

**Rationale**: Le modèle d'éditeur et le shell ont déjà changé dans la 017.
Mélanger maintenant un nouveau transport, une migration historique et une
nouvelle navigation rendrait chaque régression difficile à isoler. Une fois la
durabilité et le temps réel prouvés, l'UI pourra évoluer au-dessus d'une
fondation stable sans réécrire encore son cycle de sauvegarde.
