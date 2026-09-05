# Analyse de cohérence avant implémentation

2026-09-05 : couverture FR-001–010 par T002–T009 et SC-001–004 par T007–T009. Les trois stories sont P1 car la réutilisation sans indépendance des vues ou sans protection contre la suppression n'est pas livrable.

Le report explicite des bases liées de 009 est remplacé par 026. Le registre de sources possède sa révision propre ; conserver les ancres de journal est uniquement une compatibilité interne. Les risques bloquants à tester sont les cascades de hiérarchie, le nettoyage d'historique, les filtres locaux incomplets et les métadonnées privées en clair. Aucune clarification produit supplémentaire n'est nécessaire ; aucune incohérence critique restante avant implémentation.

Clarification de convergence avant T013 : le défaut de placement racine contredisait le modèle des vues réutilisables du canevas §14. FR-012 et T013 imposent la création sans placement implicite, sans filtre UI arbitraire ni suppression des placements historiques. Pas de migration supplémentaire ni changement des autorisations de branche.


## Convergence finale

FR-001–012 et SC-001–005 sont couverts : T002–005 pour identité/registre/protection/synchronisation ; T006–009 pour sources réutilisées et conservation ; T011 pour curseurs, couverture locale et retour ; T012 pour lectures protégées groupées/versionnées ; T013 pour pages d'entrée sans placement implicite. Les 13 tâches sont réalisées. La comparaison finale du code et des artifacts n'a trouvé aucun travail fonctionnel restant dans 026 ; aucune nouvelle tâche n'est ajoutée artificiellement. Les limites de purge planifiée et de démarrage hors réseau non préparé sont explicites dans [validation.md](validation.md). La livraison reste conditionnée au gate global du parent après intégration des corrections 025.
