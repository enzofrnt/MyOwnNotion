# Intégration 026, 027, MCP 013 et import 028 sur l'audit 025

## Première étape : bases réutilisables et blocs de code

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

## Deuxième étape : MCP, import et reprise de migration

La branche `codex/pre-v1-features` part de `29fb2688`, en conservant la branche
026 d'intégration à ce commit. Elle utilise le même worktree isolé. Constitution,
canvas et artifacts 013/028 relus avant intégration. Les commits demandés ont
été repris exactement dans cet ordre :

| Commit d'origine | Commit intégré | Contenu |
| --- | --- | --- |
| `858c3186` | `49ea8cb5` | Spécification MCP |
| `d3f01824` | `004ad7c0` | Accès et outils canoniques MCP |
| `9f85848b` | `bcd42320` | Réglages d'autorisation MCP |
| `e41c53e9` | `3eee120f` | Permissions du fichier de configuration CLI |
| `f8212f58` | `0c10bd7d` | Frontières MCP et nettoyage CLI |
| `3aaaeda8` | `422cd403` | Spécification import Notion |
| `e1c15661` | `f864de5e` | Lecture et conversion bornées des sources |
| `72280874` | `a6de4df1` | Écritures canoniques et reprise protégée |
| `7cf759ea` | `af7a1a93` | Notification SSE des écritures du processus CLI |
| `40fe9659` | `26843029` | Frontières de parsing et reprise |
| `585b595b` | `dcfbbd53` | Audit 025 T050, archive authentifiée avant nouveau SQL |

Les anciennes fondations `f0557643` et `f61aeeca` ne sont pas reprises.
Les seuls conflits concernent `bun.lock` : les dépendances de chaque feature
sont conservées, les doublons identiques vérifiés et l'installation figée passe
sans réécriture du verrou. Aucun conflit de source n'a nécessité une résolution.

### Frontières vérifiées

Le bloc de protection canonique, de `AcceptedContentCommand` à
`handleMutation`, reste identique à `29fb2688`. Son extraction vers
`submitCanonicalMutation` conserve `acceptedWriteGuards`, exécute sa protection
avant l'autorisation déléguée et scelle le contenu avant le checkpoint accepté,
dans la même transaction. Les notifications et projections suivent le commit.

Le chargeur de requêtes 026, sa normalisation des filtres, les fichiers
`protected-file-service.ts`, `protected-upload-service.ts`,
`file-storage-transition-guard.ts`, `backup/full/locks.ts` et le contrat de
placement optionnel ne changent pas. L'ingestion d'import utilise le service
de fichiers protégé et son verrou FILE ; la publication extraite des uploads
conserve la protection et le journal canoniques. Le verrou RUN des sauvegardes
reste présent. L'activation de restauration révoque les connexions/codes MCP
seulement lorsque leurs tables existent, dans la transaction d'activation.

Le parcours protocole ajouté pour 013 T020 crée une source affichée sur deux
pages, puis trois entrées : sans placement, sous l'hôte autorisé, et sous un
hôte privé. Liste/recherche/lecture du scope de branche ne donnent accès qu'à
l'entrée ayant un placement autorisé ; les deux autres lectures ont exactement
le même refus qu'un identifiant inexistant. `allContent` recherche et lit les
trois, et la page sans placement conserve sa liste de placements vide. Aucune
extension de scope par appartenance à une source n'a été ajoutée.

### Ajustements et résultats

L'inventaire CI omettait `tests/e2e/mcp-access.spec.ts` : 013 T019 ajoute ses
chemins propriétaires. Le test historique de migration 026 est explicitement
borné à `throughVersion: "0016_linked_databases"`, y compris son rejeu ; il
continue de vérifier les identités, snapshots et changements durables sans
supposer que 0016 sera toujours la dernière migration du dépôt.

- Installation figée, formatage, Biome et types du monorepo réussis. Journaux :
  `/tmp/mon-pre-v1-install.log`, `/tmp/mon-pre-v1-format.log`,
  `/tmp/mon-pre-v1-biome.log` et `/tmp/mon-pre-v1-types.log`.
- 21 suites et 222 tests distincts réussis, sans test encore en échec ou ignoré
  dans cette sélection après les relances ciblées. Les suites couvrent MCP/API
  et CLI, source/ZIP/conversion/import/reprise, scopes, SSE entre processus,
  reconnexion Web, uploads, sources 026, normalisation de requête, migration
  0016, parité SQL, restauration, migration gardée, UI MCP et inventaire CI.
- La première exécution utilisait un `PATH` sans `pg_dump` 18 : les scénarios
  natifs étaient refusés avant leurs opérations. Avec
  `PATH=/opt/homebrew/opt/libpq/bin:$PATH`, les 20 tests d'import, les 13 tests
  de restauration et les 8 tests de migration gardée passent. Le SQL de test
  9999 garde son propre ledger, conformément au correctif T050.
- Journaux : `/tmp/mon-pre-v1-targeted.log` pour les 16 suites initialement
  réussies ; `/tmp/mon-pre-v1-targeted-native.log` pour les cinq suites
  corrigées/reprises ; `/tmp/mon-pre-v1-mcp-linked-scope.log` pour les 22 tests
  MCP finaux. Le dernier comprend le nouveau scénario 013/026 après correction
  de sa fixture de recherche pour fournir le `branchRootId` requis.

La sélection utilise au maximum deux workers et des bases jetables sur 55433.
Aucun corpus personnel n'est appliqué et aucune matrice navigateur ou gate
complet n'est relancé ici. Les preuves navigateur antérieures des features
restent identifiées comme telles.

### Reste à intégrer avant livraison

T050 et le correctif 024 de clés historiques sont désormais intégrés et
disposent de preuves ciblées. Il reste à relancer les gates complets sur le
commit final, puis à obtenir les validations PR et main. Aucun succès de gate
final n'est encore revendiqué.

## Troisième étape : corrections révélées par la couverture globale

Le parent a ajouté le correctif T051 (`aa4fe59a` repris en `386ba498`) puis lancé
la couverture globale sur ce commit. Le run a échoué avec 3 tests et 1 rejet
non géré, pour 4 061 tests réussis ; aucun chiffre final de couverture n'est
revendiqué. Journal du parent : `/tmp/mon-pre-v1-coverage-integrated.log`.

Les corrections de convergence 026 T014 et 013 T021 portent sur les contrats
et fixtures concernés, sans changement de code fonctionnel :

- `CreateEntryRequest` dans l'OpenAPI 009 documente désormais `placement`
  comme optionnel, conformément au runtime et à 026 FR-012. L'absence crée
  une page d'entrée sans placement ; le champ explicite reste documenté.
- Le test de migration d'une page format-v2 reste une mise à niveau complète
  jusqu'au schéma actuel : sa liste attendue inclut 0017. Il continue de prouver
  que le corps historique reste inchangé et sans activation opérationnelle.
- Le test historique du schéma chiffré de fichiers est borné à 0015 pour sa
  migration et son rejeu, comme son scénario l'exige. Ses assertions sur les
  identités, uploads acquittés, transitions, contraintes et cascades restent
  inchangées ; les tests de migration complète et de parité restent distincts.
- Le mock `SecurityApi` d'`app-routing.spec.tsx` fournit les trois lectures MCP
  désormais montées par les réglages. Elles renvoient le résultat d'indisponibilité
  typé déjà utilisé par les autres panneaux de cette fixture, au lieu de méthodes
  absentes provoquant un `TypeError`.

Validation ciblée : **4 suites, 63 tests réussis en 12,58 s**, sans rejet non géré
(`openapi`, `migrations.integration`, `protected-file-schema.integration`,
`app-routing`). Les types du monorepo, formatage, Biome et `git diff --check`
passent. Journaux : `/tmp/mon-pre-v1-combination-fixes.log`,
`/tmp/mon-pre-v1-combination-types.log`, `/tmp/mon-pre-v1-combination-format.log`
et `/tmp/mon-pre-v1-combination-biome.log`.

Aucune couverture globale supplémentaire ni push depuis cette correction.
Le parent relancera la couverture et les gates après l'intégration du correctif
de clés historiques 024. Les budgets et exclusions n'ont pas été modifiés.

## Latest audit candidate — `ca2174cd83fa328f8df808d2ccce5a66061c8999`

The candidate adds focused cross-feature evidence after the earlier 026/027,
MCP and import integration report:

- 026's PostgreSQL database integration matrix at `ca2174cd` proves atomic
  rejection of invalid hosts, containment parents, structured values and
  relation targets. Follow-up `4da2c2f9` adds the complete direct row-absence
  assertions for the missing-parent case; valid explicit, root-normalized and
  unplaced entries remain supported.
- 024's backup status and rehearsal HTTP/OpenAPI contracts now enumerate their
  authenticated refusal variants and redact unexpected failures. The focused
  backup contract suites are part of the same candidate.
- The candidate also carries page-state edge/property coverage and canonical
  export contract coverage used by the broader storage audit. These checks do
  not add a code-block UI implementation proof for 027 or a Notion import
  delivery proof for 028.

The implementation commit supplies T023's initial matrix and completes T033.
Follow-up commit `4da2c2f9aece80b109ec15551b78af1cae4b76eb`
completes T023's direct rollback assertions for a missing containment parent;
the two commits together close T023. Feature 027 T012 and feature 028
T021 remain open until the complete local gate, every PR check, merge and main
CI are verified on the final integration commit. No personal Notion source was
applied.
