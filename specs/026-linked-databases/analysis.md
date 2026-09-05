# Analyse de cohérence avant implémentation

2026-09-05 : couverture FR-001–010 par T002–T009 et SC-001–004 par T007–T009. Les trois stories sont P1 car la réutilisation sans indépendance des vues ou sans protection contre la suppression n'est pas livrable.

Le report explicite des bases liées de 009 est remplacé par 026. Le registre de sources possède sa révision propre ; conserver les ancres de journal est uniquement une compatibilité interne. Les risques bloquants à tester sont les cascades de hiérarchie, le nettoyage d'historique, les filtres locaux incomplets et les métadonnées privées en clair. Aucune clarification produit supplémentaire n'est nécessaire ; aucune incohérence critique restante avant implémentation.
