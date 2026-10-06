# Validation

Utiliser Bun et les tests database board/query/presentation/import concernés. Le runner E2E direct doit pointer vers PG 55433 avec API base 3901 et Web base 6073 ; ne pas utiliser le wrapper qui modifie l'autre compose local. Livraison sur HTTP 8082 et seuls volumes/images myownnotion-notion-api. Inspecter preview de restauration avant application canonique ; backup vérifié puis readback/idempotence. Aucun token nécessaire pour les snapshots déjà importés.
