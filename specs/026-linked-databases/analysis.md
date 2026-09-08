# Analyse de cohérence avant implémentation

2026-09-05 : couverture FR-001–010 par T002–T009 et SC-001–004 par T007–T009. Les trois stories sont P1 car la réutilisation sans indépendance des vues ou sans protection contre la suppression n'est pas livrable.

Le report explicite des bases liées de 009 est remplacé par 026. Le registre de sources possède sa révision propre ; conserver les ancres de journal est uniquement une compatibilité interne. Les risques bloquants à tester sont les cascades de hiérarchie, le nettoyage d'historique, les filtres locaux incomplets et les métadonnées privées en clair. Aucune clarification produit supplémentaire n'est nécessaire ; aucune incohérence critique restante avant implémentation.

Clarification de convergence avant T013 : le défaut de placement racine contredisait le modèle des vues réutilisables du canevas §14. FR-012 et T013 imposent la création sans placement implicite, sans filtre UI arbitraire ni suppression des placements historiques. Pas de migration supplémentaire ni changement des autorisations de branche.


## Convergence finale

FR-001–012 et SC-001–005 sont couverts : T002–005 pour identité/registre/protection/synchronisation ; T006–009 pour sources réutilisées et conservation ; T011 pour curseurs, couverture locale et retour ; T012 pour lectures protégées groupées/versionnées ; T013 pour pages d'entrée sans placement implicite. Les 13 tâches sont réalisées. La comparaison finale du code et des artifacts n'a trouvé aucun travail fonctionnel restant dans 026 ; aucune nouvelle tâche n'est ajoutée artificiellement. Les limites de purge planifiée et de démarrage hors réseau non préparé sont explicites dans [validation.md](validation.md). La livraison reste conditionnée au gate global du parent après intégration des corrections 025.


## T015 post-implementation consistency review

The correction enforces FR-008's existing finite property/view vocabularies and
adds no property or view kind. The same validator handles legacy source views
and embedded views. Public command refusal tests protect explicit placements,
identities, typed values, conflict parents and impact confirmation. Task mapping
and impact tests verify existing recovery semantics; the bulk relationship
fixture checks the performance path against individual scoped reads. All 15
feature task IDs are unique. Aggregate coverage passes on d1f2911d, while final
full local, PR and main delivery gates remain explicit outstanding work.

## Integrated convergence reopened — 2026-09-08

The complete Chromium run invalidates the earlier functional-convergence
checkpoint: the new editable host/entry types bypassed the old page-creation
journal predicate, and a pending checkbox write reverted its visible state.
T016 and T017 address those runtime gaps under FR-002/003/004/008/010. T018
corrects two obsolete host-ownership expectations and verifies the updated
visual reference only after the host editor is actually ready. The specs keep
their current product behavior; no cascade or implicit placement is reintroduced.
Browser evidence and full delivery remain outstanding for these three tasks.
