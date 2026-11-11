# Validation navigateur 057 — reprise du 11 novembre 2026

## Périmètre

Parcours maintenu dans `tests/e2e/database-relations-rollups.spec.ts` : source B vide avec propriété Amount ; relation A → B choisie et persistée ; configuration de Total depuis le schéma de B vide ; création des entrées 10 et 20 ; liens ; Total 30 et formule Double 60 dans table et volet après rechargement. Pas de revendication de parité, offline, réciprocité ou validation multi-navigateurs.

## Isolation et reprise

Avant lancement : inventaire des processus sans Playwright ni runner local actif ; pas de journal `.notion-lab/057-e2e-*` ni de rapport navigateur préalable trouvé. Stack de développement sur 8080 laissée intacte ; aucune fixture contre cette origine. Aucun commit, stash, reset ni modification du code applicatif.

- Essai 1 : `bun run test:e2e:local -- --project=chromium-desktop tests/e2e/database-relations-rollups.spec.ts`.
  - **Code 1 avant lancement navigateur** : PostgreSQL standard tente de publier 5432 déjà occupé par le PostgreSQL dev. Le wrapper a recréé `myownnotion-postgres-1`, resté non démarré ; les services `myownnotion-dev-*` ne sont pas modifiés.
  - Journal réel : `.notion-lab/057-e2e-run-1.log`.
- Essai 2 : isolation par projet Compose et port distinct conformément à `docs/development.md` (section Desktop CI parity and release trust) :

```sh
COMPOSE_PROJECT_NAME=myownnotion-057-e2e \
MYOWNNOTION_DB_PORT=5547 \
DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:5547/myownnotion \
bun run test:e2e:local -- --project=chromium-desktop tests/e2e/database-relations-rollups.spec.ts
```

Le runner alloue une base aléatoire, ports API/web, blobs et clé dédiés ; construit son bundle E2E. Journal `.notion-lab/057-e2e-run-2.log`. **Résultat encore en attente : ne pas interpréter le démarrage PostgreSQL comme une réussite du parcours.**
