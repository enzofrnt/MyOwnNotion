# Validation — Feature 017

Dernière mise à jour : 2026-08-26
Tranches validées : US3, US5, synchronisation éditoriale convergente et migration v2 ; frontière workspace/réglages T182/T222

Ce document consigne les preuves exécutées. Il ne remplace ni les critères de
`spec.md`, ni les tâches encore ouvertes dans `tasks.md`, ni le gate avant push
de `docs/development.md`.

## Résultat de la tranche US5

Les scénarios centraux du quickstart sont verts :

- deux appareils réellement hors ligne modifient le même paragraphe, déplacent
  un bloc et ajoutent un voisin ; les deux ordres de reconnexion convergent vers
  les mêmes textes, UUID et ordre ;
- l'appareil qui se reconnecte en dernier peut être fermé brutalement puis
  rouvert depuis IndexedDB sans perdre son journal local ;
- delete contre edit crée une ambiguïté durable, survit au redémarrage, expose
  la totalité du contenu récupérable et se résout sans rechargement des autres
  appareils ;
- une mutation v2 `page.document.replace` déjà durable dans l'outbox est
  acquittée avant la conversion de sa branche sémantique ; ancienne et nouvelle
  écritures survivent, la bascule locale est atomique et tout remplacement
  complet ultérieur est refusé ;
- une page ouverte pour la première fois en ligne draine d'abord sa création,
  active directement la tête canonique vérifiée puis n'émet que des updates
  opérationnelles ; aucune branche legacy ni requête de remplacement complet
  n'existe dans ce parcours normal ;
- le statut « synchronisé » n'est atteint qu'après confirmation de la frontier
  serveur et adoption de l'état durable par la session ouverte.
- une page active modifiée hors ligne reste découvrable après fermeture du
  navigateur ; au redémarrage sur une autre page, sa file chiffrée est drainée
  sans rouvrir l'éditeur et le statut global reste honnête jusqu'à l'acquittement.
- deux onglets d'une même origine voient leurs commits durables sans rechargement,
  convergent après des éditions simultanées du même paragraphe et reprennent le
  même lot idempotent si l'onglet propriétaire ferme pendant son envoi.

## Commandes et résultats

| Couche | Commande | Résultat |
| --- | --- | --- |
| Modèle opérationnel | `pnpm exec vitest run --project page-state` | 9 fichiers, 90 tests passés |
| Stockage et session locale | `pnpm exec vitest run --project client-core` | 29 fichiers, 270 tests passés |
| Adaptateur et intégration web | `pnpm exec vitest run --project web` | 42 fichiers, 249 tests passés |
| API, migration, backup, rétention | `pnpm exec vitest run --project api-contract apps/api/tests/page-operation*.spec.ts apps/api/tests/page-history-consolidation.integration.spec.ts` | 8 fichiers, 53 tests passés |
| SQL et migrations | `pnpm exec vitest run --project database-integration packages/database/tests/page-operations.integration.spec.ts packages/database/tests/migrations.integration.spec.ts packages/database/tests/reference-backups.integration.spec.ts` | 3 fichiers, 17 tests passés |
| Sélection CI | `pnpm exec vitest run tests/contract/test-impact.spec.ts` | 1 fichier, 32 tests passés |
| Deux appareils hors ligne | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-multi-device-convergence.spec.ts` | 5 profils passés |
| Delete/edit récupérable | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-ambiguity.spec.ts` | 5 profils passés |
| Activation directe et mutation v2 en attente | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-protocol-migration.spec.ts` | 2 scénarios × 5 profils passés ; activation avant frappe, aucun PUT complet, migration v2 conservatrice |
| Ouverture opérationnelle locale | `pnpm exec vitest run --project web tests/operational-page-opening.spec.ts` | 1 fichier, 7 tests passés ; création en vol, tête stale, épuisement borné sans fausse branche, page absente, perte réseau et vrai hors-ligne |
| Confirmation de frontier sans boucle | `pnpm exec vitest run --project client-core packages/client-core/tests/page-reconciler.property.spec.ts` | 1 fichier, 14 tests passés ; une seconde confirmation vide ne republie pas la page durable |
| Conversion d'une page activée intacte | Tests ciblés domaine, client-core et database-integration | 3 fichiers, 60 tests passés ; même règle partagée côté domaine, Dexie et PostgreSQL |
| Régressions activation et conversion | Matrice ciblée `page-protocol-migration`, `workspace-shell`, `item-conversion`, `page-links` et `block-editor` avec `MYOWNNOTION_E2E_JOBS=5` | 5 scénarios × 5 profils, 25/25 passés en parallèle |
| Régressions synchronisation croisées | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-autosave-recovery.spec.ts tests/e2e/page-ambiguity.spec.ts tests/e2e/page-multi-device-convergence.spec.ts tests/e2e/live-sync.spec.ts tests/e2e/databases-offline-sync.spec.ts` | 11 scénarios × 5 profils, 55/55 passés en parallèle |
| Brouillon structuré sous projection concurrente | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/databases-views.spec.ts --repeat-each=5` | 25/25 exécutions passées, cinq par profil |
| Convergence générée | `pnpm exec vitest run --project page-state tests/checkpoints.property.spec.ts tests/multi-device-convergence.property.spec.ts` | 2 fichiers, 23 tests passés, dont 10 rejeux de rollover et 1 000 suites ; seed par défaut `170191` |
| Routage local des pages fermées | `pnpm exec vitest run --project client-core packages/client-core/tests/page-operation-schema.spec.ts packages/client-core/tests/page-operation-encryption.spec.ts` | 2 fichiers, 9 tests passés ; migration v7 vers v8, contenu chiffré préservé, identités dédupliquées sans ouverture des enveloppes |
| Ordonnancement au démarrage | `pnpm exec vitest run --project web apps/web/tests/synchronize-serialization.spec.ts` | 1 fichier, 10 tests passés ; reprise sans éditeur, attente du drain coalescé, statut global honnête et plafond de 4 échanges de pages |
| Coordination inter-contexte | matrice Vitest ciblée `cross-context-coordinator`, `page-operation-atomicity`, `page-editing-session`, `page-reconciler.property` et `page-tab-channel` | 5 fichiers, 54 tests passés ; deux handles Dexie, verrou exclusif, même paragraphe, propriétaire interrompu, adoption durable et absence de vol d'un envoi vivant |
| Service web inter-onglets | matrice Vitest ciblée `operational-page-opening` et `synchronize-serialization` | 2 fichiers, 19 tests passés ; canal réel partagé, notification après commit, session ouverte rafraîchie et drainage coalescé |
| Deux onglets et propriétaire interrompu | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-multi-tab-convergence.spec.ts` | 1 scénario × 5 profils, 5/5 passés en 35 s ; convergence sans rechargement, fermeture pendant `sending`, reprise automatique du même ID et aucune mutation `page.document.replace` |
| Redémarrage sur une autre page | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/page-multi-device-convergence.spec.ts --grep "a restarted device drains a closed page without reopening it"` | 5 profils passés ; fermeture hors ligne, nouveau contexte navigateur, aucune réouverture du document modifié |
| Longue absence | `pnpm exec vitest run --project api-contract tests/page-operation-long-absence.integration.spec.ts` | 1 scénario passé : 90 jours, 10 000 updates distantes puis 1 locale, durée 150,55 s |
| Performance de synchronisation | `pnpm exec vitest run --project performance tests/performance/page-operations.perf.spec.ts` | 10 000 updates puis 1 locale : ingestion 15,27 s, catch-up 15,20 s en 157 échanges, compaction 11,88 s, pic de heap 99,0 MiB |
| Suite de performance sous contention | `pnpm test:performance` | 6 fichiers, 15 tests passés ; catch-up 16,48 s et pic de heap 128,7 MiB pendant les autres benchmarks parallèles |
| Curseur causal et service API | `pnpm exec vitest run --project api-contract apps/api/tests/page-operation-service.integration.spec.ts` | 5 tests passés ; un curseur numérique non prouvé ne peut plus masquer les updates 1 et 2 |
| Import client groupé | `pnpm exec vitest run --project client-core packages/client-core/tests/page-reconciler.property.spec.ts packages/client-core/tests/page-editing-session.spec.ts packages/client-core/tests/legacy-page-editing-session.spec.ts` | 3 fichiers, 40 tests passés |
| Régressions API ciblées | `pnpm exec vitest run --project api-contract tests/page-operation-service.integration.spec.ts tests/page-operation-compaction.integration.spec.ts tests/page-operations.contract.spec.ts` | 3 fichiers, 27 tests passés |
| Contrats API et workspace après correction du cycle de vie | `pnpm test:contract` | 93 fichiers, 1 147 tests passés ; longue absence en 153,34 s, aucun rejet différé |
| Exclusion activation/remplacement complet | Biome ciblé, `pnpm typecheck`, Vitest `page-operations.integration.spec.ts`, `page-operations.contract.spec.ts` et `page-documents.contract.spec.ts` lancés en parallèle | format/lint passés, 9 projets typés, 7 tests PostgreSQL et 20 contrats API passés ; le refus transactionnel est durable, conserve le corps 426 et les rejeux déjà acceptés restent acceptés en direct comme en batch |
| Benchmark 500 blocs après amorçage legacy | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/editor-performance.spec.ts` | 5 profils passés en 21 s ; Chromium ouvre les 500 blocs en 3,4 s pour le parcours complet, respecte la fenêtre SC-007 mesurée autour de la sélection et garde un p95 de frappe à 13,9 ms |
| Confirmation fichier isolée de l'activation de page | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/files.spec.ts --grep "confirming sends the file to the trash" --repeat-each=10` | 50 passages sur 50, dont 10 Firefox conteneurisés, sans retry ; les 5 profils passent en 113 s |
| Aperçu fichier isolé de l'activation de page | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/accessibility.spec.ts --grep "preview frame is labelled for assistive technology" --repeat-each=10` | 50 passages sur 50, dont 10 WebKit desktop, sans retry ; les 5 profils passent en 111 s |
| Typage | `pnpm typecheck` | 9 projets passés |
| Couverture complète | `CI=1 pnpm test:coverage` | 263 fichiers, 2 895 tests passés, 90,21 % de lignes et 85,19 % de branches |

Les cinq profils navigateur sont Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop. Chaque profil utilise sa propre base, son
propre serveur et ses propres ports ; les cinq stacks ciblées ont été lancées
en parallèle.

## Incidents révélés par les preuves

Le parcours connecté créait encore systématiquement une
`LegacyOfflineBranch` à la simple ouverture de l'éditeur, même lorsque la tête
serveur était disponible et qu'aucun autre appareil n'écrivait. La première
frappe devait donc attendre une conversion conçue pour le hors-ligne et
ressemblait à une sauvegarde de fichier complet. L'ouverture éditable draine
maintenant les seules mutations workspace qui définissent le corps, relit la
tête canonique serveur, vérifie son digest, active atomiquement le checkpoint
et monte directement la session opérationnelle. Une tête déplacée pendant la
bascule est relue avec un nombre de tentatives borné ; une vraie perte réseau
retombe sur la branche sémantique durable sans perdre le droit d'écrire. Le
journey observe les requêtes et échoue si l'ancienne route PUT réapparaît.

Cette activation a aussi révélé qu'un appel rejoignant une réconciliation en
cours attendait seulement la passe déjà en vol, alors même qu'il demandait une
passe coalescée supplémentaire. Le propriétaire initial drainait bien la suite,
mais la barrière rejointe pouvait relire l'outbox trop tôt et choisir une branche
legacy inutile. La promesse partagée couvre désormais le drain complet ; un test
retient séparément les deux passes et interdit au second appelant de résoudre
avant la libération de la seconde.

Sous la charge des cinq navigateurs, une confirmation strictement vide pouvait
encore republier la même page durable. Cette publication relançait son propre
rafraîchissement puis un nouvel échange vide, jusqu'à produire plusieurs centaines
de requêtes de synchronisation pour une page intacte. Le reconciler compare
désormais lot, updates reçues, curseur, version vector, digest et ambiguïtés avant
de notifier. Dans la même fenêtre, une adoption distante ne compte plus comme un
geste local et ne peut plus empêcher la première saisie réelle d'avancer son
témoin de durabilité.

L'activation directe a enfin rendu visible une divergence ancienne entre client
et serveur : l'éditeur insère un paragraphe vide structurel pour monter BlockNote,
le serveur le considérait vide après le premier correctif, mais la projection
optimiste le classait encore comme contenu et ouvrait une confirmation destructive.
Le prédicat vit maintenant dans le domaine partagé. Les tests domaine, Dexie et
PostgreSQL prouvent qu'un paragraphe strictement vide se convertit sans alerte,
tandis qu'une propriété inconnue reste protégée comme donnée potentielle.

Le journey de migration a reproduit une course réelle : sur Chromium, la
conversion pouvait partir avant que l'outbox v2 ait installé l'alias de révision
canonique. Le premier échange échouait alors proprement mais la session restait
indéfiniment sur « en attente ». La session retente désormais cette conversion
transitoire avec backoff, toujours dans la même file sérielle que les gestes.
Elle n'exige ni rechargement, ni nouvelle frappe, et ne peut pas convertir en
parallèle une branche encore modifiée.

Le journey d'ambiguïté a également vérifié que les branches comparées sont
reconstruites avec toutes leurs mises à jour causales. Une édition saisie en
plusieurs updates n'est plus réduite à son premier caractère lors d'un conflit
delete/edit.

Le gate PR complet a ensuite révélé une saturation propre à Firefox après les
45 journeys : une courte saisie pouvait produire 67 changements BlockNote et
autant de commits chiffrés en série, laissant l'éditeur sur « Enregistrement… »
plus de 20 secondes sans erreur ni perte. La frontière éditeur applique
désormais une back-pressure : le premier changement part immédiatement, puis
les projections textuelles arrivées pendant ce commit sont réduites à leur état
initial et final dans la transaction durable suivante. Après correction, cinq
répétitions sur chacun des cinq profils — 25 exécutions — passent en parallèle
en 50 secondes, contre 81 secondes pour seulement trois répétitions avant
correction.

Le même gate a exposé un second cas de charge sur Chromium mobile : le menu
slash créait bien le séparateur, mais le regroupement pouvait présenter au
moteur l'effacement de `/div` et le changement de type dans le mauvais ordre.
Comme un séparateur ne peut jamais porter de texte, la transaction était
refusée puis la projection visible revenait à `/div`. L'adaptateur efface
désormais la requête avant la transformation et conserve toute mutation de
l'arbre comme frontière de regroupement. Le journey complet des cinq types de
blocs passe ensuite cinq fois sur chacun des cinq profils en parallèle (25/25).

La CI de `main` a enfin trouvé une frontière d'historique encore insuffisante :
si la dernière frappe attendait derrière un commit local lorsque l'utilisateur
transformait le paragraphe, la frappe et la transformation pouvaient devenir
une seule transaction. Annuler le titre supprimait alors aussi un à trois
caractères (`avant` redevenait par exemple `avan` ou `av`). Le problème a été
reproduit 25 fois sur chacun des cinq profils : 0/5 profils étaient exempts
d'échec ou de flake. La file ne regroupe désormais entre notifications que les
rafales de texte locales compatibles ; insertions, déplacements, duplications,
formatages et transformations gardent leur propre transaction. Une rafale de
texte immédiatement suivie d'une transformation est scindée à la frontière
sémantique, y compris lorsque BlockNote ne publie le caractère déclencheur que
dans l'état précédent de la transformation. Chaque lot utilise en outre la
projection du document capturée lors de sa notification, et undo/redo attend
les écritures déjà visibles avant de s'exécuter. La suite complète de l'éditeur
passe sur les cinq profils, puis le même stress passe 25 fois sur chacun d'eux,
soit 125/125 exécutions sans flake.

La preuve de longue absence a exposé trois défauts que les petits scénarios ne
montraient pas. La fenêtre sémantique s'arrêtait à 10 000 lignes et pouvait donc
omettre précisément l'update de retour numéro 10 001. Chaque page de catch-up
rescannait ensuite toutes les frontiers depuis zéro, donnant un coût
quadratique. Enfin, la frontier résultante stockée après acceptation contient
l'état serveur déjà fusionné ; l'utiliser seule faisait renvoyer à la tablette
sa propre update concurrente. La fenêtre est désormais entièrement paginée,
les checkpoints complets bornent le replay sans supprimer l'historique, la
confirmation reprend au préfixe monotone connu et la frontier d'auteur évite
l'écho. Le scénario complet converge, compacte 10 001 payloads seulement après
les deux acquittements et rejoue ensuite l'identité locale comme `repeated` sans
duplication. Ce volume a aussi révélé que PostgreSQL vérifiait les deux clés
étrangères vers les enveloppes par des scans complets, faute d'index automatique
sur les colonnes référençantes. La migration 0011 ajoute ces deux index : le même
scénario passe désormais en 150,55 secondes, et la compaction ne se dégrade plus
quadratiquement avec la longueur de l'oplog.

La première CI de cette tranche a mesuré 84,99 % de branches sous Linux contre
85,00 % sous macOS. Les scénarios ajoutés pour créer une marge réelle ont alors
exposé une perte fonctionnelle : une insertion sous un parent supprimé était
bien classée `delete-edit`, mais le sous-arbre récupérable restait celui d'avant
l'insertion. La reconstruction rejoue désormais les insertions concernées dans
l'ordre, suit les parents eux-mêmes insérés et traverse les cellules de tableau.
Les tests couvrent aussi les transformations équivalentes, la réutilisation
invalide d'une identité d'update et les décisions de résolution refusées.

Cette même validation renforcée a reproduit un refus intermittent au premier
rollover de 512 updates : deux snapshots Loro issus du même ensemble causal
pouvaient avoir des octets différents selon l'ordre d'import, et leur hash brut
était comparé comme une identité opérationnelle. Le serveur rejetait alors un
checkpoint pourtant valide avec `page-operations.projection-invalid`. Le hash
des octets reste la preuve d'intégrité du checkpoint ; l'identité opérationnelle
est désormais dérivée de l'identité de page et de la version vector canonisée.
Dix rejeux indépendants de 512 updates verrouillent la stabilité après
réouverture, tandis que le scénario des 10 001 updates couvre le rollover réel
dans PostgreSQL.

La CI contractuelle lente a enfin révélé une requête de sécurité sans
propriétaire de cycle de vie. La première évaluation des politiques de rotation
était lancée sans être attendue ; le test de démarrage pouvait donc fermer son
pool PostgreSQL pendant que cette lecture restait en vol, puis Vitest signalait
le rejet plusieurs minutes plus tard pendant la preuve des 10 001 updates.
L'application attend désormais cette évaluation avant d'être déclarée prête et
le hook de fermeture Fastify arrête l'intervalle avant la base. Le test de
régression prend un verrou exclusif réel sur `rotation_policies`, observe la
lecture bloquée via `pg_locks` et prouve que `buildApp` reste en attente jusqu'à
sa libération. La suite exacte qui avait échoué passe ensuite ses 1 147 tests
sans rejet différé.

Le gate navigateur complet a ensuite exposé la même perte déterministe sur les
deux profils WebKit. Pendant la saisie des options d'une propriété structurée,
une projection de synchronisation pouvait rerendre le parent après que le
navigateur avait peint `To do, Done`, mais avant le commit d'état React. Le
champ contrôlé repeignait alors le brouillon précédent vide et la propriété
était réellement créée sans options. Les contrôles de ce formulaire sont
désormais des brouillons DOM autonomes pendant leur montage, un ref conserve le
dernier état reçu et `FormData` reste la valeur autoritaire à la soumission. Le
test unitaire force précisément le rerender dans cette fenêtre ; le parcours
complet passe ensuite cinq fois sur chacun des cinq profils, soit 25/25.

Le run PR suivant a validé tous les contrats fonctionnels mais a révélé une
frontière de test inadaptée aux petits runners : les dix rejeux indépendants du
rollover de 512 updates partageaient le timeout Vitest générique de cinq
secondes. Sous couverture et en concurrence avec les autres jobs, le dixième
rejeu n'avait plus le temps de terminer, alors que les 2 885 autres tests et le
scénario des 10 001 updates étaient passés. Les dix rejeux sont désormais dix
cas paramétrés distincts. Le volume de 5 120 updates et toutes les assertions
restent identiques, chaque échantillon garde le timeout standard et un échec
désigne directement le rejeu concerné.

Le scénario de reprise d'une page fermée a enfin trouvé une incompatibilité
WebKit dans la première implémentation de l'index local : le curseur IndexedDB
`nextunique` sur la plage composée `[status+pageId]` échouait avec
`UnknownError: Unable to open cursor`, laissant le workspace en chargement.
L'index reste la frontière de routage, mais ses clés ordinaires sont maintenant
parcourues puis dédupliquées en mémoire ; aucune enveloppe chiffrée n'est ouverte.
La migration v7 vers v8 préserve les octets existants et le parcours complet
passe ensuite sur Chromium et WebKit desktop/mobile ainsi que Firefox.

Le gate complet suivant a rendu visible une seconde moitié du même invariant :
une page modifiée hors ligne puis quittée avant la reconnexion conservait une
`LegacyOfflineBranch`, mais seul l'éditeur désormais démonté savait demander sa
conversion. Le statut global honnête restait donc à `1 pending`. Les branches
legacy éditables sont maintenant découvertes par leur index sans ouvrir leur
contenu ; une session montée garde l'exclusivité de sa file de gestes, tandis
qu'une branche sans éditeur est convertie en arrière-plan après sa dépendance
workspace. Les notifications locales dérivent leur état des files durables et
ne peuvent plus écraser tardivement un acquittement par un faux `pending`.

Les mêmes traces ont révélé qu'une conversion page vers dossier laissait le
journal opérationnel local interroger une autorité que le serveur avait déjà
retirée. La conversion optimiste supprime désormais état, updates, ambiguïtés et
branche dans la transaction qui crée la mutation ; une requête déjà partie est
refusée en 409 documenté plutôt qu'en 500. Les 46 tests client/web ciblés, les
4 tests d'intégration du service et les trois journeys fautifs passent, puis la
matrice navigateur ciblée passe sur les cinq profils (5/5) avec deux workers.

Le benchmark T190 a enfin séparé trois coûts jusque-là confondus. Une première
mesure convergeait correctement mais demandait 110,15 secondes au second
appareil : les digests des 10 000 updates étaient calculés séquentiellement côté
client. Leur vérification parallèle par lot borné, suivie d'un unique import
CRDT groupé, ramène le catch-up à 15,20 secondes et le pic de heap à 99,0 MiB.
Le même profil a révélé qu'un curseur numérique pouvait annoncer une séquence
absente de la frontier chiffrée et faire sauter des opérations encore inconnues.
Le serveur ne lui fait désormais jamais confiance seul : il retrouve le plus
grand préfixe causal prouvé par lectures indexées, avec repli logarithmique si
l'état est incohérent. Le test de régression demande volontairement la séquence
2 depuis une frontier vide et reçoit bien les updates 1 et 2.

Le job Chromium de la PR a ensuite rendu visible une course entre le benchmark
des 500 blocs et l'activation opérationnelle. Le scénario ouvrait d'abord la
page vide, déclenchait son activation, puis injectait le document historique par
`page.document.replace`. Sur un runner lent, le contrôle HTTP pouvait observer
une page encore legacy, l'activation pouvait commit, puis la transaction de
remplacement être rejouée sans repasser par ce contrôle : les deux écritures
étaient annoncées comme acceptées alors que la projection opérationnelle restait
vide. L'exclusion appartient désormais à la transaction sérialisable elle-même
et son refus idempotent est couvert directement au niveau PostgreSQL. Le
benchmark amorce de son côté le document avant la première ouverture, qui est
le parcours historique réellement mesuré ; les cinq profils passent ensemble.

La matrice exhaustive locale a enfin exposé une interaction distincte sur le
parcours de suppression de fichier : après que le témoin global paraissait
synchronisé, l'activation opérationnelle de la page continuait encore et son
rafraîchissement pouvait remplacer le bouton de confirmation entre l'appui et
le relâchement sous Firefox contraint. La trace prouvait qu'aucune requête de
suppression n'était partie, puis le retry réussissait. Les parcours fichiers
attendent désormais le témoin éditorial propre à la page avant d'interagir. La
porte exhaustive suivante a retrouvé la même course sur l'ouverture d'un aperçu
WebKit, qui a confirmé que la barrière devait être commune à toutes les surfaces
fichier et non locale au scénario de suppression. Cent répétitions ciblées,
cinquante par interaction et réparties sur les cinq profils, n'ont produit ni
échec ni retry.

## Résultat de la frontière workspace/réglages

Le workspace ne rend plus sous le document courant les panneaux de stockage,
outbox, diagnostics, corbeille, identifiants, relations techniques ou
restauration de révision. La barre de page conserve uniquement un accès aux
réglages, un statut de synchronisation compact et, lorsqu'une action échoue, un
message compréhensible avec un lien vers le diagnostic détaillé.

Une destination Réglages indépendante regroupe sécurité et appareils,
sauvegardes, stockage et synchronisation, corbeille et détails de la page
courante. Le workspace reste monté mais inerté et masqué pendant la visite : le
retour restaure la page active, le déclencheur ayant le focus, le scroll global
et le bloc de lecture visible sans remonter le document ni recréer l'éditeur.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composant et client web | `pnpm exec vitest run --project web` | 43 fichiers, 263 tests passés |
| Typage web | `pnpm --filter @myownnotion/web typecheck` | passé |
| Frontière workspace/réglages | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/workspace-settings-boundary.spec.ts` | 5 profils passés ; item, focus, scroll et bloc visible restaurés |
| Régressions contenu/gestion | matrice ciblée fichiers, hiérarchie, relations, révisions, offline, interruptions et sauvegardes | tous les scénarios passés sur les 5 profils après déplacement des surfaces |
| Régressions shell | matrice ciblée authentification, appareils, sécurité, connexion, clavier, accessibilité, 320 px et shell | tous les scénarios fonctionnels passés sur les 5 profils |
| Accès aux surfaces déplacées | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/databases-offline-sync.spec.ts tests/e2e/databases-security.spec.ts tests/e2e/search.spec.ts` | 5 profils passés ; outbox consultée dans Réglages, édition reprise dans le workspace et restauration effectuée dans la corbeille dédiée |
| Menus bornés par le viewport | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/block-editor.spec.ts tests/e2e/page-ambiguity.spec.ts` | 5 profils passés ; première et dernière actions atteignables sur desktop et mobile |
| Références visuelles | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/workspace-shell-visual.spec.ts --update-snapshots` | workspace et réglages approuvés en clair/sombre sur Chromium contrôlé ; comportement passé sur les 5 profils |

Le journey est enregistré dans `ci/test-impact.json`. Les helpers historiques
ouvrent désormais les surfaces d'exploitation via leur destination et le
statut compact agrégé reste la frontière d'attente de la synchronisation, sans
remonter une outbox technique sous chaque note.

La matrice complète a révélé que trois journeys historiques cherchaient encore
l'outbox ou la corbeille sous le document. Ils suivent désormais le même chemin
que l'utilisateur : ouverture de la destination dédiée, contrôle ou action,
puis retour au workspace retenu. Elle a aussi exposé un défaut réel des menus
contextuels hauts : Ariakit bornait son conteneur de positionnement, tandis que
le défilement était appliqué au contenu interne. Le conteneur borné est
maintenant la surface défilable ; insertion et suppression restent accessibles
sur les cinq profils, même lorsqu'aucun côté de l'ancre ne peut accueillir le
menu entier.

## Régression activation/conversion fermée

Le premier gate de cette tranche a révélé une course réelle sur Firefox : une
activation de page et son premier bloc opérationnel pouvaient être déjà en vol
quand l'utilisateur convertissait cette page en dossier. La conversion était
bien acceptée, mais la réponse tardive recréait une update de page que le
serveur refusait ensuite avec `page-operations.projection-invalid`. Le statut
restait alors durablement sur « 1 changement en attente ».

L'installation d'un checkpoint et chaque commit éditorial vérifient désormais
le type courant dans la même transaction IndexedDB que l'écriture. Le cache de
projection utilise en plus un compare-and-swap sur la révision observée. Si la
conversion gagne, aucune autorité de page ne peut réapparaître ; si l'écriture
gagne, la transaction de conversion retire ensuite état et updates ensemble.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Course d'activation | `pnpm exec vitest run --project web apps/web/tests/operational-page-opening.spec.ts` | 8 tests passés ; une activation libérée après la conversion ne recrée ni état ni update |
| Commit atomique | `pnpm exec vitest run --project client-core packages/client-core/tests/page-operation-atomicity.spec.ts` | 15 tests passés ; un commit préparé est refusé quand l'item est devenu dossier |
| Journey contraint répété | matrice `item-conversion.spec.ts` ciblée avec `--repeat-each=10` | 50/50 passages, dix sur chacun des cinq profils, sans retry |

`ci/test-impact.json` relie maintenant ce journey aux changements de service,
stockage local et moteur page-sync afin que cette frontière soit toujours
rejouée par la CI.

## Régression de revendication `sending`

La CI Firefox a exposé une opération acceptée côté serveur qui pouvait rester
durablement `sending` si une erreur locale inattendue interrompait le commit de
la réponse. Les passages suivants ne trouvaient alors aucun lot `pending`, mais
envoyaient jusqu'à la limite d'échanges des requêtes `updates: []` sans pouvoir
annoncer la convergence.

Un échange retient désormais uniquement les identités qu'il a revendiquées et
remet ses propres lignes encore `sending` à `pending` sur toute sortie avant le
commit. Un passage concurrent qui rencontre une revendication préexistante de
la même page attend sans transport : il ne vole pas le lot d'un autre onglet et
n'envoie pas un suffixe causal.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Réconciliateur déterministe | `pnpm exec vitest run --project client-core packages/client-core/tests/page-reconciler.property.spec.ts` | 16 tests passés ; échec de scellement récupéré, même `updateId` renvoyé puis acquitté |
| Typage et statique | typecheck client-core et contrôle Biome des deux sources modifiées | passés |
| Runner Firefox Linux | journey `workspace-shell.spec.ts` ciblé avec `--repeat-each=20` dans l'image Playwright CI et une base jetable migrée | 20/20 passages en 1 min 54, sans retry |
| Références Chromium Linux | `workspace-shell-visual.spec.ts` dans l'image Playwright CI et une base jetable migrée | 4/4 références workspace/réglages, clair/sombre |

## Coordination réelle de plusieurs onglets

Les files JavaScript historiques étaient seulement partagées par les appels
ayant importé la même instance de module. Deux onglets, deux workers ou deux
handles Dexie pouvaient donc chacun croire posséder la page. Plus grave, le
reset général des lignes `sending` au démarrage permettait à un nouvel onglet de
préempter un envoi encore vivant. Ce comportement expliquait à la fois les
requêtes vides, les statuts bloqués et les reprises qui ressemblaient à un
remplacement manuel plutôt qu'à une synchronisation.

Les propriétés critiques sont maintenant détenues par des Web Locks de même
origine. Seul l'onglet qui vient d'acquérir la ressource récupère les envois
interrompus de sa file ; la fermeture du propriétaire libère automatiquement le
lock, puis le successeur reprend le même `updateId`. Un `BroadcastChannel`
signale les commits locaux, mais le destinataire ne fait confiance qu'à la ligne
chiffrée partagée dans IndexedDB ou à un état durable qui domine déjà sa version
vector. Le message n'est jamais importé comme contenu faisant autorité.

Le journey a révélé deux dernières courses d'interface. Après le commit serveur
par l'onglet propriétaire, l'autre onglet conservait « synchronisation… » parce
qu'une confirmation vide ne rafraîchissait pas sa session ouverte. Le
reconciler republie désormais seulement une observation durable matériellement
différente. Ensuite, une insertion distante entre deux événements d'une même
rafale de frappe pouvait décaler les offsets encore calculés contre l'ancien
texte visible. La session diffère cette adoption jusqu'à la fin de la rafale,
tout en committant chaque touche immédiatement, puis importe la frontier durable
complète. Une régression Chromium a ensuite exposé la variante où l'adoption
était déjà en file au démarrage de `beforeinput`. La garde est donc réévaluée à
l'exécution et après la reconstruction asynchrone, juste avant l'import dans la
réplique visible.

Les cinq profils prouvent désormais le même parcours : édition hors ligne dans
un onglet visible dans l'autre sans rechargement, modifications simultanées du
même paragraphe, reconnexion, fermeture du propriétaire pendant `sending`,
reprise automatique et convergence du texte, des identités et des statuts sans
aucun `page.document.replace`.

Les preuves exécutées pour fermer cette tranche sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Coordination déterministe | `pnpm exec vitest run --project client-core packages/client-core/tests/cross-context-coordinator.spec.ts packages/client-core/tests/page-operation-atomicity.spec.ts packages/client-core/tests/page-reconciler.property.spec.ts packages/client-core/tests/page-tab-channel.spec.ts packages/client-core/tests/page-editing-session.spec.ts` | 5 fichiers, 54 tests passés ; exclusion mutuelle, reprise du même ID et convergence de deux handles indépendants |
| Régression adoption déjà en file | `pnpm exec vitest run --project client-core packages/client-core/tests/page-editing-session.spec.ts` | 1 fichier, 13 tests passés ; la rafale conserve ses offsets puis adopte la frontier durable complète |
| Intégration web | `pnpm exec vitest run --project web apps/web/tests/operational-page-opening.spec.ts apps/web/tests/synchronize-serialization.spec.ts` | 2 fichiers, 19 tests passés ; canal réel, adoption vérifiée et sérialisation du transport |
| Journey multi-onglets | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-multi-tab-convergence.spec.ts` | 5/5 profils passés en 35 s ; offline, même paragraphe, crash pendant `sending`, reprise et convergence sans remplacement complet |
| Journey riche ciblé | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/rich-page.spec.ts` puis `--repeat-each=5` | 5/5 profils puis 25/25 répétitions passés ; aucun premier caractère perdu après adoption distante |
| Gate pré-push exact | `pnpm checks:local` avec les versions d'outils imposées par `docs/development.md` | passé ; 2 936 tests de couverture, 15 tests de performance, migrations et 1 151 tests de contrat, gate E2E 5/5, build de production, images API/web `amd64` et `arm64`, sécurité, licences et contrat Compose |

## Canevas de page focalisé et fichiers rattachés

La correction des boucles révélées par le HAR est présente dans la base de
cette tranche : une page ordinaire n'est plus sondée comme une base structurée,
les récupérations impossibles sont mises en quarantaine et une absence distante
ne relance plus indéfiniment la même branche historique. La présente tranche ne
modifie pas ce protocole ; elle rend son état lisible sans laisser les
diagnostics occuper ou déplacer le document.

Le titre est maintenant la première grande ligne éditable de la page et son
identité reste stable quand son libellé devient « Sans titre ». Le fil d'Ariane
et la navigation adoptent le renommage sans remonter l'éditeur. Le document
forme un canevas continu : il n'est plus enfermé dans une carte, le réglage
n'est plus dupliqué dans l'en-tête et l'indicateur détaillé de synchronisation
reste accessible depuis un discret bouton d'information en bas de page. Les
alertes globales sont elles aussi compactes et ne recouvrent plus les contrôles
mobiles.

Un fichier déposé dans l'éditeur conserve désormais une seule identité pendant
la reprise tus et devient une pièce jointe de contenu sous sa page source. Il
n'apparaît plus à la racine. Le contrôle de pièces jointes reste distinct du
contrôle des sous-pages ; un fichier autonome peut toujours être créé
volontairement dans la hiérarchie. La commande `/page` crée quant à elle une
sous-page sous la page courante, remplace le bloc seulement après le succès de
la création, attend la durabilité de ce lien puis ouvre immédiatement la page
créée. La création depuis la navigation suit la même règle sur desktop comme
sur mobile : la nouvelle page devient la surface active, sans second clic.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composants Web | `pnpm exec vitest run --project web apps/web/tests/page-title-editor.spec.tsx apps/web/tests/slash-menu.spec.ts apps/web/tests/editor-adapter.spec.ts apps/web/tests/realtime-file-sync-status.spec.ts apps/web/tests/workspace-shell.spec.tsx` | 5 fichiers, 28 tests passés ; titre, `/page`, adaptation texte/marks, statut compact et frontières du canevas |
| Upload API et stockage | `pnpm exec vitest run --project api-contract --project database-integration apps/api/tests/uploads.contract.spec.ts packages/database/tests/uploads.integration.spec.ts packages/database/tests/migrations.integration.spec.ts` | 3 fichiers, 42 tests passés ; finalisation idempotente, rattachement à la page et migration vide/avant |
| Journeys multi-navigateurs | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/workspace-shell.spec.ts tests/e2e/workspace-settings-boundary.spec.ts tests/e2e/workspace-shell-visual.spec.ts tests/e2e/files.spec.ts tests/e2e/editor-offline-media.spec.ts tests/e2e/page-links.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/backup.spec.ts` | 5/5 profils passés en 173 s ; desktop/mobile, Chromium/Firefox/WebKit, fichiers, sous-pages, clavier, alertes et réglages |
| Navigation après création | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/workspace-shell.spec.ts tests/e2e/page-links.spec.ts tests/e2e/item-conversion.spec.ts tests/e2e/page-scroll-restoration.spec.ts tests/e2e/databases-offline-sync.spec.ts tests/e2e/databases-schema.spec.ts` | 5/5 profils passés ; toute page créée devient active, le tiroir mobile se ferme et le lien `/page` survit au retour puis au rechargement de sa source |
| Références visuelles | `workspace-shell-visual.spec.ts` sur l'hôte puis Chromium dans l'image Linux de CI | 5/5 profils fonctionnels et 4/4 références clair/sombre approuvées ; le libellé de statut reste visuellement masqué au repos |
| Statique | `pnpm format:check`, `pnpm lint:ci`, `pnpm typecheck`, `git diff --check` | passés |
| Gate pré-push exact | `pnpm checks:local` avec l'ordonnancement et la largeur Playwright définis dans `docs/development.md` | passé sur le commit de cette tranche |

## Blocs riches et médias intégrés

Les primitives riches de l'éditeur possèdent maintenant leur interaction V1
complète plutôt qu'une simple projection visuelle : toggle accessible et
persisté, callout avec icône et ton, table bornée navigable au clavier, bloc de
code copiable en texte brut, image et fichier réellement consultables, et
contenu externe chargé seulement après consentement explicite dans une iframe
restreinte. Les sources externes sont normalisées vers les lecteurs approuvés ;
une URL invalide ou dangereuse n'entre jamais dans le document canonique.

Les images et fichiers résolvent d'abord les octets encore détenus par la file
locale, puis leur ressource serveur après acquittement. Un élément distant
inconnu n'est plus présenté à tort comme un upload local en attente. Le même
identifiant de fichier est conservé pendant la reprise réseau et les aperçus
restent honnêtes lorsque les octets sont indisponibles.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Contrats des blocs | `pnpm exec vitest run --project web apps/web/tests/rich-block-behavior.spec.tsx` | 1 fichier, 8 tests passés ; accessibilité du toggle, grapheme du callout, copie sûre, bornes de table, consentement/sandbox et état fichier honnête |
| Régressions Web | `pnpm exec vitest run --project web` | 54 fichiers, 328 tests passés |
| Blocs riches multi-navigateurs | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/rich-page.spec.ts` | 5/5 profils passés ; callout, toggle, table, code et propriétés canoniques persistent après rechargement |
| Médias hors ligne puis distants | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/editor-offline-media.spec.ts` | 5/5 profils passés ; image et fichier visibles hors ligne, même identité à la reconnexion, puis résolution depuis le serveur après rechargement |
| Parcours structuré long sous charge | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/databases-views.spec.ts --repeat-each=5` | 25/25 exécutions passées, dont 5 Firefox dans l'image Linux CI ; chaque attente métier garde son plafond strict et le budget global reflète les écritures durables séquentielles du parcours |

## Course de conversion dossier vers page

Le premier gate complet de la tranche a révélé une course réelle dans
`item-conversion.spec.ts`, et non un manque de délai. La conversion était déjà
durable localement et visible dans l'arbre, mais sa mutation venait de passer de
`pending` à `sending`. Le statut global ne comptait alors que les lignes
`pending` : la fin indépendante d'un échange de page pouvait annoncer
« synchronisé » pendant que le serveur traitait encore la conversion. Une
ouverture immédiate demandait le checkpoint trop tôt, recevait
`page-operations.not-active`, puis réimportait la réponse canonique encore
typée dossier. La page restait affichée sans éditeur avec un faux diagnostic de
contenu non téléchargé.

La correction ferme les trois frontières observées dans la trace :

- une conversion optimiste dossier vers page crée l'enveloppe canonique vide,
  donc reste éditable même réellement hors ligne ;
- l'agrégat workspace compte aussi `sending` et `blocked`, donc une autre file
  terminée ne peut plus publier une confirmation globale prématurée ;
- l'ouverture d'une page sans état opérationnel draine sa création ou sa
  conversion avant toute demande de checkpoint ou lecture distante, et pas
  seulement juste avant l'activation finale.

Les preuves ciblées exécutées sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Projection locale | `pnpm exec vitest run --project client-core packages/client-core/tests/apply-to-projection.spec.ts` | 34/34 tests passés ; la conversion hors ligne possède immédiatement un document vide présent |
| Barrière et statut agrégé | `pnpm exec vitest run --project web apps/web/tests/operational-page-opening.spec.ts apps/web/tests/synchronize-serialization.spec.ts` | 21/21 tests passés ; création et conversion sont drainées avant le checkpoint, et une ligne `sending` interdit « synchronisé » |
| Journey répété sous charge | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/item-conversion.spec.ts --repeat-each=10` | 700/700 parcours passés sans retry : 140 sur chacun des cinq profils, Firefox dans l'image Linux CI |

## Limites encore ouvertes

Cette validation ne clôt pas les tâches suivantes :

- la persistance chiffrée des octets d'un nouveau fichier hors ligne au-delà
  d'une fermeture brutale du navigateur (FR-075, SC-022, T252 à T255) ;
- la finition et les surfaces restantes en US6/US7.

La tranche prouve donc le parcours de synchronisation implémenté aujourd'hui ;
elle ne prétend pas encore que toute la V1 est terminée.
