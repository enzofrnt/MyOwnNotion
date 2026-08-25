# Implementation Plan: Synchronisation éditoriale temps réel durable

**Branch**: `codex/018-durable-realtime-sync` | **Date**: 2026-08-25 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from
`/specs/018-durable-realtime-sync/spec.md`

## Summary

Conserver l'autorité opérationnelle Loro et le journal de page chiffré livrés
par la feature 017, puis remplacer le transport courant HTTP déclenché par SSE
par une session WebSocket bidirectionnelle, typée et multiplexée dans le
processus Fastify existant.

Le navigateur continue à persister chaque mise à jour dans IndexedDB avant
envoi. Le nouveau transport ne possède jamais l'unique copie d'un geste : il
prend un lot depuis la file durable, l'envoie avec son identité immuable et ne
rend une réponse positive au réconciliateur qu'après le retour de la transaction
PostgreSQL existante. Une perte de connexion réarme le même lot ; le serveur le
reconnaît de façon idempotente s'il avait déjà validé l'écriture.

Après chaque commit éditorial, un hub en mémoire annonce seulement l'identité
de la page et sa nouvelle séquence aux autres sessions autorisées. L'annonce ne
porte pas le contenu : chaque client rattrape sa propre frontière par le même
contrat de synchronisation vérifié. Une reprise au lancement, au retour réseau,
au réveil et après reconnexion couvre les notifications perdues et les pages
fermées. La route HTTP actuelle reste un repli borné utilisant exactement le
même service transactionnel ; elle ne devient jamais un deuxième écrivain.

Enfin, une migration locale classe les anciens conflits
`page.document.replace`. Elle reconstruit leurs intentions comme branche
sémantique lorsque les ancêtres sont disponibles, archive les entrées déjà
intégrées ou conserve les octets illisibles dans une quarantaine exportable.
Ces reliquats et le refus de stockage persistant cessent d'être comptés comme
des conflits éditoriaux actifs.

La validation en stack vierge a aussi révélé que l'authentification historique
attribuait toute nouvelle session au premier appareil autorisé et que le bouton
passkey ne terminait pas sa cérémonie. La feature ferme ce prérequis : une
identité de profil non secrète est créée une fois côté navigateur, fournie au
bootstrap et aux connexions, puis résolue transactionnellement vers son propre
`deviceId`. La connexion passkey exécute l'assertion WebAuthn complète avant
d'émettre une session.

## Technical Context

**Language/Version**: TypeScript 5.9.3 ; Node.js 24 ; Loro CRDT 1.14.1 via
WebAssembly ; navigateurs définis par le canevas produit

**Primary Dependencies**: Fastify 5.7.4, `@fastify/websocket` 11.3.x, React
19.2, Vite 7.3, Dexie 4.2, PostgreSQL 18, Drizzle 0.45, Loro 1.14.1 ; API
WebSocket native du navigateur ; aucune bibliothèque cliente de collaboration,
aucun service hébergé

**Storage**: IndexedDB/Dexie pour projection, checkpoints, mises à jour,
frontières, branches et récupération historique, tous les payloads sensibles
chiffrés ; PostgreSQL pour journal opérationnel, séquences, frontières,
projections et révisions chiffrés ; aucune autorité durable dans le hub ou le
socket

**Testing**: Vitest et fast-check pour contrats, automate, retry, convergence et
migration ; tests d'intégration PostgreSQL avec interruptions de transaction ;
tests de contrat Fastify WebSocket et HTTP ; tests navigateur avec faux serveur
WebSocket ; Playwright multi-contextes sur cinq profils ; stack Compose derrière
le proxy Web officiel ; tests de sauvegarde/restauration et de performance

**Target Platform**: serveur Linux auto-hébergé ; client Web PWA responsive ;
Chrome/Edge, Firefox et Safari dans les versions du canevas ; déploiement
same-origin derrière un proxy HTTPS administrateur

**Project Type**: monorepo pnpm d'application Web local-first avec API Fastify,
client React, packages de contrats, client-core et page-state partagés

**Performance Goals**: changement distant visible en moins de 2 s au p95 ;
début de drainage en moins de 5 s au p95 après retour réseau ; lot courant
inférieur à 64 KiB et plafond existant de 1 MiB ; huit requêtes page au maximum
en vol par session ; rattrapage de 10 000 opérations par lots bornés

**Constraints**: un propriétaire, jusqu'à 10 appareils et plusieurs onglets ;
durabilité locale avant confirmation ; accusé serveur après commit ; aucune
perte silencieuse ; données chiffrées au repos ; aucun remplacement complet sur
le chemin normal ; origine exacte, session, CSRF et appareil autorisé ; pas de
nouveau conteneur ni fournisseur ; compatibilité pré-V1 rompable seulement avec
migration de données explicite

**Scale/Scope**: 100 000 pages, 1 000 000 blocs, pages de 500 blocs, 10 appareils,
10 000 mises à jour de retard par appareil, une connexion multiplexée par
instance active et plusieurs années de journaux compactés

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | IndexedDB chiffré reste l'autorité du non-confirmé ; l'édition hors ligne et le rattrapage long sont testés ; aucun service tiers ne détient le contenu | PASS |
| II. One Spec, Any Agent | Intention, décisions, modèle, contrats, migration et tâches vivent uniquement dans `specs/018-durable-realtime-sync` et référencent le canevas | PASS |
| III. Incremental, Verifiable Delivery | Contrats, serveur, client, migration et parcours sont des tranches indépendantes avec gates ciblés avant la CI complète | PASS |
| IV. Privacy and Security by Default | Cookie de session, origine exacte, CSRF dans le premier message, appareil autorisé, chiffrement existant, limites et logs expurgés sont obligatoires | PASS |
| V. Simple, Modular Architecture | Un plugin WebSocket dans l'API et l'interface de transport existante suffisent ; aucun service, broker, store ou moteur CRDT supplémentaire | PASS |
| VI. Accessible and Predictable Experience | Les états connexion/local/serveur/décision sont séparés ; aucun diagnostic n'est présenté comme conflit ; les erreurs restent actionnables | PASS |
| VII. Reproducible Toolchains | Une dépendance pnpm MIT verrouillée, TypeScript strict, tests, builds, Compose et sécurité restent dans les gates existants | PASS |
| VIII. Canonical Product Direction | La feature couvre la priorité synchronisation du canevas, préserve le mono-utilisateur multi-appareils et reporte explicitement la finition UI | PASS |

### Post-design re-check

- Le socket ne possède jamais de contenu durable ; perdre le processus ou la
  connexion ne change pas l'autorité locale ou serveur.
- `PageOperationService.sync()` reste l'unique écriture active du corps de page.
  HTTP et WebSocket sont deux adaptateurs vers ce même service, sélectionnés de
  façon exclusive pour un échange.
- L'annonce après commit ne remplace ni la frontière ni le rattrapage ; une
  annonce perdue est réparée au prochain cycle de reprise.
- Les octets historiques ne sont supprimés qu'après conversion durable ou
  décision explicite. Une erreur de migration laisse une récupération
  exportable.
- Le statut « synchronisé » dépend des files et confirmations durables, jamais
  de l'état ouvert d'un socket.
- Le déploiement conserve exactement les services Web, API et PostgreSQL déjà
  nécessaires. Aucun serveur Draw.io ou de collaboration n'est ajouté.

## Project Structure

### Documentation (this feature)

~~~text
specs/018-durable-realtime-sync/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── realtime-page-sync.md
│   ├── legacy-conflict-recovery.md
│   └── sync-status.md
├── checklists/
│   └── requirements.md
└── tasks.md
~~~

### Source Code (repository root)

~~~text
packages/contracts/src/
├── page-operations.ts
└── realtime-page-sync.ts

packages/client-core/src/
├── local-store/schema.ts
├── outbox/outbox.ts
└── page-sync/
    ├── page-reconciler.ts
    ├── legacy-conflict-recovery.ts
    └── encrypted-update-log.ts

apps/api/src/
├── app.ts
├── realtime/
│   ├── page-sync-hub.ts
│   ├── page-sync-session.ts
│   └── page-sync-limits.ts
├── routes/page-sync-socket.ts
├── page-state/
│   ├── page-operation-service.ts
│   ├── legacy-branch-service.ts
│   └── page-ambiguity-service.ts
└── security/realtime-authorization.ts

apps/web/src/
├── services/
│   ├── page-operations-api.ts
│   ├── realtime-page-sync-transport.ts
│   └── local-content.ts
├── features/sync/
│   ├── realtime-sync-lifecycle.ts
│   ├── use-realtime-sync.ts
│   └── use-page-reconciler.ts
└── components/sync-status.tsx

apps/api/tests/
packages/client-core/tests/
apps/web/tests/
tests/e2e/
tests/performance/

docker/web-nginx.conf
apps/web/vite.config.ts
docs/deployment/reverse-proxy.md
~~~

**Structure Decision**: Les contrats d'enveloppe sont partagés et sans
dépendance réseau. Le modèle et la file restent dans `client-core`. L'API
possède le hub éphémère et appelle les services transactionnels existants. Le
Web possède le socket natif, car `client-core` ne doit pas dépendre d'un global
navigateur. `LocalContentService` injecte ce transport dans les réconciliateurs
et demeure la frontière de cycle de vie de la base locale.

## Architecture and Delivery

### 1. Contrat et automate de session

Ajouter un protocole temps réel versionné, indépendant de la version
opérationnelle de page. Le premier message est obligatoirement `hello` et porte
le token CSRF uniquement en mémoire. Le serveur répond `ready` avec les limites
négociées. Les messages suivants sont corrélés par `requestId` : `sync`,
`sync-result`, `sync-problem`, `page-advanced`, `ping` et `pong`.

Les schémas TypeBox refusent les propriétés inconnues, tailles excessives,
identités incohérentes et messages hors état. Le payload `sync.request` réutilise
`PageSyncRequestSchema`; le résultat réutilise `PageSyncResponseSchema`. Il
n'existe donc pas de deuxième contrat fonctionnel pour le contenu.

### 2. Autorisation et hub serveur

Avant l'ouverture du canal, le client possède une identité de profil versionnée
dans le stockage d'origine. Elle contient un identifiant aléatoire non secret,
un nom affichable et une plateforme bornée ; elle ne contient ni credential,
clé, session, contenu ou capacité. Les onglets d'un profil la partagent et deux
profils ne la partagent pas. Le bootstrap enregistre cette même liaison au lieu
d'en inventer une côté serveur.

Après vérification d'un mot de passe ou d'une assertion passkey complète, une
transaction retrouve la ligne `(ownerId, deviceBindingId)`. Elle réutilise une
ligne active, fait passer `pending` ou `reauthorization-required` à `active`, ou
crée une ligne active avec un UUID serveur. Une ligne `revoked` est terminale
et refuse la connexion. Il n'existe plus de repli vers le premier appareil du
propriétaire. La session et le WebSocket héritent donc du véritable `deviceId`
du profil qui les a ouverts.

Enregistrer `@fastify/websocket` avant les routes. La route same-origin vérifie
l'en-tête `Origin` contre `MYOWNNOTION_PUBLIC_ORIGIN` et la session cookie avant
l'upgrade. Elle attache son gestionnaire de messages synchroniquement, puis
autorise le `hello` par token lié à la session et par inspection de l'appareil.

Le hub maintient uniquement des références de sockets autorisés et leur
`deviceId`. Il limite chaque session à huit requêtes en vol, ferme les clients
muets ou révoqués, et ne journalise aucun payload. Le gestionnaire appelle
`PageOperationService.sync()` ou `LegacyBranchService.convert()` comme la route
HTTP. Une réponse positive est sérialisée seulement après leur retour, donc
après la transaction. Le service publie alors un événement de page indépendant
de la réponse réseau ; le hub réveille toutes les sessions et chacune ignore
les séquences déjà dominées. Le changement global SSE continue de servir les
métadonnées du workspace pendant cette feature.

L'autorisation WebSocket avant message est une première barrière, pas la
frontière finale de révocation. Chaque écriture opérationnelle verrouille et
revalide l'appareil dans sa transaction PostgreSQL ; la révocation utilise le
même verrou. L'ordre de commit décide ainsi sans fenêtre où une révocation déjà
durable serait suivie par une nouvelle écriture de cet appareil.

### 3. Transport navigateur durable

Créer `RealtimePageSyncTransport` autour du WebSocket natif. Une instance par
`LocalContentService` multiplexe les pages, corrèle les promesses, applique un
timeout, un ping applicatif et une reconnexion exponentielle avec jitter et
plafond de cinq secondes. Un disconnect rejette les requêtes en vol comme
hors-ligne ; `PageReconciler` remet alors les lignes `sending` à `pending` à sa
prochaine possession du verrou.

Le transport ne mémorise pas d'opération au-delà de la requête en vol. Après
`ready`, reconnexion, `online`, `visibilitychange` ou annonce de page, il demande
à `LocalContentService` de drainer les files appropriées. Le client ignore les
annonces déjà dominées par sa séquence locale et coalesce les rafales par page.

`PageOperationsApi` reste disponible comme repli HTTP. Un échange choisit le
socket s'il est prêt, sinon le repli après une tentative bornée ; un même appel
n'est jamais lancé simultanément sur les deux transports. Les mêmes `updateId`
et `requestId` rendent une transition de transport idempotente.

### 4. Récupération des conflits historiques

Faire évoluer la base locale vers la version 9 avec un index de récupération
non sensible reliant un ancien `mutationId` à sa page et son état
`pending`, `converting`, `quarantined` ou `converted`. Le payload historique
reste dans l'enveloppe chiffrée `conflicts` jusqu'à conversion.

Après déverrouillage, classer les conflits `page.document.replace` :

1. si l'opération est déjà reflétée dans une projection opérationnelle, marquer
   la récupération convertie et retirer l'ancien conflit dans une transaction ;
2. si base, document local et lignée distante sont lisibles, dériver des
   commandes sémantiques stables, créer une branche locale chiffrée puis utiliser
   le convertisseur serveur existant ;
3. après installation atomique du checkpoint converti, supprimer le conflit et
   marquer la récupération convertie dans la même transaction ;
4. si une preuve manque ou le payload est invalide, conserver le conflit,
   marquer `quarantined` avec un code sûr et offrir lecture/export depuis les
   diagnostics.

Plusieurs conflits d'une page sont traités dans l'ordre `capturedAt` puis
`mutationId`; chaque conversion repart de la frontière durable obtenue par la
précédente. Le processus est relançable après crash à chaque étape.

### 5. Statut utilisateur honnête

Remplacer l'état agrégé actuel par une dérivation explicite :

- `saved-local` si les gestes sont durables localement mais non confirmés ;
- `syncing` si au moins un lot est en vol ou un rattrapage actif ;
- `synced` seulement si toutes les files et pièces jointes sont confirmées ;
- `needs-attention` uniquement pour ambiguïtés ou quarantaines actives ;
- `local-save-failed` si le stockage local a refusé le geste.

L'état de connexion (`connecting`, `live`, `local`, `revoked`, `needs-update`)
reste orthogonal. `storagePersisted === false` quitte la bannière de conflit et
devient un avertissement neutre des diagnostics. Les conflits historiques en
cours de conversion n'augmentent pas le compteur de décisions.

### 6. Proxy, arrêt et exploitation

Activer l'upgrade WebSocket sur `/v1/page-sync/socket` dans Vite et nginx,
transmettre `Upgrade` et `Connection`, désactiver le buffering et régler un
timeout supérieur au heartbeat. Documenter la configuration équivalente du
proxy HTTPS administrateur. À l'arrêt Fastify, fermer le hub, rejeter les
requêtes en vol et laisser les clients reprendre ailleurs.

Les logs structurés portent identifiant de corrélation, appareil, type de
message, taille, durée et code sûr ; ils excluent document, update, vecteur,
ciphertext, token et clé. Les métriques restent des compteurs et histogrammes
bornés sans identifiant de page en label.

### 7. Validation par preuves de panne

Construire les tests du bas vers le haut : schémas et automate, idempotence du
service, hub, transport avec faux socket, migration Dexie, puis deux vrais
contextes Playwright. Les scénarios injectent les coupures avant et après chaque
frontière durable, une réponse perdue, un serveur redémarré, un appareil révoqué,
un proxy qui coupe l'inactivité, une ancienne base locale et 10 000 mises à jour.

Les propriétés Loro de la 017 sont conservées et étendues à mille permutations.
La matrice navigateur ne lance pas cinq stacks simultanées sur une machine
faible : chaque profil reçoit son stack isolée et la CI limite les workers selon
`docs/development.md`, tandis que les familles indépendantes restent parallèles.

## Migration and Rollback

- Aucune migration PostgreSQL n'est prévue : le journal, les frontières,
  checkpoints, projections, révisions et contrainte unique d'identité
  d'appareil nécessaires existent déjà. Si l'implémentation révèle une donnée
  durable manquante, elle sera ajoutée par une migration additive avant le code
  qui la lit.
- Dexie passe de 8 à 9 en ajoutant uniquement la table de routage des
  récupérations historiques. L'ouverture de la base ne déchiffre ni ne supprime
  aucun contenu ; la conversion s'exécute après disponibilité de la clé locale.
- Le transport HTTP permet un rollback applicatif borné tant que le protocole
  opérationnel reste compatible. Les lignes v9 supplémentaires sont ignorables
  par une version qui connaît le schéma, mais une ancienne application ne doit
  pas être réinstallée sur la même base après migration sans export préalable.
- Désactiver le socket ne réécrit aucune donnée : la file IndexedDB reprend par
  HTTP. Une mise à jour acceptée avant rollback conserve le même identifiant et
  le même format opérationnel.
- Les fixtures de sauvegarde et restauration prouvent que le serveur restauré
  contient encore tout ce qui permet aux clients d'établir leur frontière ou de
  conserver une branche récupérable.

## Complexity Tracking

Aucune violation constitutionnelle. Le hub WebSocket et la table locale de
récupération sont la complexité minimale nécessaire : le premier réduit la
latence sans devenir une autorité, la seconde permet de distinguer une ancienne
preuve conservée d'une décision utilisateur active sans jeter les octets.
