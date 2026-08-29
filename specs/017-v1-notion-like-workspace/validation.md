# Validation — Feature 017

Dernière mise à jour : 2026-08-29
Tranches validées : US3, US5, synchronisation éditoriale convergente et migration v2 ; frontière workspace/réglages T182/T222 ; ergonomie clavier/toucher US7 ; cohérence multi-surfaces US6

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

## Octets hors ligne durables après fermeture

L'insertion d'un média ne crée plus son bloc avant que ses octets et ses
métadonnées soient durablement chiffrés dans IndexedDB. Le staging passe par un
manifeste incomplet, des morceaux scellés dont l'AAD lie l'identité du fichier,
l'index et les métadonnées, puis un état `ready` atomique. Une interruption à
n'importe laquelle de ces frontières est nettoyée au redémarrage ; un quota
insuffisant ne laisse ni bloc, ni manifeste, ni morceau orphelin.

Au lancement et au retour réseau, la file reconstruit les fichiers sans
dépendre d'un objet `File` encore présent en mémoire. Un verrou éditorial
protège la transition staging → bloc et un verrou par `fileItemId` empêche deux
onglets de créer le même upload. La reprise découvre d'abord l'upload
déterministe par `HEAD` puis l'élément final par `GET`, vérifie strictement
l'offset serveur et ne supprime les octets locaux qu'après vérification de la
finalisation. Le même identifiant survit donc à la fermeture et chaque fichier
n'est créé qu'une fois côté serveur.

Le journey ferme la page alors que toutes les routes `/v1/**` sont coupées,
ouvre une nouvelle page sans aucun état JavaScript précédent, vérifie les blocs
et les octets relus depuis IndexedDB, puis rétablit l'API et attend la
convergence distante. Le blocage des routes est intentionnel :
`browserContext.setOffline(true)` rend même un `File` JavaScript en mémoire
illisible sous Playwright WebKit (`NotReadableError`). Couper toute l'API garde
le serveur réellement inaccessible sans confondre cette anomalie du moteur de
test avec le comportement du produit.

Les preuves exécutées pour fermer T252 à T255 sont :

| Couche | Commande | Résultat |
| --- | --- | --- |
| Stockage chiffré et crash | `pnpm exec vitest run --project client-core packages/client-core/tests/pending-file-transfer-store.spec.ts` | 10/10 tests passés ; aucun nom, type ou octet en clair, reconstruction exacte après réouverture, nettoyage aux trois frontières de crash, quota, isolation d'un manifeste altéré et conservation du ciphertext lorsque le routage contredit l'enveloppe authentifiée |
| Reprise, concurrence et upload | `pnpm exec vitest run --project web apps/web/tests/realtime-file-sync-status.spec.ts apps/web/tests/upload.spec.ts` | 23/23 tests passés ; même ID après redémarrage, un seul `POST` entre deux onglets, aucun upload orphelin après suppression du bloc, exclusion staging/nettoyage, quota sans bloc et arrêt sûr face aux offsets absents, répétés, oscillants ou hors bornes |
| Fermeture hors ligne multi-navigateurs | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/editor-offline-media.spec.ts` | 5/5 profils passés en 28 s ; image et fichier restaurés depuis IndexedDB chiffré, aucun plaintext, exactement deux créations distantes uniques, aucun fichier racine ni panneau de pièces jointes parasite |
| Régression Firefox du gate | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/databases-schema.spec.ts` | 5/5 profils passés en 37 s ; les champs de propriété sont ciblés exactement et ne collisionnent plus avec un nom aléatoire contenant « tags » |
| Gate pré-push exact | `MYOWNNOTION_E2E_JOBS=5 pnpm checks:local` avec les outils imposés par `docs/development.md` | passé ; 290 fichiers et 3 103 tests de couverture (90,17 % lignes, 85,13 % branches), 18 tests de performance, 331 intégrations PostgreSQL, 1 198 contrats, E2E 5/5 en 1 098 s, builds de production et images API/web `amd64`/`arm64`, sécurité, licences et contrat Compose |

## Clavier, toucher et navigateurs — 2026-08-27

La portée de cette tranche suit la constitution 2.0.0 : elle protège les
parcours personnels au clavier, la visibilité du focus, les libellés utiles,
le toucher, le responsive et les navigateurs pris en charge. Elle n'inclut ni
campagne VoiceOver, ni certification WCAG, ni validation spécialisée des
technologies d'assistance.

Les parcours sans souris couvrent l'ouverture et la fermeture des menus, le
retour du focus, la navigation de l'arbre, le déplacement des blocs et la
résolution d'une ambiguïté. Le cas WebKit où `ArrowLeft` doit rejoindre le
parent d'une branche fermée est verrouillé indépendamment. Les contrôles
imbriqués dans une ligne d'arbre conservent leurs propres touches Entrée et
Espace au lieu d'être interceptés par l'arbre.

Le gate complet a aussi exposé un défaut responsive réel dans un callout sur
WebKit mobile. La règle destinée aux cibles tactiles remplaçait la largeur
spécifique du champ d'icône par la largeur native d'un champ texte ; les
contrôles pouvaient alors réduire la zone éditable voisine à zéro pixel. La
règle conserve désormais les largeurs de chaque composant et ne relève que
leurs minima tactiles. Le parcours riche complet verrouille le callout, le
toggle et la table après cette correction.

La première exécution de la PR a ensuite exposé une course propre au nouveau
journey d'animations réduites sur un runner WebKit mobile lent. La création de
page avait déjà sélectionné la nouvelle page et engagé la fermeture normale du
tiroir ; le test rouvrait pourtant ce tiroir pour sélectionner une seconde fois
la même page. La trace CI montre la ligne visible, puis masquée par la fermeture
avant le clic. Le journey vérifie désormais directement le résultat produit —
le nouveau titre actif — avant de tester les animations, sans navigation
redondante.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composants clavier et états | `pnpm exec vitest run --project web apps/web/tests/tree-keyboard.spec.ts apps/web/tests/tree-drag-drop.spec.ts apps/web/tests/editor-block-interactions.spec.ts apps/web/tests/page-ambiguity-notice.spec.tsx` | 21/21 tests passés ; parent WebKit, contrôles imbriqués, cible DnD adjacente, menu de bloc et résolution explicite |
| Matrice ciblée | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/keyboard-navigation.spec.ts tests/e2e/touch-and-motion.spec.ts tests/e2e/narrow-viewport.spec.ts` | 5/5 profils passés en 137 s, lancés en parallèle : Chromium desktop/mobile, WebKit desktop/mobile et Firefox desktop |
| Régression DnD clavier | `MYOWNNOTION_E2E_JOBS=2 bash scripts/test-e2e-local.sh tests/e2e/keyboard-navigation.spec.ts --grep "the visible drag handle reorders siblings with the keyboard"` | 5/5 profils passés ; la cible visuelle adjacente est établie avant le dépôt |
| Régression callout tactile | `MYOWNNOTION_E2E_JOBS=2 bash scripts/test-e2e-local.sh tests/e2e/rich-page.spec.ts` | 5/5 profils passés en 39 s ; le contenu du callout reste éditable sur WebKit mobile puis toggle et table persistent |
| Course création → tiroir mobile | `MYOWNNOTION_E2E_JOBS=5 CI=true pnpm test:e2e:local -- tests/e2e/touch-and-motion.spec.ts --grep "motion is suppressed" --repeat-each=10` | 50/50 exécutions passées en 60 s après remplacement de la resélection redondante par l'assertion de la nouvelle page active |
| Statique et sélection CI | `pnpm typecheck`, `pnpm lint:ci`, `pnpm format:check`, `git diff --check` et contrat `test-impact` | passés après l'alignement documentaire final ; les 34 contrats de sélection CI passent |

La matrice vérifie également les cibles tactiles, l'alternative au survol, le
menu contextuel, le mode animations réduites, les popovers près des bords, les
médias et tables à 320 px/zoom 200 %, ainsi que l'absence de skip fonctionnel
propre à WebKit.

## Navigation, titre, statut et liens — 2026-08-27

Cette tranche reste volontairement limitée à l'ergonomie personnelle demandée :
clavier, focus visible, pointeur, toucher et navigateurs pris en charge. Elle ne
comprend ni campagne VoiceOver, ni certification WCAG, ni validation spécialisée
de technologies d'assistance.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Présentation locale, arbre, titre, statut et liens | matrice Vitest ciblée `navigation-state`, `sidebar`, `tree-drag-drop`, `page-title-editor`, `editor-sync-status`, `editor-links`, `editor-block-interactions`, réglages de navigation et frontière du workspace | 9 fichiers et 51 tests passés ; valeurs legacy normalisées, préférences locales indépendantes, trois zones de dépôt, brouillon vide, panneau fermé et retrait de lien conservateur |
| Liens internes et références visuelles | `pnpm test:e2e:local -- tests/e2e/page-links.spec.ts tests/e2e/workspace-shell-visual.spec.ts` | 5/5 profils passés en 72 s ; retargeting et retrait sans perte, statut épinglé, desktop clair/sombre contrôlé |
| Lien Web complet | `pnpm test:e2e:local -- tests/e2e/page-links.spec.ts --grep "external link"` | 5/5 profils passés en 34 s ; création BlockNote Community, édition clic droit et retrait conservant le texte après rechargement |
| Menu de lien au clavier | `pnpm test:e2e:local -- tests/e2e/page-links.spec.ts --grep "page link from its context menu"` | 5/5 profils passés en 37 s ; `Shift+F10`, clic droit, changement d'identité canonique et conservation des deux pages cibles |
| Réorganisation au clavier | `pnpm test:e2e:local -- tests/e2e/keyboard-navigation.spec.ts --grep "visible drag handle reorders siblings"` | 5/5 profils passés en 27 s ; haut/bas visent explicitement avant/après et ne produisent pas d'imbrication involontaire |
| Réglages de la barre latérale | `pnpm test:e2e:local -- tests/e2e/workspace-shell.spec.ts --grep "shortcut visibility"` | 5/5 profils passés en 26 s ; Favoris et Récents repliés indépendamment, section masquée puis réaffichée, état conservé après rechargement desktop/mobile |
| Brouillon structuré pendant une projection | `MYOWNNOTION_E2E_JOBS=2 bash scripts/test-e2e-local.sh tests/e2e/databases-offline-sync.spec.ts` | 5/5 profils passés en 65 s ; un chargement de l'ancienne sélection devenu obsolète ne peut plus remonter le panneau et effacer le premier champ pendant une notification de synchronisation WebKit mobile |
| Reset sécurité sous activité serveur | `MYOWNNOTION_E2E_JOBS=2 bash scripts/test-e2e-local.sh tests/e2e/security-recovery.spec.ts --grep "says so, in those words" --repeat-each=20` | 100/100 exécutions passées en 126 s, soit 20 par profil ; une victime PostgreSQL `40P01`/`40001` est annulée puis rejouée de façon bornée au lieu de rendre la matrice aléatoirement rouge |
| Menu de ligne après clic droit | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/hierarchy.spec.ts --grep "opens the same item actions" --repeat-each=20` | 100/100 exécutions passées en 144 s, soit 20 par profil ; l'activation différée après `Shift+F10` empêche WebKit mobile de refermer dans le même événement le menu déjà ouvert par clic droit |
| Gate pré-push exact | `pnpm checks:local` | passé sur le commit poussé : politique d'outillage, format/lint, types, couverture, performance, PostgreSQL/migrations/contrats, matrice complète des cinq profils à concurrence bornée, builds, images multi-architecture, sécurité, licences et Compose |

## Chevrons, feuilles et liens unifiés — 2026-08-27

Favoris et Récents utilisent maintenant le même ordre visuel
`chevron + libellé`; les réglages emploient la primitive `Switch` commune. Une
page qui perd son dernier enfant redevient une feuille sans message vide, tandis
qu'un dossier temporairement absent puis restauré conserve son état ouvert. Les
cibles de bord gagnent sur la zone d'imbrication lorsqu'elles se recouvrent et
la sélection de ligne n'affiche plus de rail accentué.

Le flux de lien ne demande plus de choisir d'abord entre le schéma Web et le
schéma page. Le même dialogue recherche une page par nom/chemin ou valide une
URL, puis sait convertir les deux représentations. `/lien` ouvre ce dialogue ;
`/embed` reste distinct. Une actualisation reçue pendant la saisie ne remet plus
le brouillon du dialogue à zéro. La suppression complète d'un lien retire enfin
la marque stockée avant la frappe suivante et le caret possède une couleur
explicite sur une ligne vide.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Régressions ciblées | matrice Vitest `sidebar`, réglages de navigation, arbre/DnD, liens et slash menu | 5 fichiers, 33 tests passés ; ordre des chevrons, switch local, feuille normalisée, priorité des bords, conversions et borne de marque |
| Régression Web complète | `pnpm exec vitest run --project web` | 58 fichiers, 365 tests passés |
| Journeys concernés complets | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/page-links.spec.ts tests/e2e/block-editor.spec.ts tests/e2e/hierarchy.spec.ts` | 5/5 profils passés en 242 s, soit 115 parcours : Chromium/Firefox/WebKit, desktop/mobile |
| Courses ciblées après première passe | même matrice avec `--grep "formats a selection|turns a page back|trashes a branch|/lien creates"` | 5/5 profils passés en 59 s ; brouillon de lien conservé pendant sync et branche restaurée encore ouverte |
| Références visuelles | `pnpm test:e2e:local -- tests/e2e/workspace-shell-visual.spec.ts` | 5/5 profils fonctionnels, références Chromium clair/sombre inchangées dans la tolérance approuvée |
| Statique, types et build Web | `pnpm format:check`, `pnpm lint:ci`, `pnpm typecheck`, `pnpm --filter @myownnotion/web build`, `git diff --check` | passés |

## Course WebKit mobile du dialogue de lien — 2026-08-27

La première CI de `main` après la migration Bun a révélé une course réelle dans
le parcours `/lien`. WebKit avait déjà écrit la cible visible dans le champ,
mais React n'avait pas encore commité l'état correspondant lorsqu'une projection
de synchronisation a rerendu le parent. Le champ contrôlé reprenait alors sa
valeur React vide et la validation ne créait aucun lien.

Le dialogue garde désormais ses deux brouillons dans les champs eux-mêmes et
lit leurs valeurs DOM courantes au moment de valider. Une actualisation de la
liste des pages ne remplace plus la saisie visible. L'identité d'une page déjà
choisie reste stable si son nom ou son chemin change à distance ; une saisie
réellement modifiée dans le champ reste toutefois prioritaire. La structure DOM
et les espacements du dialogue n'ont pas changé.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Régression déterministe | `bun run test:unit -- --project web apps/web/tests/link-editor-dialog.spec.tsx` | 1/1 test passé ; le test échouait avant correction en observant une cible redevenue vide entre la saisie DOM et le commit React |
| Contrôleur de liens | `bun run test:unit -- --project web apps/web/tests/editor-links.spec.ts apps/web/tests/slash-menu.spec.ts apps/web/tests/link-editor-dialog.spec.tsx` | 3 fichiers et 11 tests passés |
| Course sur les cinq profils | `MYOWNNOTION_E2E_JOBS=5 bun run test:e2e:local -- tests/e2e/page-links.spec.ts --grep '/lien creates a Web link' --repeat-each=10 --retries=0` | 50/50 exécutions passées en 79 s, dix par profil et sans seconde tentative |
| Gate pré-push exécutable | `bun run checks:local` avec Bun 1.4.0 et les outils épinglés de `docs/development.md`, sur `11881e35` | passé : 302 fichiers et 3 161 tests de couverture, 18 tests de performance, 331 intégrations PostgreSQL, 11 migrations, 108 fichiers et 1 227 contrats, E2E 5/5 en 1 585 s, builds Bun, images API/Web `amd64`/`arm64`, audit, secrets, analyse statique, licences et Compose |

## Cohérence visuelle multi-surfaces — 2026-08-28

La phase US6 est fermée sur les surfaces V1 livrées. Les actions, champs,
confirmations et états asynchrones passent par les primitives communes ; la
copie courante est française ; BlockNote utilise son catalogue officiel
français avec ses styles natifs désactivés et les thèmes de l'application. Les
informations d'exploitation restent dans les réglages ou diagnostics, tandis
que le workspace conserve le contenu, la navigation et des états compacts.

L'ancien composant global `components/sync-status.tsx` et les variantes CSS
`status-banner`, `empty-state` et `loading-state` ont été retirés. Le résumé
workspace conserve ses contrats métier (`offline`, `pending`, `syncing`,
`synced`, `conflict`, `quota-failure`) dans la feature de synchronisation, mais
sa présentation repose maintenant sur le même composant `Status` que les autres
surfaces.

| Surface | États représentatifs | Thèmes / largeur | Preuve |
| --- | --- | --- | --- |
| Installation et connexion | vérification, indisponible, saisie, confirmation, erreur | clair/sombre, desktop/mobile via tokens communs | audit `french-copy.spec.ts`, matrice `v1-surface-consistency.spec.tsx`, journeys `bootstrap.spec.ts` et `authentication.spec.ts` |
| Workspace et éditeur | page vide/active, erreur d'ouverture, enregistrement local, synchronisation, ambiguïté | clair/sombre desktop ; comportement responsive cinq profils | références `workspace-shell-visual.spec.ts`, états communs et `editor-sync-status.spec.tsx` |
| Recherche | initial, chargement, résultats, vide, hors ligne, erreur | clair desktop 1280 × 800 | `v1-search-light` macOS/Linux et journeys `search.spec.ts` / `search-offline.spec.ts` |
| Fichiers et pièces jointes | chargement, local, transfert, indisponible, aperçu, suppression | tokens communs et cinq profils fonctionnels | tests Web ciblés, `files.spec.ts`, `file-preview.spec.ts`, `editor-offline-media.spec.ts` |
| Bases structurées | base vide, toolbar, propriétés, table/liste/Kanban/galerie/calendrier, conflit | sombre desktop 1280 × 800 ; responsive cinq profils | `v1-database-dark`, matrice des composants base et journeys `databases-*.spec.ts` |
| Réglages de navigation | interrupteurs Favoris/Récents et destination séparée | clair mobile 412 × 915 | `v1-navigation-light-mobile` macOS/Linux et `workspace-shell.spec.ts` |
| Sécurité et appareils | connexion, passkeys, mot de passe, sessions, appareils, récupération, rotation | sombre mobile 412 × 915 | `v1-security-dark-mobile` macOS/Linux, tests composants sécurité et journeys dédiés |
| Sauvegardes, historique, corbeille et diagnostics | loading, empty, success, stale/error, restauration | destinations dédiées clair/sombre et responsive | matrice US6, `workspace-settings-boundary.spec.ts`, `backup.spec.ts`, `revision-restore.spec.ts` |

| Couche | Commande | Résultat |
| --- | --- | --- |
| États, copie et éditeur | matrice Vitest ciblée `french-copy`, `v1-surface-consistency`, bases, synchronisation, ambiguïtés et échecs locaux | tests ciblés passés ; aucune ancienne classe d'état ni confirmation native dans `apps/web/src` |
| Typage Web | `bun run --filter @myownnotion/web typecheck` | passé après migration des primitives et du statut workspace |
| Références hôte | `MYOWNNOTION_E2E_JOBS=2 bun run test:e2e:local -- tests/e2e/v1-surface-visuals.spec.ts` | 5/5 profils passés en 62 s ; 4 références Chromium propriétaires et skips de pixels explicites sur les autres moteurs |
| Références Linux CI | image épinglée `mcr.microsoft.com/playwright:v1.62.1-noble`, projets Chromium desktop/mobile | 4/4 références Linux générées et rejouables sur base jetable dédiée |
| Sélection CI | `bun run test:contract -- tests/contract/test-impact.spec.ts` | 34/34 contrats passés ; le journey multi-surfaces et le nouveau propriétaire du statut sync sont enregistrés |
| Régression Chromium complète | `bun run test:e2e:local -- --project=chromium-desktop` | 252 tests passés et 2 scénarios visuels mobiles ignorés par conception, sans échec, en 5,5 min |
| Confirmation de corbeille mobile | quatre parcours ciblés sur Chromium mobile et WebKit mobile | 8/8 exécutions passées ; le tiroir modal cède la place à la confirmation et se rouvre après annulation |

Les huit images approuvées vivent sous
`tests/e2e/v1-surface-visuals.spec.ts-snapshots/`. Elles couvrent deux thèmes,
deux largeurs et plusieurs destinations sans dates ou alertes dépendant de
l'ordre de la suite. Les interactions et états non représentés par un pixel
restent couverts par les tests de composants et les journeys fonctionnels de la
matrice complète.

Le passage complet a également corrigé deux défauts fonctionnels découverts par
la matrice : l'ouverture de la recherche place désormais réellement le focus
dans son champ, et la barre des bases ne recouvre plus les cellules du calendrier
pendant le défilement. La recherche visuelle utilise une référence unique afin
de rester indépendante de l'ordre d'exécution et de l'index conservé en mémoire.
Le périmètre d'ergonomie personnelle validé reste le clavier, le focus visible,
le pointeur et le toucher ; il n'inclut ni campagne VoiceOver, ni certification
WCAG, ni prise en charge spécialisée des technologies d'assistance.

## Identité emoji et deux familles de liens — 2026-08-28

Cette tranche remplace explicitement le dialogue de lien unifié décrit dans la
phase 16. Le composant et ses tests ont été supprimés : « Lien vers une page »
recherche uniquement une identité interne, tandis que « Lien Web » valide une
adresse et crée un bookmark pleine ligne. Les contenus intégrés interactifs
restent une troisième commande.

L'emoji appartient au modèle canonique de la page ou du dossier. Il traverse la
commande idempotente, PostgreSQL, la présentation protégée, la projection
IndexedDB chiffrée, l'outbox, les exports et la restauration. Le même rendu
`ItemIcon` est utilisé dans l'en-tête, l'arbre, la recherche et les références.
Un lien conserve uniquement l'UUID de sa cible et résout titre, type et emoji
depuis la projection courante. Le badge de référence est absent pour l'enfant
direct créé par `/page` et présent pour une référence située ailleurs.

Le journey d'identité choisit l'emoji pendant une coupure réseau complète,
vérifie immédiatement sa présence locale, rétablit la connexion sans recharger,
attend le drainage de l'outbox, puis contrôle recherche et rechargement durable.
Il mesure également le centre commun de l'icône et du chevron et un déplacement
du libellé inférieur ou égal à un pixel. La portée reste celle convenue pour
l'application personnelle : clavier et focus visibles, pointeur, toucher et
navigateurs pris en charge, sans campagne VoiceOver.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Domaine, contrats, projection locale et composants | une invocation Vitest parallèle sur les projets `domain`, `contracts`, `client-core` et `web` ciblant l'icône, le codec, les deux sélecteurs, les liens, le bookmark et le caret | 17 fichiers et 139 tests passés |
| PostgreSQL et API protégée | une invocation Vitest sur `database-integration` et `api-contract` avec base jetable | 4 fichiers et 52 tests passés ; migration 0013, restore, ancienne enveloppe compatible, validation emoji, retrait explicite et conservation du titre chiffré après cutover |
| Types | `bun run typecheck` | les neuf workspaces et le projet racine passent en parallèle |
| Régression Web complète | `bun run --bun vitest run --project web` | 68 fichiers et 397 tests passés ; les anciens composants de lien ne sont plus présents |
| Liens page/Web complets | `MYOWNNOTION_E2E_JOBS=5 bun run test:e2e:local -- tests/e2e/page-links.spec.ts` | 5/5 profils passés ; création séparée, validation URL, clic droit, clavier, retarget, retrait, reload et caret |
| Identité dynamique d'une référence | matrice ciblée `page-links` + `block-editor`, cinq profils en parallèle | 5/5 profils passés en 58 s ; emoji, renommage, conversion et persistance sans alias éditable |
| Emoji hors ligne et géométrie | `MYOWNNOTION_E2E_JOBS=5 bun run test:e2e:local -- tests/e2e/hierarchy.spec.ts --grep "one emoji identity"` | 5/5 profils passés en 37 s ; sélection locale hors ligne, reprise automatique, recherche, reload et déplacement du libellé ≤ 1 px |
| Chevron et états de branche | `bun run test:e2e:local -- tests/e2e/keyboard-navigation.spec.ts --grep "what a branch says when it has nothing to show"` | 5/5 profils passés en 47 s ; la zone du chevron reçoit le pointeur avant son apparition et l'icône superposée ne l'intercepte jamais |
| Références visuelles macOS | `bun run test:e2e:local -- tests/e2e/v1-surface-visuals.spec.ts --project=chromium-desktop` | recherche claire et base sombre passées après inspection et mise à jour intentionnelle ; les deux références mobiles sont ignorées sur ce projet par conception |
| Références visuelles Linux | image épinglée `mcr.microsoft.com/playwright:v1.62.1-noble`, Chromium desktop, base jetable migrée | recherche claire et base sombre régénérées puis rejouées sans mode mise à jour dans leur environnement natif |
| Statique | `bun x biome ci . --reporter=github` et `git diff --check` | passés ; aucune référence exécutable à l'ancien dialogue unifié |
| Gate pré-push exact | `bun run checks:local` | passé sur le commit destiné à la branche : outillage, shell, format/lint, types, couverture, performance, PostgreSQL/migrations/contrats, matrice navigateur complète, builds, images, sécurité, licences et Compose |

Le gate complet et les suites ciblées ferment T287 sans substituer une preuve CI
à la validation locale exigée par `docs/development.md`.

## Ligne d'arbre et pièces jointes compactes — 2026-08-28

La ligne entière d'une page ou d'un dossier est maintenant la prise de
déplacement de la sidebar ; les contrôles qu'elle contient restent des actions
indépendantes. Le survol remplace l'emoji par le chevron sans déplacer le
libellé. Pour une page, les actions suivent l'ordre validé pièces jointes, `+`,
`…` ; pour un dossier, l'ordre est `+`, `…`. Le `+` ouvre dans la même ligne les
choix page-plus et dossier-plus, tourne en croix et se referme avec la même
transition, sans modifier la géométrie de la ligne.

Les pièces jointes prolongent désormais la ligne sélectionnée dans une région
compacte. L'ouverture ne change ni sa largeur ni sa hauteur ; l'état vide tient
sur une ligne et l'état rempli expose d'abord nom, taille et compteur. Les
détails et actions existants restent disponibles dans un niveau secondaire.
Les descendants et panneaux utilisent la même région repliable paresseuse : la
fermeture est symétrique et ne laisse aucun espace résiduel.

L'identité titre/emoji reste portée par l'élément canonique commun. Un dossier
ouvert utilise le même éditeur d'identité que la page, puis les mêmes mutations,
projection locale, outbox et synchronisation. Aucun second champ ou modèle
spécifique au dossier n'a été ajouté.

Le gate a également rendu les contrôles locaux indépendants du `.env` de la
machine. Le conteneur Firefox fixe ses ports et son origine internes, et le test
du CLI de sécurité fixe explicitement le mode de cookie attendu. Ces changements
n'altèrent pas la configuration de production ; ils empêchent une instance
locale HTTPS/Compose de détourner une suite jetable.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composants ciblés | invocation Vitest Web sur `hierarchy-explorer`, `tree-drag-drop`, `navigation-inline-create`, `attachment-panel` et `page-title-editor` | 5 fichiers et 24 tests passés ; prise DnD de ligne, ordre des actions, focus clavier, géométrie stable, états vide/rempli et identité dossier |
| Journeys modifiés | matrice parallèle des 11 parcours concernés dans `files`, `hierarchy`, `item-conversion`, `keyboard-navigation` et `workspace-shell` | Chromium desktop/mobile, Firefox desktop et WebKit desktop/mobile passés ; pointeur, clavier, création enfant, animations, pièces jointes et titre/emoji dossier |
| Gate pré-push exact | `MYOWNNOTION_E2E_API_PORT_BASE=13301 MYOWNNOTION_E2E_WEB_PORT_BASE=15473 bun run checks:local` avec Bun 1.4.0 et les outils épinglés | passé : 315 fichiers et 3 228 tests de couverture, 18 tests de performance, 332 intégrations PostgreSQL, 12 migrations, 108 fichiers et 1 232 tests de contrat, matrice Playwright 5/5 à concurrence bornée, builds, images API/Web `amd64`/`arm64`, audit, secrets, analyse statique, licences et Compose |

La matrice complète rejoue aussi les parcours de liens internes/Web, le caret et
la suppression conservatrice d'une marque. Les suites de synchronisation
opérationnelle, WebSocket, convergence hors ligne et absence de 90 jours restent
vertes. Cette tranche ne rouvre donc ni le modèle de lien ni le protocole de
synchronisation ; elle améliore leur présentation et leurs points d'entrée sans
régression fonctionnelle observée. La portée d'ergonomie reste le clavier, le
focus visible, le pointeur, le toucher et les navigateurs pris en charge, sans
campagne VoiceOver.

### Conformité stricte à la maquette versionnée — 2026-08-29

La passe précédente avait traduit la proposition visuelle en exigences puis en
tâches, mais cette double reformulation avait laissé passer plusieurs écarts. La
maquette approuvée est désormais conservée directement dans
[`assets/sidebar-attachments-v3.html`](./assets/sidebar-attachments-v3.html) et
constitue le contrat d'interaction normatif de cette tranche. La première copie
exacte portait le SHA-256
`a5425e7ea4da476a0982f4b07f3b5cdbbbaaceaa2e51221e2f469804962d6032`.
Après inspection de la première capture réelle, le propriétaire a supprimé
l’ombre et le volume excessif de la surface. Une première correction à
84 × 30 px portait le SHA-256
`e7d431951eef79099125996dfd8cb19c6b79fb56052d880ee6b954caef939636`, mais sa
capture a révélé une nouvelle perte : le fond avait été supprimé avec l’ombre et
les commandes semblaient libres dans la ligne. Le contrat courant exige donc
une enveloppe visible de 88 × 30 px, une respiration régulière de 1 px autour
et entre ses trois commandes, et toujours aucune ombre extérieure. Son SHA-256
courant est
`a191207f6bb1b4d0b9fddf246949dcab5a2c86be0959e829ae449d84caf69bbb`. Les états
précédents restent disponibles dans l’historique Git. La maquette est exclue
très précisément des réécritures automatiques afin que formatage et lint ne
puissent pas modifier le contrat visuel.

La comparaison a conduit aux corrections suivantes : commande de fermeture
dans l'en-tête et commande opposée dans le document, panneau desktop conservé
pendant sa transition puis inerté, chevron droit unique tournant de 0 à 90
degrés, ouverture/fermeture symétrique des descendants et pièces jointes,
surface page-plus/dossier-plus/croix entièrement contenue dans la ligne, et
trombone discret raccordé au panneau compact. Les captures de contrôle ont été
produites sur un workspace jetable sombre pour les états normal, création
ouverte, zéro fichier, un fichier et sidebar masquée. La première capture de
création a été rejetée par le propriétaire : les boutons conservaient des fonds
séparés, la surface mesurait 92 px et une ombre la faisait lire comme un popover.
La deuxième capture réelle a aussi été rejetée : elle montrait bien trois
commandes compactes dans la ligne et aucune ombre, mais plus l’enveloppe visible
qui doit les contenir. La cible courante est la troisième correction : fond
distinct de la ligne, arrondis et respiration uniformes, trois commandes
réellement enfants de cette enveloppe, sans ombre ni déplacement de ligne. Les
rectangles, le fond calculé et les frames intermédiaires sont verrouillés par
les journeys permanents.

La validation a aussi découvert que deux anciens serveurs Vite écoutant
uniquement sur `::1` pouvaient échapper au contrôle de ports IPv4 et faire
réutiliser un ancien bundle par les profils mobiles. Le lanceur local refuse
maintenant les ports web occupés sur `127.0.0.1` **et** `::1`. Les assertions de
transition ne reposent plus sur une attente temporelle fragile : elles mettent
en pause la vraie transition CSS à 50 %, mesurent sa géométrie, puis la terminent.

Le premier gate complet a enfin détecté un déplacement vertical reproductible
de 2 px au survol d'une sous-page. Les zones de dépôt dépassent volontairement
de la ligne pour rendre les intentions `before` et `after` faciles à viser ; le
masque `overflow: hidden` de la région animée transformait alors cette région en
scroller programmable de deux pixels. Le déplacement automatique effectué par
le navigateur avant un survol repositionnait ce scroller invisible. Le masque
utilise désormais `overflow: clip` : il conserve exactement l'ouverture
progressive de la maquette sans introduire d'état de scroll. Le test garde sa
tolérance stricte d'un pixel, enrichit son diagnostic géométrique et passe dans
les deux thèmes sans mise à jour opportuniste des captures de référence.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composants ciblés | Vitest Web sur `workspace-shell`, `item-icon`, `hierarchy-explorer` et `navigation-inline-create` | 4 fichiers, 21 tests passés |
| Maquette canonique | SHA-256 de l'asset versionné et assertions 88 × 30 px / enveloppe visible / trois commandes / aucune ombre | contrat courant `a191207f6bb1b4d0b9fddf246949dcab5a2c86be0959e829ae449d84caf69bbb` |
| Journeys de conformité | matrice locale ciblée sur fermeture de sidebar, création intégrée, chevron/descendants, trombone/pièces jointes et stabilité au survol | 5/5 profils passés en 39 s, deux stacks au maximum en parallèle |
| Correction sans ombre | même parcours page/dossier/croix, géométrie adaptée au pointeur et aucune ombre | 5/5 profils passés en 51 s ; capture ensuite rejetée faute d’enveloppe visible |
| Enveloppe visible intégrée | fond distinct, 88 × 30 px, respiration de 1 px et trois commandes enfants | 5/5 profils passés en 38 s ; fond calculé non transparent et ombre `none` |
| Capture des cinq états | profil Chromium desktop isolé et base jetable | deux captures de création rejetées ; troisième capture inspectée dans la ligne et isolément sur son rectangle réel de 88 × 30 px |
| Statique et types | `bunx biome check .` puis `bun run typecheck` | 896 fichiers sans diagnostic ; 9 workspaces et le projet racine typés |
| Premier gate pré-push | `PATH=/tmp/myownnotion-ci-tools:$PATH bun run checks:local` sur `f35181e2` | interrompu volontairement pendant les performances dès réception du retour visuel ; ce commit n'est pas publiable |
| Deuxième gate pré-push | même commande sur `c5fa48da` | interrompu volontairement pendant les performances dès réception du retour sur l’enveloppe absente ; ce commit n’est pas publiable |
| Gate pré-push exact | `PATH=/tmp/myownnotion-ci-tools:$PATH bun run checks:local` sur `d70ec9ca` | passé avec code nul : politique d’outillage et shell, format/lint/types, 315 fichiers et 3 232 tests de couverture, 7 suites de performance, 332 intégrations PostgreSQL, migrations, 108 fichiers et 1 232 contrats, matrice Playwright 5/5 en 1 373 s à concurrence bornée, builds Bun, images API/Web `amd64`/`arm64`, audit, secrets, analyse statique, licences et contrat Compose |

La commande a terminé avec un code nul sur `d70ec9ca`, le commit exact qui porte
le code destiné à la branche. La clôture documentaire de T303 est isolée dans un
commit sans consommateur exécutable ; elle suit donc le gate documentaire défini
dans `docs/development.md` sans invalider la preuve applicative du commit testé.

### Stabilisation du menu de pièce jointe après merge

La CI du merge `bc12367a` a reproduit deux fois sous forte charge WebKit desktop
un clic reçu par le `<summary>` natif sans changement de son état `open`. Le
rapport Playwright et ses snapshots confirment que la cible restait présente et
que l'action native, intermittente, était la seule frontière en échec. Le menu
secondaire utilise désormais le popover Ariakit commun : bouton explicite,
fermeture par `Échap`, retour de focus, réouverture par `Entrée` et contenu gardé
dans le tiroir modal sur mobile.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Reproduction initiale | parcours `the file surfaces` sur WebKit desktop | le parcours isolé pouvait passer alors que la trace CI montrait deux échecs identiques du disclosure natif |
| Répétition WebKit | mêmes parcours avec `--repeat-each=5` | 5 répétitions complètes passées après remplacement par le popover explicite |
| Parcours fichiers WebKit | `tests/e2e/files.spec.ts` puis parcours clavier ciblé | suite fichiers complète passée ; `Échap`, retour de focus, `Entrée`, remplacement et actions restent utilisables |
| Matrice ciblée finale | fichiers et surfaces associées, cinq profils lancés en parallèle | Chromium desktop/mobile, Firefox desktop et WebKit desktop/mobile passés en 33 s |

### Stabilisation du sélecteur de page sous WebKit mobile

Le gate pré-push suivant a découvert une seconde frontière WebKit mobile dans
un parcours de lien interne. La trace montrait d'abord un `beforeinput` sans
`inputType`, puis un remontage de la toolbar entre le formatage en gras et le
clic suivant. L'événement incomplet provoquait une erreur JavaScript et la
sélection mémorisée appartenait au composant remplacé ; le bouton recevait bien
le clic, mais ne possédait plus de plage utilisable pour ouvrir le sélecteur.

Le gestionnaire traite désormais l'absence d'`inputType` comme une saisie
ordinaire et la sélection est conservée au-dessus du composant flottant que
BlockNote peut remonter. Le journey collecte explicitement les erreurs de page,
de sorte qu'un dialogue visible ne puisse plus masquer une exception pendant
la saisie.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Reproduction du gate | matrice E2E complète à concurrence 2 | 4/5 profils passés ; WebKit mobile a exposé l'exception `inputType` puis la perte de sélection |
| Répétition WebKit mobile | parcours de formatage et lien interne avec `--repeat-each=20` | 20/20 passés sans retry ni erreur JavaScript |
| Matrice ciblée finale | même parcours, cinq profils lancés en parallèle | Chromium desktop/mobile, Firefox desktop et WebKit desktop/mobile passés en 29 s |

Le nouveau gate complet est exécuté sur le commit exact destiné au push.

### Stabilité du focus dans le sélecteur emoji

La première CI de la PR a classé comme flaky le journey d'identité emoji sous
Chromium mobile : le bouton filtré recevait le focus, puis un rerender parent
renouvelait `onSelect`, recréait toute l'instance Emoji Mart et remplaçait le
nœud focalisé. Le panneau garde désormais la même instance tant qu'il reste
ouvert et transmet chaque sélection au callback React courant par une référence
stable. Le test composant verrouille à la fois l'identité du nœud, le focus et
l'appel du callback le plus récent.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Répétition Chromium mobile | journey d'identité emoji avec `--repeat-each=20` | 20/20 passés sans retry ; focus conservé pendant les rerenders hors ligne |
| Matrice ciblée finale | même journey, cinq profils lancés en parallèle | Chromium desktop/mobile, Firefox desktop et WebKit desktop/mobile passés en 28 s |

Le gate complet est exécuté sur le nouveau commit exact avant le prochain push.

### Stabilisation de la conformité sous charge CI

La première CI de la PR de conformité a validé 23 jobs et révélé deux courses
réelles dans les journeys desktop. WebKit démontait le contenu paresseux avec
un timer égal aux 210 ms CSS : lorsque le test mettait la transition réelle en
pause à mi-course, le timer pouvait supprimer le contenu avant la dernière
frame. La région attend désormais son propre événement `transitionend` ; un
fallback de deux secondes ne sert qu'aux moteurs ou préférences qui omettent
l'événement, alors que la région fermée reste déjà sans hauteur, cachée et
inerte.

La trace Firefox a montré un second défaut produit : après le retrait d'un lien
interne et la saisie de « Nouveau texte », la projection visible était correcte,
puis l'ancien lien réapparaissait. Le moteur avait adopté un front distant mais
BlockNote attendait encore la fenêtre calme avant de l'afficher. Une nouvelle
frappe pouvait donc utiliser l'ancien arbre visible comme base. Une adoption
distante est maintenant projetée synchroniquement quand aucun geste ni commit
local n'est actif ; elle reste différée pendant une véritable saisie afin de ne
jamais déplacer ses offsets.

| Couche | Commande | Résultat |
| --- | --- | --- |
| Composants et adaptateurs | Vitest Web sur région repliable, projection distante, saisie et liens | 4 fichiers, 34 tests passés |
| Fermeture WebKit ciblée | journey du chevron desktop répété cinq fois dans Linux | 5/5 passés sans retry |
| Retrait de lien Firefox ciblé | journey exact de la CI répété vingt fois dans Linux | 20/20 passés sans retry ; texte conservé et aucun lien ressuscité |
| Statique et types ciblés | Biome sur les fichiers corrigés, `git diff --check`, puis `bun run typecheck` | aucun diagnostic ; 9 workspaces et le projet racine typés |
| Gate pré-push exact | `PATH=/tmp/myownnotion-ci-tools:$PATH bun run checks:local` sur `8fe63ac2` | passé avec code nul : outillage et shell, format/lint/types, 316 fichiers et 3 236 tests de couverture, 7 suites de performance, 332 intégrations PostgreSQL, migrations, 108 fichiers et 1 232 contrats, Playwright 5/5 en 1 375 s, builds Bun, images API/Web `amd64`/`arm64`, audit, secrets, analyse statique, licences et contrat Compose |

Le gate complet a terminé avec un code nul sur `8fe63ac2`. Cette clôture
documentaire ne possède aucun consommateur exécutable et suit donc le gate
documentation-only de `docs/development.md`. La seconde CI, la fusion, la CI de
`main` et le redéploiement local restent la frontière de clôture T306.

## Limites encore ouvertes

Cette validation ne clôt pas les tâches transverses de la phase 10 : budgets de
performance restants, compatibilité avant, fuzz/limites, audit de sécurité,
rollback de migration, retrait définitif du chemin Tiptap/replace, documentation
d'architecture, scénarios manuels et essai d'utilisabilité.

La tranche prouve donc le parcours de synchronisation implémenté aujourd'hui ;
elle ferme US6 mais ne prétend pas encore que toute la V1 est terminée.
