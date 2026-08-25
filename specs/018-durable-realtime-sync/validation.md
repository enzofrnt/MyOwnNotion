# Validation — Synchronisation éditoriale temps réel durable

Ce journal conserve les preuves reproductibles de la feature 018. Les matrices
hors ligne, panne, migration, sécurité et navigateurs restent ouvertes tant que
leurs tâches correspondantes ne sont pas cochées dans `tasks.md`.

## US1 — Propagation connectée

Date : 2026-08-25

Environnement : Chromium desktop local, API et Web Vite isolés, PostgreSQL
jetable migré jusqu'à la migration 0011, deux contextes navigateur indépendants,
un seul worker afin de ne pas masquer les mesures par la contention machine.

Parcours : deux appareils ouvrent la même page puis alternent une insertion de
texte, une marque de gras et un déplacement de bloc. Chaque mesure commence au
geste utilisateur et s'arrête lorsque l'autre appareil expose le résultat.

- Répétitions : 5/5 réussies.
- Échantillons (ms) : `402, 365, 356, 385, 396, 325, 381, 395, 318, 403, 360, 344, 402, 394, 309`.
- p50 : 381 ms.
- p95 (rang supérieur) : 403 ms.
- Maximum : 403 ms, sous le budget produit de 2 000 ms.
- Remplacements complets `page.document.replace` observés pendant les gestes : 0.
- Conflits visibles : 0.
- Les deux blocs frères restent présents après adoption distante et après la
  mise en forme locale.

Commande de mesure :

```bash
pnpm exec playwright test tests/e2e/realtime-page-sync.spec.ts \
  --project=chromium-desktop --workers=1 --retries=0 --repeat-each=5
```

Contrôles ciblés complémentaires :

- 25/25 contrats et tests unitaires du protocole, notifier, transport et
  intégration locale réussis.
- 38/38 régressions éditeur/session réussies.
- 32/32 contrôles de sélection des tests réussis.
- Typecheck Web réussi.

## US2 — Convergence hors ligne et long rattrapage

Date : 2026-08-25

Les propriétés exécutent 1 000 suites aléatoires du moteur multi-appareils,
complétées par 300 cas focalisés : 100 move+edit, 100 déplacements concurrents
et 100 delete+edit. Les permutations de livraison, duplications, marques,
imbrications et ordres de réception convergent au même digest. Une
suppression concurrente à une édition reste une ambiguïté récupérable au lieu
de perdre l'une des intentions.

La matrice navigateur couvre :

- le même paragraphe modifié hors ligne puis reconnecté dans les deux ordres ;
- un bloc déplacé d'un côté et édité de l'autre ;
- deux déplacements indépendants et concurrents, sans perte ni doublon ;
- une page fermée dont la file durable repart au prochain lancement sans
  rouvrir cette page ;
- une suppression contre édition, conservée après redémarrage puis restaurée
  explicitement sur les deux appareils.

Le parcours delete/edit a révélé puis verrouillé une rupture du nouveau
transport : le WebSocket recevait le résumé d'ambiguïté, mais ne déléguait pas
son détail protégé au endpoint HTTP. Le navigateur gardait alors deux updates
bloquées indéfiniment. Le contrat est désormais délégué explicitement et le
parcours complet réussit.

Rattrapage long : un appareil absent 90 jours importe 10 000 updates par lots
de 64 au maximum, reprend après interruption, publie sa propre modification et
termine sans doublon. Le test d'intégration a réussi en 128,6 s.

Confort d'édition pendant adoption distante : 14/14 tests vérifient notamment
l'absence de vol de focus, la conservation du curseur mappé et la restauration
du scroll par UUID de bloc visible plutôt que par pixel brut.

Exécution groupée finale : 37/37 tests unitaires/propriétés et 5/5 journeys
Chromium réussis, sans retry. Les 1 000 seeds aléatoires et les 300 cas
focalisés ont tous convergé.

## État des matrices

- US2 : validée.
- US3 : validée.
- US4 : validée.
- US5 : validée.
- Navigateurs desktop/mobile : matrice ciblée puis matrice complète validées sur
  les cinq profils.
- Proxy HTTPS : quickstart jetable en images de production validé.

## US3 — Coupures, réponse perdue et redémarrage

Date : 2026-08-25

La matrice locale couvre les frontières avant/après écriture de l'update,
frontière locale, checkpoint, projection et transaction IndexedDB. Elle couvre
aussi la fermeture après commit, la reprise d'une ligne `sending`, un échec de
scellement local après réponse serveur et le renvoi du même `updateId` après
une réponse perdue. Aucun cas ne supprime la ligne durable avant confirmation.

Le transport couvre :

- socket silencieuse et demi-connexion détectées à 60 s des deux côtés ;
- heartbeat applicatif qui prolonge correctement la session vivante ;
- fermeture de toutes les promesses en vol comme `offline`, sans possession de
  la file IndexedDB ;
- reconnexion exponentielle full-jitter et réveil immédiat par
  `online`/visibilité ;
- chemin exclusif WebSocket ou HTTP pour une invocation ;
- arrêt serveur avec code 1001, hub vidé, timers libérés et reprise client ;
- métriques à dimensions finies et journaux corrélables ne recevant ni page,
  update, vecteur, ciphertext, cookie, CSRF, session ni clé.

Journey Chromium : la réponse `sync-result` est retirée après le commit réel,
la ligne reste `sending`, l'onglet propriétaire est tué et un second onglet
réutilisant la même IndexedDB renvoie le même identifiant. Le serveur répond
comme update répétée, le texte converge et aucun `page.document.replace` n'est
émis. Résultat : 1/1 en 4,4 s sans retry.

Exécution groupée :

- 47/47 tests de durabilité, réconciliation et états page ;
- 32/32 tests transport, serveur, cycle de vie et sérialisation ;
- 32/32 contrôles de sélection CI ;
- 1/1 journey de crash Chromium ;
- typechecks API, Web et Domain réussis.

Résultat : zéro perte, zéro double application, zéro faux ACK et reprise sans
bouton sur toutes les frontières injectées.

## US4 — Auto-réparation des profils historiques

Date : 2026-08-25

Les profils Dexie 1 à 8 sont construits avec de vrais payloads AES-256-GCM
déterministes réservés aux tests. Chaque profil contient une page, une file
locale et au moins un conflit de remplacement complet ; le profil v8 en
contient cinq et les stores v6 à v8 portent aussi leurs formes structurées et
opérationnelles. Les huit migrations vers v9 conservent chaque ciphertext et
chaque store, n'ouvrent aucun contenu pendant l'upgrade, ajoutent uniquement
les index de routage sans contenu, puis rouvrent les conflits avec le codec de
production. Les deux générations successives des fixtures sont identiques
octet pour octet et aucune phrase privée n'apparaît dans IndexedDB.

Le convertisseur sémantique rejoue exactement 100 combinaisons de texte,
marques, insertions, déplacements, imbrications et suppressions. Le digest
canonique du replay égale toujours celui du brouillon historique. Une
transformation de table qui ne peut pas être prouvée échoue fermée et rejoint
la quarantaine sans altérer la source.

L'automate de récupération couvre :

- classification d'un conflit scellé sans le compter comme décision active ;
- ordre déterministe de plusieurs brouillons pour une même page ;
- concurrence entre deux onglets sans branche dupliquée ;
- ancêtre temporairement inaccessible conservé en attente ;
- schéma non prouvable et payload illisible conservés et exportables ;
- nettoyage terminal repris seulement avec branche convertie et checkpoint
  actif ;
- six injections avant/après chiffrement, écriture d'état, marqueur de branche,
  routage de récupération et commit, sans état intermédiaire observable.

Exécution groupée : 36/36 tests réussis sur six fichiers. Elle comprend 10
tests de fixtures/migration, 10 tests d'automate, 6 tests d'atomicité, 2 tests
de diff/propriété, 4 tests de statut/export et 4 tests d'intégration du service
Web. Les 33/33 contrats de sélection CI réussissent et attachent désormais
explicitement cette preuve au schéma local ainsi qu'au journey Playwright.

Journey Chromium : une ancienne IndexedDB reçoit cinq conflits complets pendant
une coupure, sans aucune ligne de routage v9, et le navigateur refuse la
permission de stockage persistant. Après rechargement, les cinq brouillons sont
convertis en branches opérationnelles, envoyés et intégrés exactement sur le
serveur. Résultat : 1/1 en 6,8 s, zéro conflit retenu ou actif, cinq récupérations
`converted`, cinq états actifs, et un avertissement de stockage neutre sans le
mot « conflit ».

Résultat : un ancien brouillon n'est jamais écrasé ni jeté. Il est soit prouvé
et intégré automatiquement, soit conservé chiffré dans une quarantaine
exportable ; le refus de stockage persistant ne pollue plus le statut de
synchronisation.

## US5 — Sécurité, fichiers, proxy et restauration

Date : 2026-08-25

Le canal refuse avant tout contenu une origine différente, une session absente,
un CSRF incorrect et une version obsolète. Les frames sont limitées à 2 MiB,
la session à huit requêtes, une requête par page et une fréquence glissante
bornée. Les doublons corrélés et les dépassements ferment avec un code stable,
sans retirer la mise à jour de la file locale.

La révocation et les écritures utilisent le même verrou PostgreSQL sur
l'appareil. Une écriture déjà autorisée termine avant la révocation ; aucune
nouvelle écriture ne peut passer ensuite. Tous les sockets de l'appareil exact
sont fermés immédiatement et le heartbeat refuse aussi une session devenue
révoquée.

Les fichiers ne sont plus annoncés synchronisés sur la seule acceptation du
document. L'UUID placé dans le bloc est conservé jusqu'au fichier serveur
vérifié. La reprise compare le décalage SQL aux octets réellement présents,
répare une panne entre append et commit dans les deux directions, finalise les
fichiers vides et reconnaît un fichier déjà commité lorsque la réponse finale a
été perdue. Le compteur distingue opérations documentaires et octets restant à
transférer.

La restauration conserve checkpoints, updates, frontières d'appareils,
ambiguïtés et conversions. Le test d'intégration garde un appareil autorisé
absent 90 jours ; après restauration, sa branche locale plus récente est
acceptée une fois, converge et ne réintroduit pas le contenu serveur postérieur
à la sauvegarde. Le journey navigateur exécute une vraie sauvegarde et une vraie
restauration via l'outil d'administration pendant qu'un appareil travaille hors
ligne.

Ce journey a exposé un défaut cryptographique réel : le cache mémoire d'une clé
de données était indexé uniquement par numéro de génération. Une base remplacée
avec une nouvelle « génération 1 » pouvait donc recevoir des enveloppes écrites
avec l'ancienne clé en RAM. Le cache est désormais lié à l'identité et au wrap
persistés ; un second processus ouvre correctement les données après reset ou
restore.

Exécution groupée parallèle :

- API/sécurité/backup : 63/63 tests sur neuf fichiers ;
- Web/statut/fichiers : 31/31 tests sur cinq fichiers ;
- proxy/Compose/sélection CI : 59/59 tests sur trois fichiers ;
- performance temps réel : 3/3 budgets ;
- journey Chromium révocation, reconnexion proxy et restauration : 3/3 sans
  retry.

Mesures de référence sans instrumentation : handshake p95 0,07 ms, corrélation
client p95 0,05 ms, 10 000 annonces coalescées en 24,3 ms avec 4,9 MiB de
croissance heap. La propagation utilisateur reste mesurée à 381 ms p50 et
403 ms p95 dans US1, sous le budget de 2 s.

Résultat : aucune autorité supplémentaire n'est créée par le WebSocket, aucun
contenu propriétaire n'entre dans les annonces ou logs, une révocation est
immédiate et une restauration n'écrase pas un travail local plus récent.

## Matrice transversale ciblée

Date : 2026-08-25

Quatre familles ont été lancées en parallèle avec PostgreSQL jetable et sans
couverture instrumentée pour les budgets :

```bash
pnpm exec vitest run --project contracts --project page-state \
  --project client-core --project web <tests 018 ciblés>
pnpm exec vitest run --project api-contract <tests 018 API/sécurité/backup>
pnpm exec vitest run --project database-integration \
  --project workspace-contract <migrations et contrats 018>
pnpm exec vitest run --project performance \
  tests/performance/realtime-page-sync.performance.spec.ts \
  tests/performance/page-operations.perf.spec.ts
```

Résultats finaux : 120/120 logique cliente/CRDT/Web/contrats, 72/72
API-sécurité-backup dont 10 000 updates après 90 jours, 93/93
base-migrations-contrats et 4/4 performance, soit 289 tests réussis. Le premier
passage a détecté l'assertion exhaustive qui omettait le code WebSocket standard
`1009`; le contrat a été complété puis repassé 9/9. Aucun comportement n'a été
désactivé ni relâché.

Mesure lourde 10 000 updates : ingestion 14,6 s, rattrapage 14,4 s en 157 lots,
compaction 11,3 s, batch p95 96,4 ms et croissance heap maximale 126 MiB — tous
dans les budgets de la machine de référence.

## Attribution multi-appareils et connexion passkey

Date : 2026-08-25

Le premier quickstart en images de production a invalidé sa propre précondition :
deux profils possédaient bien deux IndexedDB et deux sessions, mais PostgreSQL
ne contenait qu'une ligne `authorized_devices` et les deux sessions portaient
le même `device_id`. L'authentification choisissait le premier appareil actif du
propriétaire. Le même parcours a montré que le bouton passkey obtenait seulement
un challenge et restait sur « Waiting for your device… » sans jamais appeler
`navigator.credentials.get` ni transmettre d'assertion.

La correction introduit une identité de profil locale non secrète, stable entre
onglets et distincte entre profils. Bootstrap, mot de passe et passkey la
présentent après preuve du propriétaire. Le serveur la résout
transactionnellement : création pour un nouveau profil, réutilisation pour le
même, retour à `active` après `reauthorization-required`, refus terminal après
`revoked`, et aucun repli vers une autre ligne active. La connexion passkey
exécute désormais l'assertion WebAuthn complète.

Preuves ciblées :

- identité navigateur et assertion : 6/6 tests Web ;
- repository d'appareils : 18/18, dont deux profils, réutilisation,
  réautorisation et révocation terminale ;
- contrats bootstrap/authentification : 87/87 ;
- contrat OpenAPI/TypeBox : 30/30 ;
- typecheck complet du monorepo : réussi ;
- Chromium : 2/2 journeys, avec retour par la passkey sur le `deviceId` du
  bootstrap et deux contextes isolés recevant deux `deviceId` puis réutilisant
  chacun le sien.

Commandes principales :

```bash
pnpm exec vitest run --project web \
  apps/web/tests/browser-device-identity.spec.ts \
  apps/web/tests/passkey-client.spec.ts
pnpm exec vitest run --project database-integration \
  packages/database/tests/security-devices.integration.spec.ts
pnpm exec vitest run --project api-contract \
  apps/api/tests/authentication.contract.spec.ts \
  apps/api/tests/bootstrap.contract.spec.ts
pnpm exec playwright test tests/e2e/bootstrap.spec.ts \
  tests/e2e/authentication.spec.ts --project=chromium-desktop --workers=1 \
  --retries=0 --grep 'bootstrap passkey|two isolated profiles'
pnpm typecheck
```

## Quickstart HTTPS en images de production

Date : 2026-08-25

Une stack jetable entièrement neuve a été construite depuis la branche avec les
images `myownnotion/api:018-quickstart` et `myownnotion/web:018-quickstart`, un
PostgreSQL et des volumes propres, puis placée derrière Caddy sur
`https://localhost:8444`. Le proxy est resté externe au Compose officiel. Le
healthcheck initial prouvait `generation=1`, `indexedCount=0` et
`expectedCount=0`. Aucun conteneur Draw.io ou collaboratif n'était présent.

Le profil A a exécuté le bootstrap passkey complet, téléchargé le kit de
récupération et reçu un cookie `__Host-mn_session` `Secure`, `HttpOnly` et
`SameSite=Strict`. Un mot de passe de test a ensuite été ajouté uniquement dans
la base jetable afin d'ouvrir le profil B sans partager la passkey virtuelle.
Les deux profils Chromium persistants avaient leurs propres cookies,
IndexedDB et identités d'appareil.

Résultat final du parcours :

```json
{
  "secureContext": true,
  "passkeys": true,
  "profiles": 2,
  "authorizedDevices": 2,
  "sessionDeviceIds": 2,
  "sameParagraphOffline": "converged",
  "abruptCloseRecovery": "converged",
  "idlePropagationMs": 311,
  "webRestart": "reconnected-and-drained",
  "apiRestart": "reconnected-and-drained"
}
```

La base finale contenait un propriétaire, deux appareils actifs, deux sessions
actives attribuées à deux appareils distincts, treize mises à jour
opérationnelles, un état de page et zéro ambiguïté. A et B ont convergé vers
`Hello brave world! idle-ok web-restart-ok api-restart-ok` après : modification
concurrente du même paragraphe hors ligne, fermeture brutale de A, reconnexion
dans l'autre ordre, 78 secondes d'inactivité, arrêt/reprise de nginx puis arrêt/
reprise de l'API. Aucun reload, remplacement de document ou choix manuel n'a été
nécessaire.

## Matrice navigateur finale

Date : 2026-08-25

La première exécution multi-moteurs du déplacement hors ligne a révélé une
frontière navigateur réelle : Firefox et WebKit pouvaient conserver un
WebSocket déjà établi après que Playwright avait coupé le réseau du contexte.
`navigator.onLine` et le statut de l'éditeur disaient « hors ligne », mais le
socket partagé pouvait encore transmettre ou recevoir une opération. Le
transport possède désormais un état réseau explicite : l'événement `offline`
annule immédiatement timers et promesses en vol, détache et ferme le socket et
interdit tout échange/reconnect ; `online` le réveille et relance le drain. Les
tests unitaires du transport et du cycle de vie verrouillent cette coupure.

Le scénario critique de déplacement concurrent a ensuite réussi deux fois sur
chacun des cinq profils, soit 10/10 sans perte. La matrice finale a exécuté les
cinq journeys les plus risqués : propagation temps réel, convergence
multi-appareils, reprise multi-onglets après crash, auto-réparation historique,
révocation/proxy/restauration.

```bash
pnpm test:e2e:local -- \
  tests/e2e/realtime-page-sync.spec.ts \
  tests/e2e/page-multi-device-convergence.spec.ts \
  tests/e2e/page-multi-tab-convergence.spec.ts \
  tests/e2e/legacy-sync-self-healing.spec.ts \
  tests/e2e/realtime-sync-security-and-restore.spec.ts
```

Résultat : 5/5 projets en 141 s, sans retry — Chromium desktop, Chromium
mobile, Firefox desktop, WebKit desktop et WebKit mobile. Chaque profil a reçu
sa base et ses ports isolés ; deux profils seulement ont tourné simultanément
afin de rester compatible avec un runner GitHub peu doté.

## Gate local complet pré-push

Date : 2026-08-25

Commit exécutable testé :
`0ae794052530d849bf059f0fbabaab08abcbd730`.

Commande :

```bash
pnpm checks:local
```

Le binaire officiel `shfmt` v3.12.0 exigé par le dépôt a été placé
temporairement en tête du `PATH`, sans modifier le dépôt ni l'installation
système ; le runtime hôte proposait une version plus récente que celle épinglée.

Résultat : code de sortie 0 sur la chaîne complète définie dans
`docs/development.md`.

- toolchain, shell, format, lint et typecheck : réussis ;
- couverture : 285/285 fichiers et 3 050/3 050 tests, 90,12 % de lignes,
  85,05 % de branches et 93,44 % de fonctions ;
- performance : 18/18 tests, dont 10 000 updates opérationnelles avec batch p95
  95,5 ms et 10 100 commits de base structurée avec p95 22,8 ms ;
- intégration : 33/33 fichiers et 329/329 tests ; migrations : 10/10 ;
- contrats : 101/101 fichiers et 1 192/1 192 tests, dont l'appareil absent
  90 jours et 10 000 updates ;
- E2E complète : 5/5 profils en 1 325 s — Chromium desktop/mobile, Firefox
  desktop, WebKit desktop/mobile — deux profils simultanés, bases, ports et
  fichiers isolés, aucun gate relâché ;
- builds de production Web/API : réussis ; images API et Web construites pour
  `linux/amd64` et `linux/arm64`, smoke du runtime API empaqueté réussi ;
- audit de production au seuil `high` : réussi avec une vulnérabilité modérée
  signalée ; scans de secrets et analyse statique : zéro finding ; licences :
  zéro violation ;
- contrat Compose : services, ports loopback, secrets, images et upgrade
  WebSocket validés, sans service Draw.io ou serveur collaboratif.

Le commit ci-dessus est donc la preuve immuable de l'arbre exécutable. Les
changements qui consignent ce résultat et ferment T101 sont exclusivement
documentaires.

## Corrections CI et gate final sur le commit proposé

Date : 2026-08-25

La première exécution GitHub Actions de la PR 141, run
[`32866208877`](https://github.com/enzofrnt/MyOwnNotion/actions/runs/32866208877)
sur le merge synthétique `08b11d802c3c87bf1f7af56aafb2afd16656f63f`,
a révélé deux différences propres au runner contraint sans invalider les
comportements testés :

- la propriété `legacy-document-diff.property.spec.ts` conservait ses 100 cas,
  mais héritait du timeout générique de 5 s ; elle possède désormais un budget
  explicite de 30 s et réussit ses 2 tests en 1,29 s localement ;
- la fixture WebKit d'auto-réparation supposait que `navigator.storage`
  existait avant de simuler un refus de persistance ; elle installe désormais
  l'objet minimal lorsque le moteur ne le fournit pas. Le journey historique
  réussit sur les cinq profils en 27 s dans la matrice ciblée.

Le gate complet suivant a ensuite découvert une vraie course éditeur dans
`rich-page.spec.ts` : BlockNote pouvait regrouper une saisie dont le
`prevBlock` contenait déjà le premier caractère alors que l'autorité
opérationnelle ne le contenait pas encore. Le delta persistait alors uniquement
le suffixe et un rechargement durable transformait par exemple
`Information` en `nformation`. Les changements BlockNote sont désormais
réancrés sur le snapshot opérationnel autoritaire avant leur traduction, y
compris pour des changements séquentiels ou imbriqués du même lot.

Preuves ciblées de cette correction :

- 24/24 tests d'adaptation et de saisie éditeur ;
- 50/50 fichiers Web et 309/309 tests ;
- 25/25 exécutions navigateur valides et isolées de `rich-page.spec.ts`, soit
  cinq profils réussis puis quatre nouvelles matrices indépendantes ;
- aucun résultat issu de répétitions partageant la même base n'a été retenu
  comme preuve.

Commit exécutable final testé :
`44093d67510be93d45644c5229601ee308c06a47`
(`fix(editor): preserve coalesced input prefixes`).

Commande :

```bash
env PATH="/tmp/myownnotion-pinned-tools.r7yez3:$PATH" pnpm checks:local
```

Le répertoire temporaire contient uniquement le binaire officiel `shfmt`
v3.12.0 exigé par le dépôt. Aucun fichier du dépôt, outil système ou service de
test utilisateur n'a été remplacé.

Résultat final : code de sortie 0 sur l'intégralité du gate pré-push.

- toolchain, shell, format, lint et typecheck : réussis ;
- couverture : 285/285 fichiers et 3 052/3 052 tests, 90,13 % de lignes,
  85,05 % de branches et 93,44 % de fonctions ;
- performance : 18/18 tests, dont 10 000 updates opérationnelles avec batch
  p95 114,2 ms, rattrapage en 157 lots et croissance heap maximale 135,2 MiB ;
- intégration PostgreSQL : 33/33 fichiers et 329/329 tests ; migrations :
  10/10 ;
- contrats API et dépôt : 101/101 fichiers et 1 192/1 192 tests, dont
  convergence après 90 jours et 10 000 changements distants ;
- E2E complète : 5/5 profils en 1 431 s — Chromium desktop/mobile, Firefox
  desktop, WebKit desktop/mobile — deux profils simultanés et chaque profil sur
  sa propre base ;
- builds Web/API : réussis ; images API et Web construites avec SBOM pour
  `linux/amd64` et `linux/arm64`, puis runtime API empaqueté validé ;
- audit production au seuil `high` : aucune vulnérabilité haute ou critique,
  une vulnérabilité modérée signalée ; secrets et analyse statique : zéro
  finding ; licences : zéro violation ;
- contrat Compose : services, ports loopback, secrets, images et upgrade
  WebSocket validés, sans Draw.io ni serveur collaboratif.

Ce commit est l'arbre exécutable exact qui sera poussé. Le présent ajout est
strictement documentaire et ne modifie pas cette preuve.
