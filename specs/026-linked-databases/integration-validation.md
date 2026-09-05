# Intégration 026 + 027 sur l'audit 025

Date : 2026-09-05. Branche locale `codex/026-linked-databases-integration`,
worktree isolé `mon-feature-integration/MyOwnNotion`. Aucun push, PR ni gate
complet depuis cette intégration. Le checkout utilisateur et les worktrees
de l'audit et du desktop n'ont pas été modifiés.

## Composition précise

Base assignée : `1104822cabe3d8f5ec76800a841c8ff5aa7f4ceb`, qui contient
l'audit 025, les sauvegardes 024 et le desktop/UI intégrés par le parent.
Seuls les cinq commits fonctionnels demandés ont été repris, sans conflit :

| Commit d'origine | Commit intégré | Contenu |
| --- | --- | --- |
| `e055c765` | `dd94bd3e` | Spécification et direction produit 026 |
| `a03e14a9` | `afd447c5` | Sources autonomes, emplacements et migration 0016 |
| `d5070958` | `34b98ca2` | Chargements protégés groupés et projection incrémentale |
| `12fd98f8` | `126fa15a` | Vues réutilisables, pagination et entrées sans placement par défaut |
| `499d1419` | `e3688f52` | Blocs de code éditables, coloration et copie 027 |

La constitution 3.4, le canvas et les artifacts 026/027 ont été relus.
La source reste indépendante de ses pages hôtes. Une entrée créée depuis une
vue conserve une page canonique sans placement hiérarchique implicite ; les
placements fournis explicitement restent préservés. Aucune migration autre
que 0016 n'est ajoutée par ces deux features. Les changements MCP et import
Notion ne sont pas inclus dans cette étape.

## Préservation des corrections de l'audit

La fonction `indexedCriterion` de `apps/api/src/databases/database-query-service.ts`
est identique à celle de la base assignée, avec l'import et l'appel de
`prepareDatabaseFilterOperand`. Les modifications 026 de ce service concernent
les lectures de projection ; elles conservent la normalisation canonique des
opérandes, notamment `+02.00` et les dates avec fuseau.

Une comparaison mécanique avec la base confirme l'absence de modification
dans `apps/api/src/files/`, `apps/api/src/backup/full/`, les services
`file-storage-transition-guard.ts` et `rotation-policy-service.ts`,
`packages/blob-store/src/` et
`packages/client-core/src/files/pending-file-transfer-store.ts`. Les plafonds
mémoire/chunks et les références de fichiers authentifiées de l'audit restent
donc présents. Les lectures groupées 026 gardent les versions exactes des
valeurs, le choix déterministe de la dernière version et le refus des
enveloppes manquantes ou corrompues ; la projection n'ouvre pas les corps de page.

## Contrôles exécutés sur cette combinaison

- `bun install --frozen-lockfile` : réussi, sans changement de `bun.lock`.
  Journal : `/tmp/mon-feature-integration-install.log`.
- `bun run format:check`, `bun run lint:ci` et `bun run typecheck` : réussis
  pour le monorepo, y compris les types E2E. Journaux :
  `/tmp/mon-feature-integration-format.log`,
  `/tmp/mon-feature-integration-biome.log` et
  `/tmp/mon-feature-integration-types.log`.
- 28 suites ciblées, 186 tests réussis : API sources réutilisables,
  chargement PostgreSQL protégé, requêtes/normalisation, sécurité, références
  de fichiers authentifiées, migration/cycle de vie/parité SQL, chiffrement,
  mutations et réconciliation locales, domaine, vues/pagination/accessibilité
  et trois suites des blocs de code. Journal :
  `/tmp/mon-feature-integration-targeted.log`.
- Deux suites complémentaires, 14 tests réussis :
  `encryption-read-faults.integration.spec.ts` et `export.contract.spec.ts`.
  Journal : `/tmp/mon-feature-integration-extra.log`.
- Contrat CI : 35 tests réussis après correction de l'oubli décrit ci-dessous.
  Journal : `/tmp/mon-feature-integration-ci-impact.log`.

Cela représente 31 suites et 235 tests distincts réussis, avec deux workers
au maximum. Les tests PostgreSQL utilisent leurs bases jetables sur 55433.
Le petit contrat de projection a mesuré 12,2 ms pour reconstruire 24 entrées
chiffrées et 5,05 ms pour actualiser une entrée ; ce relevé ne remplace pas
les budgets de performance du gate complet.

## Convergence de l'inventaire CI

Le premier contrôle `tests/contract/test-impact.spec.ts` a échoué sur deux
assertions : `tests/e2e/code-block-ui.spec.ts` manquait dans l'inventaire
`ci/test-impact.json`. La tâche 027 T014 inscrit ce parcours avec les chemins
de l'éditeur, du document canonique, de l'état de page et de sa route API.
Le contrôle complet des 35 assertions passe après correction. Aucune
modification fonctionnelle supplémentaire n'a été nécessaire à l'intégration.

## Limites et suite de livraison

Les preuves navigateur/visuelles antérieures restent celles des branches
026 et 027, décrites dans leurs validations respectives ; aucune matrice
navigateur ni grand corpus n'a été relancé sur cette intégration pour éviter
le gate desktop concurrent. Ces contrôles ciblés ne valent pas
`bun run checks:local`.

Le parent doit encore intégrer son correctif d'audit 025 T050 sur la reprise
d'une migration gardée dont l'archive précédente manque, puis les features
MCP/import prévues et exécuter les gates complets sur la combinaison finale.
La tâche 027 T012 reste ouverte. Aucun résultat de ces étapes futures n'est
revendiqué ici.
