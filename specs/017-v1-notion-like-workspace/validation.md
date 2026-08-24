# Validation — Feature 017

Dernière mise à jour : 2026-08-24
Tranche validée : US5, synchronisation éditoriale convergente et migration v2

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
- le statut « synchronisé » n'est atteint qu'après confirmation de la frontier
  serveur et adoption de l'état durable par la session ouverte.

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
| Mutation v2 en attente | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-protocol-migration.spec.ts` | 5 profils passés |
| Brouillon structuré sous projection concurrente | `MYOWNNOTION_E2E_JOBS=2 pnpm test:e2e:local -- tests/e2e/databases-views.spec.ts --repeat-each=5` | 25/25 exécutions passées, cinq par profil |
| Convergence générée | `pnpm exec vitest run --project page-state tests/checkpoints.property.spec.ts tests/multi-device-convergence.property.spec.ts` | 2 fichiers, 23 tests passés, dont 10 rejeux de rollover et 1 000 suites ; seed par défaut `170191` |
| Longue absence | `pnpm exec vitest run --project api-contract tests/page-operation-long-absence.integration.spec.ts` | 1 scénario passé : 90 jours, 10 000 updates distantes puis 1 locale, durée 150,55 s |
| Régressions API ciblées | `pnpm exec vitest run --project api-contract tests/page-operation-service.integration.spec.ts tests/page-operation-compaction.integration.spec.ts tests/page-operations.contract.spec.ts` | 3 fichiers, 27 tests passés |
| Contrats API et workspace après correction du cycle de vie | `pnpm test:contract` | 93 fichiers, 1 147 tests passés ; longue absence en 153,34 s, aucun rejet différé |
| Typage | `pnpm typecheck` | 9 projets passés |
| Couverture complète | `CI=1 pnpm test:coverage` | 263 fichiers, 2 895 tests passés, 90,21 % de lignes et 85,19 % de branches |

Les cinq profils navigateur sont Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop. Chaque profil utilise sa propre base, son
propre serveur et ses propres ports ; les cinq stacks ciblées ont été lancées
en parallèle.

## Incidents révélés par les preuves

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

## Limites encore ouvertes

Cette validation ne clôt pas les tâches suivantes :

- T190 : budgets dédiés de débit, catch-up, compaction et mémoire sur le runner
  de performance ;
- les blocs riches et fichiers restant à terminer en US3 ;
- la finition visuelle et les surfaces restantes en US6/US7.

La tranche prouve donc le parcours de synchronisation implémenté aujourd'hui ;
elle ne prétend pas encore que toute la V1 est terminée.
