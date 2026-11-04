# Audit complet — 4 novembre 2026

Audit indépendant du dépôt **MyOwnNotion** au commit `f32f0ae3`
(branche `ci/faster-playwright-shards`, 1 commit au-dessus de `main` =
`c3ea5d90`). Lecture seule : aucun fichier source n'a été modifié. Les notes de
travail détaillées par axe sont dans `work/audit-2026-11/` (répertoire ignoré
par Git) ; ce document les consolide et conserve les preuves.

> **Correctifs appliqués le 4 novembre 2026** : voir
> [2026-11-remediation.md](2026-11-remediation.md). Le présent audit reste la
> photographie du HEAD `f32f0ae3` avant correction.

### Revalidation sur `main` et branche de travail

L'audit a été produit sur `f32f0ae3`, qui différait de `main` (`c3ea5d90`) par
**14 fichiers de CI, docs et specs uniquement** ; `git diff origin/main..f32f0ae3
-- apps packages package.json bun.lock` était vide. Tous les constats de code
(dépendances, D01, accessibilité, front, données, architecture) restent donc
valables sur `main`. La branche de sharding a été supprimée (locale et
distante) ; le travail continue sur `fix/audit-remediation`, créée depuis
`main`.

Deux constats étaient spécifiques à cette branche et **ne s'appliquent pas à
`main`** :

- **R01** : le plafond de 30 min du job `unit` n'existe que sur la branche
  jetée ; `main` n'a pas de `timeout-minutes` sur ce job. La duplication
  `test:coverage` / jobs DB reste un coût, mais pas un gate temporel.
- **R11** : le sharding E2E (`journeysPerShard`/`maxShards`) n'existe pas sur
  `main` ; il n'y a donc pas de déséquilibre de shards à corriger.

En revanche, la revalidation a révélé un point que la branche corrigeait et
qu'il ne faut pas perdre en la supprimant : **`main` utilisait encore
`ubuntu-latest` sur 22 jobs de `ci.yml` et 4 jobs de release**, alors que
l'alias est passé à Ubuntu 26 le 2026-10-19 et casse l'installation du client
PostgreSQL 18 épinglé. Le pinning `ubuntu-24.04` a été repris sur la nouvelle
branche (sans le sharding), avec la note correspondante dans
`docs/development.md`. Sur `main`, la feature 016 compte **35/35 tâches**, pas
38/38.


Méthode : inspection du code et de la configuration, exécution des gates
statiques locaux, build de production, tests unitaires non-DB, audit de
dépendances, consultation de l'état GitHub (`gh`). Docker et PostgreSQL ne sont
pas disponibles sur la machine d'audit : **aucun test DB, E2E, restauration,
packaging desktop ni exécution applicative** n'a été réalisé. Les affirmations
de comportement sont donc établies par lecture du code, sauf mention contraire.

---

## Verdict en 30 secondes

| Question | Réponse |
| --- | --- |
| **Peut-on continuer le développement ?** | **Oui.** Pas d'impasse architecturale, pas de P0 dans le code applicatif, base saine et bien testée. |
| **Peut-on merger le HEAD aujourd'hui ?** | **Non.** Le job `dependency-vulnerability-audit` est rouge (8 vulnérabilités `high`), donc `quality-gate` échoue. C'est le seul échec du dernier run. |
| **Peut-on déclarer la V1 ?** | **Non.** Desktop jamais livré (0 tag, 0 release, 0 installateur), feature 021 non planifiée, preuves de release 002/008 ouvertes, 105 tâches ouvertes dont 49 sur la feature 029. |
| **Faut-il s'inquiéter de la qualité du code ?** | **Non, mais…** La discipline est excellente (0 TODO, 0 `as any`, typage strict, 46 % de tests), avec des angles morts réels : code mort, tests qui passent à vide, accessibilité, poids du front. |

**En une phrase :** le socle est solide et le développement peut reprendre, mais
il faut d'abord débloquer le gate de dépendances, corriger la collision de
définition des bases multi-sources (D01) et deux défauts d'accessibilité (U01/U02)
avant de bâtir la suite ; la V1, elle, reste à plusieurs semaines de livraison.

---

## 1. État du dépôt et de la CI

| Élément | État constaté |
| --- | --- |
| `main` | `c3ea5d90` (merge PR #182, 2026-10-08). Dernier run `main` **vert**. |
| HEAD local | `f32f0ae3`, 1 commit de plus que `main` (sharding E2E + docs CI). Diff : 14 fichiers CI/docs, **aucun code applicatif**. |
| PR #183 (branche courante) | **Fermée sans fusion** le 2026-11-04 après des runs rouges. Aucun PR ouvert, aucune issue ouverte. |
| Run PR #183 `41528996761` (branche supprimée depuis) | 40+ jobs verts (tests unitaires, DB, contrats, 15 shards Playwright, desktop 5 OS, build images, sécurité statique…) ; **seuls échecs : `dependency-vulnerability-audit` et `quality-gate`** (conséquence directe). |
| Manifestes de dépendances | Identiques entre `origin/main` et HEAD : un re-run de `main` échouerait **aussi** aujourd'hui sur l'audit de dépendances. « `main` verte » est donc un état historique, pas l'état courant. |
| Tags / releases | **Aucun tag, aucune release GitHub** (`git ls-remote --tags` vide, `gh api .../releases` = 0). |
| Features | 38 spécifications ; **105 tâches ouvertes** sur 14 features. Feature active : **029** (12/61 terminées). |
| État de travail | Arbre suivi propre ; seul `.tools/` (binaire `shfmt` local) est non suivi. |

Le récit « post-merge `main` en attente d'un run rouge » qui figure dans
`docs/audits/2026-09-pre-v1.md` et dans plusieurs `Status` de specs est
**périmé** : `main` a réussi six runs depuis le 2026-09-14. À l'inverse, la
feature 029 a déjà une implémentation substantielle dans `main` (commit
`38d2a9b1`, migrations `0019`/`0020`, page de base, bloc `databaseView`) alors
que sa spec, sa roadmap et 49 tâches la présentent comme à venir. Le registre
de livraison est inversé dans les deux sens, ce qui fait perdre du temps et
donne une fausse idée de ce qui reste.

---

## 2. Gates exécutés localement

| Gate | Résultat | Détail |
| --- | --- | --- |
| `format:check` | ✅ | 1 464 fichiers |
| `lint:ci` (Biome) | ✅ | 1 465 fichiers, **0 erreur**, 106 avertissements non bloquants (59 `noDescendingSpecificity`, 10 `noImportantStyles`, 3 `noConfusingVoidType`, autres) |
| `typecheck` | ✅ | 11 packages + racine, ~19 s |
| Tests unitaires (hors DB) | ✅ sous réserve | **324/325 fichiers, 3 468 tests passés, 4 ignorés** ; le seul fichier en échec (`workspace-contract/tests/contract/export.spec.ts`) ne démarre pas faute de Docker (testcontainers), pas à cause du code |
| `build` production | ✅ | API 11 artefacts, web 33 sorties, 23 assets précachés (10,26 Mo), EXIT=0 |
| `toolchain:check` | ✅ | 2 545 fichiers suivis |
| `security:secrets` | ✅ | 1 968 fichiers, 0 finding |
| `security:static` | ✅ | 1 371 fichiers source, 0 finding |
| `security:licenses` | ✅ | 389 paquets de production, 0 violation |
| `compose:check` | ✅ | services, ports loopback, secrets, images, upgrade temps réel |
| `shell:check` | ⚠️ local seulement | `shfmt` 3.14.1 sur le `PATH` (Homebrew) vs 3.12.0 épinglé ; le binaire vendu `.tools/bin/shfmt` est en 3.12.0. Le job CI « ShellCheck & shfmt » est **vert**. Problème d'environnement local, pas de dépôt. |
| `security:audit` | ❌ | **8 vulnérabilités `high`** (détail ci-dessous) |
| Couverture | ⛔ non mesurée | Seuils absolus définis dans `vitest.config.ts` (2 216 statements / 1 866 lignes / 337 fonctions / 2 470 branches non couverts max) ; nécessite PostgreSQL. |
| Intégration DB, contrats API, E2E (76 journeys), performance, packaging desktop, images, Trivy | ⛔ non exécutés | Docker/PostgreSQL absents ; preuve CI disponible sur le run PR #183 (tous verts). |

Le gate local documenté (`bun run checks:local`) est donc **rouge en l'état**,
à cause des dépendances et, sur cette machine, de la version de `shfmt`.

---

## 3. Ce qui bloque aujourd'hui (à traiter en premier)

### B1 — P0 workflow : le gate de dépendances est rouge

`bun audit --audit-level=high --prod` échoue avec **8 vulnérabilités `high`** :

| Paquet | Version épinglée | Correctif | Avis |
| --- | --- | --- | --- |
| `@modelcontextprotocol/server` | `2.0.0` | **≥ 2.3.0** | Livraison croisée de messages entre clients HTTP (7,7), épuisement mémoire à la validation (7,5), absence de limite de corps/batch JSON-RPC (7,5) |
| `undici` (override racine) | `7.29.1` | **≥ 7.30.1** | DoS content-encoding, empoisonnement de cache/divulgation cross-origin, contournement TLS, DoS renegotiation TLS 1.2 |
| `zod` (API) | `4.3.6` | **≥ 4.6.6** | Épuisement mémoire sur collections contraintes surdimensionnées |

Le SDK MCP est une **surface V1** (`/mcp`, appairage, jetons) et le handler est
créé par requête, ce qui rend l'avis de transport partagé probablement non
exploitable ici — mais les trois avis restent à corriger par la montée de
version. `zod` valide toutes les entrées API. `undici` est transitif
(desktop/test-utils), mais l'override racine l'épingle délibérément : c'est un
choix à mettre à jour.

À noter, non bloquant : `@fastify/busboy` 3.2.1 est signalé `moderate`
(injection CRLF dans les noms de fichiers multipart) ; correctif **≥ 3.2.2**,
utile puisque l'upload est une surface V1.

**Recommandation :** monter les trois versions, régénérer `bun.lock`, rejouer
`bun run security:audit` puis le gate complet. Vérifier la compatibilité du
protocole MCP (la spec 013 documente une version de protocole) et refaire un
test d'appairage MCP. Effort estimé : court (une PR dédiée).

### B2 — P1 données : collision de définition des bases multi-sources (D01)

L'enveloppe chiffrée d'une définition de base est indexée par
`(page propriétaire, definitionVersion)` **sans la source**
(`apps/api/src/security/protected-content.ts:360-371`). Or chaque source d'une
même base démarre son compteur à 1 (`packages/database/src/repositories/database-repository.ts:283-317`),
et le hook de scellement choisit la **source la plus ancienne**
(`database-repository.ts:140-151`, `apps/api/src/plugins/mutations.ts:155-172`)
tandis que `database.source.create` est absent de la liste des commandes
scellées.

Conséquences dès qu'une base a deux sources : la définition de la 2ᵉ source
n'est jamais scellée ; une avance de version fait lever
`ProtectedContentUnavailableError` à l'export canonique et à la transition de
stockage ; à versions égales, la recherche indexe les valeurs d'une source avec
les libellés d'une autre. C'est déclenchable par l'**import Notion**
(`apps/api/src/imports/notion/apply.ts:256-311`) qui crée plusieurs
`data_source`.

**Recommandation :** inclure `sourceId` dans l'identité de l'enveloppe et dans
les jointures de recherche/export/restauration, sceller `database.source.create`,
puis écrire les trois tests proposés dans `work/audit-2026-11/data.md`
(export à deux sources, recherche à propriétés distinctes, restauration).
**À corriger avant de continuer la feature 029**, qui généralise précisément ce
modèle.

### B3 — P1 sécurité : pipeline de migration chiffrée sans point d'entrée (R03)

`MigrationOrchestrator` (497 lignes) et `MigrationBackfillService` (241 lignes)
n'ont **aucun importeur hors tests**. Le CLI `scripts/db/migrate.ts` passe par
`runGuardedMigrations` (`apps/api/src/backup/guarded-migration.ts`), et le
démarrage API ne les instancie pas. Pourtant les tâches T096/T097 de la spec 002
sont cochées et FR-028/FR-029 sont déclarées livrées.

La bascule V0→V1 (arrêt des écritures en clair, cutover, vérification, scrub)
n'est donc pilotée par aucun point d'entrée de production. Les tests
d'intégration valident une capacité qui ne peut pas s'exécuter.

**Recommandation :** trancher explicitement — câbler l'orchestrateur dans le CLI
de migration/admin avec un test « instancié depuis un point d'entrée de
production », ou supprimer les 738 lignes et corriger la traçabilité de la spec
002. Ne pas laisser une capacité de sécurité déclarée livrée sans chemin
d'exécution.

### B4 — P1 accessibilité : focus clavier et texte d'erreur sous le seuil WCAG

- **U01** : `--ui-color-focus` = `--ui-color-border-strong` (`#c3bfb6`)
  (`apps/web/src/ui/tokens.css:102,432`), utilisé par 32 règles d'outline.
  Contrastes calculés : **1,76:1** sur canvas clair, **1,61:1** sur sidebar.
  WCAG 2.2 SC 1.4.11/2.4.11 exigent 3:1. Au clavier, la position est perdue.
  Correctif : token dédié ≥ 3:1 (par exemple `--ui-color-text-muted`, 5,81:1)
  et 2 px, sans glow.
- **U02** : les messages d'erreur utilisent `--ui-color-danger` `#d56c5e`
  (**3,28:1** clair) au lieu de `--ui-color-danger-text` `#a94338` (**5,68:1**),
  dans 14 sélecteurs vivants (`database.css`, `editor.css`,
  `settings-security.css`, `workspace.css`). Contredit `docs/design/ui-system.md`.

Correctifs peu risqués, mais à confirmer par capture réelle (clair/sombre,
320 px, clavier) conformément à la leçon L-010 du skill UI.

### B5 — V1 : conditions de sortie non satisfaites

Ce ne sont pas des blocages de développement, mais des blocages de release :

1. **Desktop jamais livré** : 0 tag, 0 release, 0 installateur. La spec 014
   l'admet elle-même (`validation.md:75`). Il manque les 9 artefacts
   signés/notarisés, l'installation, la mise à jour N→N+1 et le rollback.
2. **Feature 021 (journaux serveur lisibles) non planifiée** : seulement
   `spec.md` + checklist, pas de `plan.md` ni `tasks.md`.
3. **Preuves de release 002/008 ouvertes** : ledger 002 `pending` (104
   occurrences), protocoles humains T035/T106/T107, validations 008 T081/T082.
4. **029 inversée** : implémentation partielle déjà dans `main`, ledger à
   l'envers, migration `0019` refusant les anciennes bases sans reset explicite.
5. **Tests/Playwright différés** sur des parcours V1 (029, 034, 036, 037, 031,
   032) : la Definition of Done §44 n'est pas atteinte pour ces parcours.
6. **Documentation opérateur §45 incomplète** : pas de guide d'installation
   Compose, kit de récupération, mise à jour/retour arrière, format d'export,
   compatibilité de versions.

---

## 4. Sécurité et contrôle d'accès

Synthèse : architecture **solide sur le fond**, aucun contournement
d'authentification, aucune injection SQL, aucune traversée de chemin. Les
failles sont périphériques mais réelles. Aucun P0/P1 nouveau ; cinq P2 de
disponibilité/durcissement.

| ID | Sév. | Constat | Preuve | Impact / recommandation |
| --- | --- | --- | --- | --- |
| S01 | P2 | Rate limit indexé sur `request.ip` alors qu'aucun `trustProxy` n'est configuré ; `MYOWNNOTION_TRUSTED_PROXY_CIDRS` n'a **aucun consommateur**, contrairement à la doc | `routes/authentication.ts:383` ; `mcp/http.ts:22-27` ; `routes/mcp.ts:116-122` ; `app.ts:306-309` ; `security-config.ts:46-47,194-197` ; `docs/deployment/reverse-proxy.md:59,161` | Derrière le nginx embarqué, tous les clients partagent le bucket `auth.login` (10 essais/15 min) : 11 mauvais mots de passe d'un anonyme bloquent la connexion mot de passe du propriétaire 30 min, renouvelable. La passkey reste utilisable. Même effondrement pour `mcp.request`/`mcp.exchange`. → Configurer `trustProxy: securityConfig.trustedProxyCidrs` + test pair fiable/non fiable. |
| S02 | P2 | Le budget d'auth n'est jamais remis à zéro après succès | `authentication.ts:383` (débit consommé avant vérification) ; `clearRateLimit` n'est appelé que par `bootstrap-service.ts:446` | 10 connexions mot de passe **réussies** en 15 min bloquent 30 min. → Appeler `clearRateLimit` dans `completeLogin` après émission de session. |
| S03 | P2 | Map de challenges WebAuthn non bornée, jamais purgée, alimentée par une route anonyme | `authentication.ts:285-295,325-328` ; `webauthn-service.ts:46-56` ; `http-access.ts:11` | Chaque `POST /v1/auth/login/passkey/options` ajoute ~250-300 octets permanents : DoS mémoire trivial sur l'unique instance API. → Purger à l'insertion + plafond/LRU + rate limit sur `options`. |
| S04 | P3 | Table `security_rate_limits` alimentée sans borne par un sujet choisi par l'appelant | `authentication.ts:310` (`assertion.id` fourni par le corps) ; `rate-limit-service.ts:79-115` | Une ligne définitive par identifiant aléatoire, sans purge. → Indexer sur l'adresse client résolue et ajouter une rétention. |
| S05 | P2 | Limites de taille configurées jamais appliquées ; 64 MiB analysés **avant** authentification | `app.ts:306-309` (`bodyLimit` codé en dur) ; `security-config.ts:52-53,210-219` (aucun consommateur) ; `.env.example:143-145` et `compose.yaml:114-115` annoncent 1 MiB ; auth en `preHandler` | Divergence 64× entre config et comportement : un anonyme fait parser 64 MiB de JSON par requête. Réduire la variable d'environnement n'a aucun effet. → `bodyLimit: securityConfig.maxBodyBytes` + test 413. |
| S06 | P3 | En-têtes de sécurité nginx non hérités par `/` et `/assets/` | `docker/web-nginx.conf:19-23` vs `:78-91` (chaque `location` redéclare `add_header`, ce qui supprime l'héritage) | `index.html` et les assets sont servis sans `X-Frame-Options`, `nosniff`, COOP/CORP ; pas de CSP pour le shell web. → Répéter les en-têtes par snippet `include` + CSP + test contractuel. |
| S07 | P3 | Matériel de clé non zéroté dans `forget()`/remplacement de cache | `key-hierarchy.ts:496-499,533-540` (à comparer à `:290-293`) ; `deployment-key.ts:195` (clé aussi en chaîne JS) | Après révocation/rotation, les octets restent lisibles dans le tas. → `fill(0)` avant suppression ; lire la clé de déploiement en `Buffer`. |
| S08 | P3 | Réponses JSON authentifiées sans politique de cache explicite | aucun hook `onSend` global ; `no-store` seulement sur quelques routes (`files.ts`, `mcp.ts`, `security-recovery.ts`, `security-audit.ts`, `security-rotation.ts`) | Un intermédiaire externe peut cacher des métadonnées privées. → `cache-control: no-store` global sur `/v1` non explicitement cacheable. |
| S09 | P3 | Le statut public révèle la posture de sécurité | `routes/installation.ts:69-103` (`securityReady`, `recoveryReady`) ; route publique | Un anonyme apprend si un propriétaire, un kit confirmé et une clé montée existent. → Ne renvoyer ces champs qu'à un propriétaire authentifié. |

**Vérifié solide :** point d'authentification unique et ordre de hooks sûr ;
CSRF HMAC dérivé de la clé de déploiement + session, comparaison à temps
constant, appliqué aussi aux upgrades WebSocket ; cookies `__Host-`,
`SameSite=Strict`, `HttpOnly` ; AES-256-GCM + HKDF par enregistrement avec AAD
canonique complet ; hiérarchie de clés fail-closed ; fichiers servis en
`attachment` + `nosniff` + `sandbox`, plages d'octets strictes ; import Notion
non-SSRF (hôte figé, allowlist, `redirect: "error"`, DNS public, redirections
revalidées) ; aucune SQL brute ; `pg_dump`/`pg_restore` avec `shell:false` et
chaîne par variables d'environnement ; MCP : jetons SHA-256, code à usage unique
sous `FOR UPDATE`, révocation vérifiée ; Electron `sandbox`/`contextIsolation`,
CSP, navigation filtrée, mises à jour signées ; secrets hors dépôt et scan
bloquant ; logs Pino rédigés récursivement ; corrections de septembre A01, A02,
A03, A44, A69 toujours valides.

---

## 5. Données, synchronisation et sauvegardes

Synthèse : socle **plus solide que l'ampleur du périmètre ne le laisse craindre**
(transactions uniques, séquences sous verrou, idempotence par identité
immuable, blobs adressés par contenu + fsync/link, sauvegardes complètes
authentifiées avec verrous partagés et `pg_export_snapshot`, restauration à
garde-fous). Un P1 (D01), plusieurs P2 de promesse produit.

| ID | Sév. | Constat | Preuve | Impact / recommandation |
| --- | --- | --- | --- | --- |
| D01 | **P1** | Définition protégée indexée sans la source : collision dès deux sources | `apps/api/src/security/protected-content.ts:360-371` ; `plugins/mutations.ts:155-172` ; `database-repository.ts:140-151,283-317` ; consommateurs `search-service.ts:488-507`, `content-resolution.ts:168-181`, `export.ts:217-232`, `database-restore-target.ts:333-352` ; import `imports/notion/apply.ts:256-311` | Voir B2. **À corriger avant 029.** |
| D02 | P2 | La vérification du dernier backup complet re-hache l'archive entière à chaque tick de 5 min ; `prune` re-hache toutes les archives | `apps/api/src/server.ts:36-49` ; `backup/schedule.ts:99-120` ; `backup/full/service.ts:102-122,145-181` | Lecture continue de plusieurs Go, tick pouvant dépasser l'intervalle ; en cas d'échec nocturne, un dump complet rejoué toutes les 5 min. → Mémoriser digest + mtime/taille, borner `verifiedReceipts` dans `prune`. |
| D03 | P2 | Aucune rétention appliquée : corbeille 30 j et historique 90 j promis ne sont jamais purgés | `packages/domain/src/content/lifecycle.ts:176-183` (`isPurgeEligible` sans appelant) ; `docs/product/product-canvas.md:1649,2370` | Éléments trashés, placements et blobs restent indéfiniment ; `purged` n'est jamais atteint par le temps. → Worker de rétention + audit, ou retirer la promesse. |
| D04 | P2 | Index de recherche construit une seule fois au démarrage, sans réconciliation avec le curseur durable | `apps/api/src/app.ts:474-487` ; `search/search-service.ts:140-189,456-464` ; import CLI `imports/notion/target.ts:63-78` et `apply.ts:419` | Après un import CLI, les pages sont invisibles à la recherche jusqu'au redémarrage, alors que `/v1/search/status` dit `ready`. → Comparer périodiquement la version durable et `rebuild()`. |
| D05 | P2 | La restauration n'est jamais prouvée automatiquement : la vérification quotidienne ne teste qu'un SHA-256 | `backup/full/service.ts:102-122,259-326` ; seul appelant `admin/full-backup-commands.ts:139` ; `routes/backups.ts:140` | Une archive intacte mais non restaurable passe toutes les vérifications. → Répétition planifiée sur base jetable, statut exposé, ou documenter la limite. |
| D06 | P3 | Purge : artefact supprimé avant la ligne de catalogue | `admin/commands/backup-commands.ts:234-238` ; `backup/full/service.ts:156-180` | Un crash entre les deux laisse un backup catalogué sans artefact. → Marquer/supprimer la ligne d'abord ; purge idempotente. |
| D07 | P3 | Runner de migration sans verrou ni digest | `packages/database/src/migrate.ts:73-107` | Deux migrateurs concurrents échouent au hasard (`42P07`) ; un fichier déjà appliqué puis modifié n'est pas détecté. → Verrou consultatif + digest SHA-256 par fichier. |
| D08 | P3 | DDL bloquant sur `page_operation_updates` | `migrations/0009_...sql:11-35`, `0011_...sql:10-14` (`ALTER TABLE`, `CREATE INDEX` sans `CONCURRENTLY`) | Blocage des écritures de sync sur un journal volumineux. Non bloquant sans installation réelle, bloquant au premier parc. → Index `CONCURRENTLY`, backfills par lots. |
| D09 | P3 | `database_entries.database_id` sans FK depuis 0020 | `migrations/0020_...sql:7-20,47-51` ; `schema/index.ts:459-468` | Une ligne incohérente persiste silencieusement et l'entrée disparaît de sa base. → FK composite `(database_id, source_id)` ou trigger. |
| D10 | P2 | Chaque poll de page sans mise à jour réécrit `file_usages` (DELETE+INSERT) en `SERIALIZABLE` sous verrou, avec N+1 par fichier intégré | `repositories/content/usage-repository.ts:139-156` ; `page-state/page-operation-service.ts:490-500,709-716` ; `canonical-materializer.ts:53-62` | Churn WAL, contention entre onglets/appareils, latence inutile ; une page importée peut porter des centaines d'intégrations. → Une requête groupée, saut si l'ensemble est identique. |
| D11 | P3 | `GET /v1/items` non borné (aucune pagination) | `repositories/item-reader.ts:151-189` ; `routes/items.ts:59-63` | Dossier/workspace volumineux : réponse énorme, pas de reprise partielle. → Curseur stable `(position_key, id)`. |
| D12 | P3 | Outbox : boucle d'acquittement non bornée ; récupération « sending » non atomique entre onglets | `client-core/src/outbox/outbox.ts:142-269,122-130` | Livelock possible (travail non perdu) ; double soumission absorbée par l'idempotence serveur. → Backoff borné, récupération sous coordinateur inter-onglets. |

**Vérifié solide :** séquence de page sous verrou de ligne + rejeu idempotent
vérifiant les métadonnées immuables ; compaction des payloads bornée et
comptée ; checkpoints comparant digest **et** vecteur de version (409 sinon) ;
GC physique des fichiers commité avant suppression, lots bornés, quatre tables
de référence vérifiées ; blobs content-addressed avec écriture temporaire,
digest vérifié, `link`, `fsync` fichier + répertoire, chemins `[a-f0-9]{64}` ;
backup complet : verrou de run, verrous partagés, `REPEATABLE READ` +
`pg_export_snapshot()`, dump en flux scellé, publication atomique, reçu
authentifié ; restauration refusant la base active, le répertoire actif et tout
répertoire non vide, marqueur exclusif, activation révoquant sessions/appareils/
MCP ; SSE = positions + reprise `Last-Event-ID` + signal `compacted` +
battement ; mutations canoniques `SERIALIZABLE` avec reprise bornée sur
`40001`/`40P01` ; invariants mono-propriétaire portés par des index uniques ;
éviction locale n'évince jamais un élément en file/conflit.

---

## 6. UI/UX, accessibilité et performance frontend

Synthèse : aucun parcours cassé ni perte de travail côté interface ; les états
vide/chargement/erreur existent et sont honnêtes. Deux P1 d'accessibilité
systémique, une régression de performance mesurée, et un risque d'écran blanc.

| ID | Sév. | Constat | Preuve | Impact / recommandation |
| --- | --- | --- | --- | --- |
| U01 | **P1** | Anneau de focus clavier à 1,61–1,76:1 (clair), sous le seuil 3:1 | `ui/tokens.css:102,432` ; `ui/primitives/primitives.css:87-95` ; 32 règles dans 12 feuilles | Voir B4. → Token ≥ 3:1, 2 px. |
| U02 | **P1** | Texte d'erreur/validation en `--ui-color-danger` (3,28:1) au lieu de `-danger-text` (5,68:1) | `tokens.css:103-104` ; `database.css:3456-3459,3638-3641,2148` ; `editor.css:656,1081-1082,1498-1503` ; `settings-security.css:451` ; `workspace.css:1141` | Voir B4. → Remplacer 14 sélecteurs + test de contraste. |
| U03 | P2 | Copies anglaises et codes techniques dans une UI française | `app.tsx:550-551,568-569` ; `editor-view.tsx:240-243,287` ; `local-content.ts:1293,1312,1342,1358,1477,1519` ; `files/upload.ts` (9 messages) ; `database-conflict-resolution.tsx:259,366` ; `plugins/errors.ts:304-332` ; `french-copy.spec.ts:5-33` (27 fichiers) | À chaque démarrage/échec, l'utilisateur lit une phrase anglaise ou `code: titre`. Le test `french-copy` passe malgré les fuites. → Étendre le test, centraliser la traduction des `SafeProblemCode`. |
| U04 | P2 | CSS render-blocking : 1,87 Mo (1,01 Mo gzip), dont 1,44 Mo de 60 polices KaTeX en `data:` | `global.css:2` (ajouté le 2026-10-06) ; build HEAD `index-c9358n27.css` = 1 869 009 o ; `dist` du 2026-09-22 = 242 146 o | Tout premier rendu paie ~1 Mo gzip, même sans formule ; polices non cacheables séparément. → Sortir KaTeX du manifeste global, émettre les woff2 en assets. |
| U05 | P2 | Aucune découpe lazy ; `/__ui-lab` importé statiquement en production | `main.tsx:5-6` ; `ui-lab-compositions.tsx:3-5` ; aucun `React.lazy` ; chunk workspace 2 851 444 o (662 ko gz), préchargement 1,34 Mo | Démarrage retardé sur mobile/LAN ; le lab de revue est embarqué pour tous. → Import dynamique derrière le chemin, découpe éditeur/bases/graphe. |
| U06 | P2 | Aucune barrière d'erreur ; import du routeur sans `.catch` | `main.tsx:15,44` ; aucune occurrence de `ErrorBoundary`/`componentDidCatch` | Un bug de rendu ou un chunk manquant démonte tout : écran blanc sans action. → Barrière racine + barrière éditeur + catch explicite. |
| U07 | P2 | Graphe : chaque nœud (jusqu'à 200) est un arrêt de tabulation | `knowledge-graph/graph-canvas.tsx:589,542,608` ; `packages/graph/src/project.ts:19` | 200 Tab pour traverser/quitter ; consigne affichée contredite. → Tabindex mobile + flèches/Home/End. |
| U08 | P2 | Actions de dossier invisibles au toucher ≥ 768 px | `workspace/workspace.css:527-535,478-480` ; rattrapage seulement `< 768 px` (`:976-981`) | Sur iPad/tactile, le menu `⋯` et la poignée existent mais sont invisibles. → `(hover: none), (pointer: coarse)`. |
| U09 | P2 | Bouton « fermer l'onglet » 20×20 px, sans override tactile | `workspace.css:249-263` ; bandeau 30 px (`:180-190`) | Taps manqués ou fermeture du mauvais onglet ; contredit la cible 44 px revendiquée par A81. → Zone 44 px en `pointer: coarse` + assertion de géométrie. |
| U10 | P3 | Manifeste PWA sans icônes, thème sombre en clair, 10,26 Mo précachés | `manifest.webmanifest` ; `index.html` ; build Workbox | Installation sans icône (Chrome exige 192 px) ; écran de démarrage quasi noir en thème clair. → Icônes 192/512 + maskable, `theme_color` par thème, précache limité. |

**Vérifié solide :** routage/URL canonique et 404 dédiée ; `role="status"` +
`aria-busy` au démarrage ; états vide/hors-ligne/erreur avec reprise et
« Détails techniques » ; landmarks, lien d'évitement, un seul `<main>` ; dialogues
Ariakit (piège de focus, Échap, retour) ; éditeur : collage réduit avec plafonds
500 blocs/profondeur 20, maths `trust:false`, raccourcis, statut de sauvegarde
honnête ; bases : `role="grid"` complet (`aria-rowcount`/`colcount`,
`aria-colindex`, `aria-sort`, tabindex mobile), Kanban `aria-posinset` ;
onglets `toolbar` nommé, focusables, `aria-current` ; `prefers-reduced-motion`
CSS + JS ; contrastes de lecture ≥ 5,3:1 ; aucun TODO, aucun bouton icône sans
nom accessible, pas de `z-index` arbitraire dans les primitives.

---

## 7. Architecture, qualité, tests et CI

Synthèse : monorepo sain, frontières de packages respectées (`packages/domain`
sans dépendance workspace, aucun cycle de production), contrats réellement
partagés, typage strict quasi sans échappatoire. La dette est concentrée et
mesurable.

Mesures : **1 398 fichiers** TS/TSX/CSS suivis, **342 418 LOC** (180 593 source
dont 14 346 CSS ; 155 936 tests, soit 46 %), **605 fichiers de test**,
≈ 4 930 cas, 16 115 `expect`, 0 snapshot, 19 skips conditionnels, 0 TODO/FIXME,
0 `as any` réel, 0 assertion non-nulle, 30 `biome-ignore` justifiés, 37
overrides, 22 jobs CI requis, 76 journeys E2E.

| ID | Sév. | Constat | Preuve | Impact / recommandation |
| --- | --- | --- | --- | --- |
| R01 | n/a sur `main` | Le plafond de 30 min du job `unit` était propre à la branche de sharding | `f32f0ae3` (`ci.yml:146`) ; `main` n'a pas de `timeout-minutes` sur `unit` | Le job reste coûteux (il exécute `test:coverage`, qui contient les suites DB aussi lancées séparément) mais il n'a pas de gate temporel sur `main`. → Mesurer la durée et décider si la duplication doit être supprimée ; ne pas confondre avec un blocage. |
| R02 | P2 | La couverture n'est pas vérifiée sur les PR | `run-affected-vitest.ts:56-71` (`vitest related --run`, sans `--coverage`) ; artefact seulement si `unit_mode == 'full'` (`ci.yml:164-169`) | Une PR qui ajoute du code non testé reste verte ; la régression n'apparaît qu'après merge. → Contrôle différentiel par fichier modifié, ou documenter l'asymétrie. |
| R03 | **P1** | 738 LOC de migration chiffrée sans importeur hors tests | `migration-orchestrator.ts:74` ; `migration-backfill-service.ts:88` ; `scripts/db/migrate.ts:16-17` ; T096/T097 cochées | Voir B3. |
| R04 | P2 | Code mort : 106 exports sans référence ; cluster `features/save-state/` orphelin ; 8 assertions E2E sur `conflict-notice` jamais rendu ; `single-instance.ts` sans référence | `features/save-state/*` (jamais importé) ; `global.css:27` charge son CSS ; `tests/e2e/conflict-resolution.spec.ts:96`, `realtime-page-sync.spec.ts:80`, etc. ; `apps/desktop/src/single-instance.ts` | Les assertions d'absence ne peuvent pas échouer : la régression décrite (conflit non signalé) passerait inaperçue. `single-instance` est une régression de A12. → Supprimer le cluster et les restes Tiptap, remplacer par une vérification de l'UI vivante, ajouter un contrôle d'exports inutilisés. |
| R05 | P2 | Points chauds : 38 fichiers > 1 000 lignes (dont `database.css` 4 361, `hierarchy-explorer.tsx` 3 482, `local-content.ts` 1 942) ; 45 fonctions ≥ 150 lignes (max 704 : `composeApp`, `app.ts:102`) | voir mesures | Revue et merge coûteux, couplage de fait. → Découper par domaine, viser ≤ 800 lignes sur les nouveaux fichiers. |
| R06 | P2 | Aucun budget de bundle ; CSS 1,01 Mo gzip (KaTeX) | `global.css:2` ; `apps/web/build.ts:106-140` ; `tests/performance/*` (serveur seulement) | Aucun gate ne détecte une dérive de bundle. → Budget CSS/JS + sortir KaTeX. |
| R07 | P3 | Deux chaînes de build web (Bun.build prod, Vite dev) | `apps/web/build.ts` ; `vite.config.ts` ; deux variantes Tailwind | Un comportement validé en dev peut différer en production. → Documenter ou converger. |
| R08 | P2 (partiel) | Linux : `main` utilisait `ubuntu-latest` sur 22 jobs CI et 4 jobs de release, cassés par la bascule Ubuntu 26 ; Windows reste sur des alias | `ci.yml` (22 occurrences), `release.yml:49,78`, `desktop-release.yml:29,148` avant correction ; `desktop-ci.yml:23-24`, `desktop-release.yml:62,65` (`windows-latest`, `windows-11-arm`) | **Linux corrigé** : tous les jobs sont épinglés à `ubuntu-24.04`, avec note dans `docs/development.md`. Reste à décider pour Windows : épingler une image explicite et ajouter un contrat refusant `*-latest`. |
| R09 | P2 | Documentation d'architecture obsolète ; import relatif desktop→domain sans dépendance déclarée | `docs/architecture/README.md:29-37` (packages `editor`/`mcp` inexistants, packages réels omis) ; `apps/desktop/src/main.ts:5` ; `apps/desktop/package.json` sans dépendance workspace | La frontière n'est écrite nulle part ; un nouveau contributeur peut la violer sans test. → Réécrire le graphe réel + test de frontière. |
| R10 | P3 | 116 doubles casts `as unknown as` en source | concentrations `hierarchy-explorer.tsx`, `page-editor.tsx`, `use-entry-autosave.ts`, `page-operation-archive.ts`, `block-tree.ts` | Le typage strict est contourné aux frontières de sérialisation. → Typer les parseurs, compteur surveillé en CI. |
| R11 | n/a sur `main` | Le sharding E2E équilibré par fichier n'existe que sur la branche de sharding | `f32f0ae3` (`ci/test-impact.json:1372-1374`, `scripts/ci/test-impact.ts:179-190`) ; absent de `main` | Aucun déséquilibre de shards à corriger sur `main`, où le corpus reste exécuté par projet. Le sujet reviendra seulement si un sharding est réintroduit. |
| R12 | P3 | Couche UI testée par assertions SSR plutôt que par interactions | `vitest.config.ts:72-75` (`environment: node`) ; 67/154 fichiers forcent jsdom ; 31 `renderToStaticMarkup` ; 0 testing-library | Une régression d'événement/focus/touche n'est pas détectable hors E2E. → `environment: jsdom` pour le projet web, migration progressive. |

**Vérifié solide :** `domain` sans dépendance workspace ; aucun cycle de
production ; `contracts` importé par 56 fichiers API, 51 web, 19 client-core ;
`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` +
`noImplicitOverride` + `noFallthroughCasesInSwitch` +
`noPropertyAccessFromIndexSignature` + `verbatimModuleSyntax` ; overrides
Tiptap effectifs (3.30.5 unique) ; actions CI épinglées par SHA ; images Docker
épinglées par digest ; Compose `read_only` et runtime non-root ; 22 jobs requis
avec `if: always()` et comparaison stricte à `success` ; `quality-gate` ne donne
`packages: write` qu'au job de publication ; cache Playwright keyé
version/OS/arch ; chemins inconnus → corpus complet (fail-closed) ; release
exige le même SHA ; packaging desktop fail-closed sur la signature ; logs Pino
rédigés ; aucun feature flag ; `apps/operations` n'existe pas dans Git (seuls
des artefacts de build ignorés traînent localement).

---

## 8. Produit, spécifications et readiness V1

| ID | Sév. | Constat | Preuve | Impact / recommandation |
| --- | --- | --- | --- | --- |
| P01 | P0 workflow | Gate dépendances rouge, PR #183 fermée | voir B1 | Voir B1. |
| P02 | P0 release | Aucune preuve de release V1 : ledger 002 `pending`, T035/T106/T107, 008 T081/T082 | `specs/002-owner-security-foundation/validation.md:3` ; `tasks.md:83,490,491` ; `specs/008-search/tasks.md:319,320` | V1 non déclarable même si le reste est vert. → Exécuter les protocoles et consigner les SHAs exacts. |
| P03 | P0 release | 029 : implémentation déjà dans `main`, ledger inversé, migration cassante | commit `38d2a9b1` ; migrations `0019`/`0020` ; `specs/029.../spec.md:5` ; 49 tâches ouvertes | Modèle de données V1 à moitié livré ; import 028 à réadapter ; reprises/duplications. → Traiter 029 comme feature active, re-cocher ce qui est prouvé, terminer contrats/repositories/import/export/backup. |
| P04 | P0 release | Desktop absent : 0 tag, 0 release, 0 installateur | `specs/014.../validation.md:75` ; `gh api .../releases` = 0 ; `git ls-remote --tags` vide | Exigence V1 non satisfaite ; la doc présente un téléchargement inexistant. → Produire les 9 artefacts signés/notarisés, publier, tester N→N+1 et rollback, ou acter une réduction de périmètre. |
| P05 | P0 release | 021 non planifiée | `specs/021-readable-server-logs/` = `spec.md` + checklist seulement | Impossible d'estimer/exécuter ; V1 exige une vue humaine locale. → Planifier puis livrer, ou absorber dans 017/002 par décision tracée. |
| P06 | P1 | 017 convergence incomplète, chemin Tiptap résiduel | `specs/017.../tasks.md:414-432` ; `apps/web/package.json:29-33` ; `to-tiptap.ts`, `from-tiptap.ts`, `tiptap-schema.ts` | Dette d'éditeur et preuves perf/usabilité manquantes. Note d'audit : `to-tiptap`, `from-tiptap`, `tiptap-schema` et `block-controls` n'ont **aucun importeur** — ce sont des morts confirmés, pas un chemin actif. → Supprimer les modules morts et les dépendances, exécuter T189–T207. |
| P07 | P1 | Statuts de livraison périmés (« main rouge », « Draft ») alors que `main` est verte depuis six runs | `docs/audits/2026-09-pre-v1.md:3-14` ; `Status` de 001/003/006/007/008/013/018/019/022/024/025/026/027 ; 7 tâches ouvertes sur prémisse fausse | Faux négatif : on ne sait plus ce qui est livré ; reprises inutiles. → Réconcilier chaque statut avec le run de merge, fermer les tâches dont la prémisse est fausse. |
| P08 | P1 | Tests/Playwright suspendus sur des parcours V1 | `specs/037.../tasks.md:31-33` ; `specs/029.../validation.md` ; 034/036/031/032 | Definition of Done §44 non atteinte pour les bases V1. → Campagne de preuves + Playwright, ou exception constitutionnelle tracée (périmètre, risque, approbateur, suivi). |
| P09 | P1 | Documentation opérateur §45 incomplète | canevas §45 ; absence de guide d'installation, kit de récupération, update/rollback, format d'export, compatibilité | V1 non exploitable par un tiers. → Écrire les cinq documents et ajouter les tâches à 008. |
| P10 | P2 | Rétention promue par le canevas non implémentée/paramétrable (90 j vs 24 h) | `docs/product/product-canvas.md:1649,2370` ; `specs/001.../spec.md:190,258` ; `app.ts:148` | Écart spec/code sur une promesse produit. → Décider la règle V1, l'implémenter, aligner 001. |
| P11 | P2 | Commandes `pnpm` obsolètes dans des artefacts canoniques | `specs/008.../tasks.md:200` ; `specs/018.../tasks.md:257,387` ; `specs/002.../plan.md:391` ; quickstarts 005/006 ; constitution VII | Instructions qui échouent ; contradiction avec « Bun exclusif ». → Remplacer par `bun run …` + contrôle des commandes citées. |
| P12 | P2 | Roadmap/canevas désynchronisés, références fantômes | 12 features absentes de la roadmap ; `roadmap.md:319` ; canevas `:1342` vs `:206-210` ; `:2325-2345` (numérotation 26/27 dupliquée) ; `specs/017.../tasks.md:424` cite `docs/architecture/document-format.md` absent | Séquencement V1 ambigu, références mortes. → Mettre la roadmap à jour, corriger les références et la numérotation §47. |

**Tâches ouvertes : 105 sur 14 features.** Bloquantes de release : 002 (3),
008 (2), 014 (19), 017 (19), 021 (plan/tasks à créer), 029 (49). Preuves UI
différées : 037 (5), 036 (1), 034 (1). À réconcilier (prémisse périmée) :
013 T016, 018 T114, 019 T053, 022 T044, 024 T024, 025 T041, 014 T076.

Points positifs de cohérence : **0 lien interne cassé** sur 380 fichiers
Markdown ; les 38 features ont spec + plan + tasks (sauf 021) ; les décisions
sont tracées dans les artefacts ; le workflow Spec Kit est réellement suivi.

---

## 9. Points forts à préserver

- **Sécurité de fond** : point d'authentification unique, CSRF robuste,
  chiffrement authentifié par enregistrement avec AAD complet, hiérarchie de
  clés fail-closed, Electron sandboxé, MCP à jetons révocables, logs rédigés.
- **Durabilité** : transactions uniques, séquences sous verrou, idempotence,
  blobs content-addressed avec fsync/link, sauvegardes complètes authentifiées,
  restauration à garde-fous, SSE reprenable.
- **Discipline de code** : 0 TODO/FIXME, 0 `as any`, 0 assertion non-nulle,
  typage strict, 46 % de tests, 0 snapshot, 0 `.only`/`.todo`, Biome propre
  (106 avertissements cosmétiques), format et typecheck verts en ~20 s.
- **CI/CD** : 22 jobs requis, actions SHA-épinglées, permissions minimales,
  fail-closed sur les chemins inconnus, images épinglées par digest, release
  vérifiant le SHA candidat, packaging desktop refusant un artefact non signé.
- **Produit** : les briques V1 existent et sont testées ; la documentation
  d'architecture de décision est riche ; 0 lien cassé.

---

## 10. Ce que cet audit n'a pas pu vérifier

- **Aucune exécution applicative** : Docker et PostgreSQL absents. Donc pas de
  tests DB, contrats API, E2E (76 journeys), performance, restauration réelle,
  packaging/installation desktop, scan d'image.
- **Pas de navigateur** : les constats UI (contrastes, focus, tactile,
  responsive, LCP/INP) sont déduits du code et des tokens, pas observés à
  l'écran ; les corrections CSS devront être confirmées par capture réelle
  (clair/sombre, 320 px, clavier) avant d'être déclarées livrées.
- **Couverture réelle non mesurée** : le `coverage/lcov.info` local date du
  2026-09-23 et affiche 0,42 % (run partiel, ignoré par Git).
- **R01/R11** : non applicables sur `main` ; ce sont des artefacts de la
  branche de sharding supprimée. La durée de 12 min 52 s et le plafond de
  30 min provenaient de cette branche.
- **GHCR** : non inspectable sans le scope `read:packages` (403).
- Les findings A01–A89 de l'audit de septembre n'ont pas été rejoués
  intégralement ; ceux qui croisaient les axes ont été vérifiés présents au
  HEAD (A01/A02/A03/A06/A13/A19/A20/A22/A23/A24/A44/A45/A59–A62/A68/A69/A73).

---

## 11. Plan d'action priorisé

### Immédiat (avant tout nouveau développement)

1. **Débloquer le gate de dépendances** (B1) : MCP ≥ 2.3.0, `undici` ≥ 7.30.1,
   `zod` ≥ 4.6.6 ; régénérer le lock, rejouer `security:audit`, tester
   l'appairage MCP. Optionnel immédiat : `@fastify/busboy` ≥ 3.2.2.
2. **Décider de la branche** : le HEAD est une PR fermée. Deux options :
   corriger les dépendances sur cette branche et rouvrir la PR (le diff est
   petit), ou revenir sur `main` et rejouer le commit de sharding plus tard.
   Ne pas empiler du travail de feature sur une branche abandonnée.
3. **Corriger D01** (B2) avant de continuer 029 : identité d'enveloppe avec
   `sourceId`, scellement de `database.source.create`, jointures alignées,
   trois tests de non-régression.
4. **Corriger U01/U02** (B4) : deux tokens et 14 sélecteurs, plus un test de
   contraste ; capture réelle exigée.

### Avant de bâtir sur 029

5. **Trancher R03** : câbler l'orchestrateur de migration chiffrée ou supprimer
   les 738 lignes et corriger la spec 002.
6. **Terminer 029** : contrats, repositories, API, projection, import 028,
   export, backup/restore, tests, puis re-cocher uniquement ce qui est prouvé.
7. **Nettoyer le code mort** (R04) : cluster `save-state`, restes Tiptap,
   `single-instance.ts`, et remplacer les 8 assertions E2E vacantes par une
   vérification de l'UI vivante.

### Avant la V1

8. **Livrer le desktop** (P04) : 9 artefacts signés/notarisés, release GitHub,
   installation, update N→N+1 et rollback.
9. **Planifier et livrer 021** (P05) : logs lisibles, vue humaine locale.
10. **Exécuter les protocoles 002/008** (P02) et remplir le ledger avec les SHAs.
11. **Rétablir les tests/Playwright différés** (P08) ou acter une exception
    constitutionnelle tracée.
12. **Compléter la documentation opérateur §45** (P09).
13. **Réconcilier les statuts** (P07, P03) : audit 2026-09, `Status` de specs,
    roadmap, tâches de livraison périmées.
14. **Rétention et sauvegardes** (D03, D04, D05, D02) : worker de rétention,
    réconciliation de recherche, répétition de restauration planifiée,
    vérification incrémentale du backup.
15. **Budget de couverture et de bundle** (R02, R06) : contrôle différentiel PR,
    budget CSS/JS, sortie de KaTeX du CSS global.

### Backlog de durcissement (P3)

S04 (rétention des rate limits), S06 (en-têtes nginx + CSP), S07 (zéroïsation
des clés), S08 (`no-store` global), S09 (statut public), D06 (ordre de purge),
D07 (verrou/digest de migration), D08 (index `CONCURRENTLY`), D09 (FK
`database_entries`), D11 (pagination `/v1/items`), D12 (outbox), U10 (PWA),
R05 (découpage des hotspots), R07 (bundlers), R08 (runners Windows épinglés),
R09 (doc d’architecture + frontière), R10 (doubles casts), R12
(tests web d’interaction).

---

## 12. Verdict

**GO pour continuer le développement. NO-GO pour merger en l'état et pour
déclarer la V1.**

Ce dépôt n'a pas de problème de fond : l'architecture est saine, les garanties
de sécurité et de durabilité tiennent à la lecture, la discipline de code est
rare pour un projet de cette taille, et les gates statiques sont verts et
reproductibles. Le développement peut reprendre immédiatement après le
déblocage du gate de dépendances.

Les trois choses à ne pas ignorer :

1. **Le gate est rouge pour une raison externe et facile à corriger** — huit
   avis `high` dans trois paquets. Tant qu'il est rouge, aucune PR ne peut
   merger, y compris sur `main`.
2. **D01 est un vrai bug de données**, pas une dette : dès qu'une base a deux
   sources (import Notion multi-`data_source`), la définition chiffrée est
   ambiguë et l'export/restauration peuvent échouer. C'est précisément la
   surface que 029 étend : le corriger maintenant coûtera moins cher que plus
   tard.
3. **La V1 n'est pas un problème de code, c'est un problème de livraison et de
   preuve** : desktop jamais publié, 021 non planifiée, protocoles de release
   non exécutés, registre de livraison inversé. Le code est prêt pour beaucoup
   de choses ; la sortie de V1 demande une campagne de preuves, pas une
   réécriture.

Enfin, l'accessibilité (U01/U02) et le poids du front (U04/U05) sont les deux
sujets qui dégraderont le plus l'expérience réelle du propriétaire s'ils sont
laissés pour la fin : ce sont des corrections peu risquées et bien localisées,
à faire avant de geler l'interface.
