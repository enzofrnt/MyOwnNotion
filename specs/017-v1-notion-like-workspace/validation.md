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
| Modèle opérationnel | `pnpm exec vitest run --project page-state` | 8 fichiers, 81 tests passés |
| Stockage et session locale | `pnpm exec vitest run --project client-core` | 29 fichiers, 270 tests passés |
| Adaptateur et intégration web | `pnpm exec vitest run --project web` | 42 fichiers, 249 tests passés |
| API, migration, backup, rétention | `pnpm exec vitest run --project api-contract apps/api/tests/page-operation*.spec.ts apps/api/tests/page-history-consolidation.integration.spec.ts` | 8 fichiers, 53 tests passés |
| SQL et migrations | `pnpm exec vitest run --project database-integration packages/database/tests/page-operations.integration.spec.ts packages/database/tests/migrations.integration.spec.ts packages/database/tests/reference-backups.integration.spec.ts` | 3 fichiers, 17 tests passés |
| Sélection CI | `pnpm exec vitest run tests/contract/test-impact.spec.ts` | 1 fichier, 32 tests passés |
| Deux appareils hors ligne | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-multi-device-convergence.spec.ts` | 5 profils passés |
| Delete/edit récupérable | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-ambiguity.spec.ts` | 5 profils passés |
| Mutation v2 en attente | `MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- tests/e2e/page-protocol-migration.spec.ts` | 5 profils passés |

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

## Limites encore ouvertes

Cette validation ne clôt pas les tâches suivantes :

- T191 : propriété de convergence sur davantage d'entrelacements et d'ordres
  aléatoires ;
- T192 : appareil absent 90 jours, au moins 10 000 updates, compaction,
  révocation et retour ultérieur ;
- les blocs riches et fichiers restant à terminer en US3 ;
- la finition visuelle et les surfaces restantes en US6/US7.

La tranche prouve donc le parcours de synchronisation implémenté aujourd'hui ;
elle ne prétend pas encore que toute la V1 est terminée.
