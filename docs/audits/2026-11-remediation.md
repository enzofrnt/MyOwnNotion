# Remédiation de l'audit — 4 novembre 2026

Correctifs appliqués après [l'audit complet](2026-11-full-audit.md), sur une
branche `fix/audit-remediation` créée depuis `main` (`c3ea5d90`). La branche de
sharding `ci/faster-playwright-shards` a été supprimée (locale et distante) et
son travail n'est pas repris, à l'exception du pinning des runners Ubuntu
indispensable à la CI (voir ci-dessous). Aucune donnée personnelle ni
installation réelle n'a été utilisée.

**Revalidation sur `main`.** L'audit avait été produit sur la branche de
sharding. La comparaison `origin/main..f32f0ae3` ne montrait que 14 fichiers de
CI/docs/specs, et **aucune différence dans `apps/`, `packages/`,
`package.json` ou `bun.lock`** : les constats de code restent valables. Deux
findings de l'audit étaient en revanche propres à la branche jetée — R01
(plafond de 30 min du job `unit`) et R11 (sharding E2E) — et ne s'appliquent pas
à `main`. Le pinning `ubuntu-24.04` a été conservé : sans lui, les 22 jobs
`ubuntu-latest` de `ci.yml` et les 4 jobs de release cassent depuis la bascule
Ubuntu 26 du 2026-10-19.

## Résumé

| Sujet | État |
| --- | --- |
| Gate `dependency-vulnerability-audit` | ✅ **débloqué** — `bun audit --audit-level=high --prod` ne trouve plus de vulnérabilité |
| D01 — collision de définition des bases multi-sources | ✅ corrigé (enveloppe par source + repli legacy) |
| U01 — focus clavier sous le seuil WCAG | ✅ corrigé (token dédié, contrastes recalculés) |
| U02 — texte d'erreur à faible contraste | ✅ corrigé (26 sélecteurs + token sombre) |
| U04 — CSS bloquant de 1,87 Mo | ✅ **1,87 Mo → 435 Ko** (63 Ko gzip), polices externalisées |
| U05 — laboratoire UI dans le démarrage | ✅ imports dynamiques (le lab sort du chunk d'entrée) |
| U06 — absence de barrière d'erreur | ✅ barrière racine + écran de reprise + test |
| R04 — code mort et assertions vides | ✅ cluster `save-state`, `single-instance.ts` et 8 assertions vides supprimés |
| R09 — doc d'architecture obsolète | ✅ frontières réelles documentées |
| R08 — runners CI | ✅ Linux épinglé à `ubuntu-24.04` sur les 26 jobs concernés (Windows reste à décider) |
| R01 / R11 — plafond `unit`, shards | n/a sur `main` (artefacts de la branche jetée) |
| R03 — orchestrateur de migration non câblé | ⏸️ décision produit requise (non modifié) |
| D02–D05, rétention, restauration | ⏸️ travaux de feature, hors correctif immédiat |

## Corrections détaillées

### 1. Dépendances vulnérables (B1 / P01)

| Paquet | Avant | Après |
| --- | --- | --- |
| `@modelcontextprotocol/server` | 2.0.0 | **2.3.0** |
| `@modelcontextprotocol/client` | 2.0.0 | **2.3.0** |
| `zod` | 4.3.6 | **4.6.7** |
| `undici` (override racine) | 7.29.1 | **7.30.1** |
| `@fastify/busboy` (override) | 3.2.1 | **3.2.4** (avis `moderate`, non bloquant) |

`bun.lock` régénéré ; le `bun audit` de production est propre (385 paquets
vérifiés). Le SDK MCP 2.3.0 expose toujours `McpServer`, `createMcpHandler` et
`registerTool` ; le typecheck et un import réel passent. Le protocole MCP devra
être revalidé par les tests d'appairage en CI.

### 2. D01 — définition de base indexée par source

- `ProtectedContent.writeDatabaseDefinition`/`readDatabaseDefinition` utilisent
  désormais `sourceId` comme identité d'enveloppe
  (`apps/api/src/security/protected-content.ts:361-410`).
- Repli legacy **limité à la source par défaut** : une enveloppe historique
  stockée sous l'identifiant de la page reste lisible pour la source par défaut,
  jamais pour une source secondaire.
- Tous les lecteurs/écrivains passent la source :
  `content-resolution.ts`, `canonical-payloads.ts`, `search-service.ts`,
  `canonical-storage-migration.ts`, `plugins/mutations.ts`,
  `database-restore-target.ts`.
- `database.source.create` est maintenant scellé (il ne l'était pas).
- La recherche joint `databases` sur `source_id` au lieu de `item_id`, et
  propage `sourceId` dans `SearchSourceRecord`.
- Régression ajoutée dans `apps/api/tests/protected-content.contract.spec.ts`
  (deux sources, repli legacy, absence de réouverture croisée) et attente
  d'identité mise à jour dans
  `apps/api/tests/database-projection-loading.contract.spec.ts`.

**Limite :** ces tests nécessitent PostgreSQL ; ils n'ont pas pu être exécutés
ici. Ils doivent passer dans le job « Database integration & migrations » et
dans les contrats API avant toute fusion.

### 3. U01 / U02 — accessibilité

- `--ui-color-focus` pointe désormais sur `--ui-color-text-muted` dans les deux
  thèmes (`apps/web/src/ui/tokens.css`). Contrastes calculés : **5,81:1** sur
  canvas clair, **5,33:1** sur sidebar, **9,07:1** en sombre (seuil WCAG 3:1).
- 26 déclarations `color:` passent de `--ui-color-danger` à
  `--ui-color-danger-text` (18) et de `--ui-color-accent` à
  `--ui-color-accent-text` (8), dans `database.css`, `editor.css`,
  `editor-table.css`, `settings-security.css`, `workspace.css`, `ui-lab.css`.
- En thème sombre, `--ui-color-danger-text` devient `#e89084` : **7,33:1** sur
  canvas et **5,32:1** sur `danger-soft` (contre 3,73:1 auparavant).

Les captures réelles (clair/sombre, 320 px, focus clavier) restent à produire
avant de déclarer la correction « livrée » au sens du skill UI ; les tests de
contraste de `database-page-flow` et les captures Playwright existantes sont à
surveiller.

### 4. U04 — CSS render-blocking

Le build extrait maintenant les 60 polices KaTeX des feuilles CSS
(`apps/web/build.ts`, fonction `externalizeEmbeddedFonts`) :

| Mesure | Avant | Après |
| --- | --- | --- |
| CSS principal | 1 869 877 o | **435 153 o** |
| CSS principal gzip | 1 012 468 o | **63 118 o** |
| Polices en `data:` | 60 | **0** |
| Fichiers de police émis | 0 | **60** (woff2/woff/ttf) |

Les fichiers sont adressés par contenu sous `/assets/fonts/`, servis par la
route immuable `/assets/`, et précachés par Workbox pour le hors-ligne. Un
garde-fou fait échouer le build si un futur bundler ré-inline les polices.

Effet secondaire mesuré : le précache passe de 10,26 Mo à 9,83 Mo (les données
base64 disparaissent) ; le CSS initial n'est plus un blocage de 1 Mo.

### 5. U05 / U06 — démarrage et reprise

- `main.tsx` importe dynamiquement `ui-lab`, `ui-lab-auth` et `ui-lab-review` :
  le lab de revue ne fait plus partie du chunk d'entrée. Le routeur de
  l'application était déjà chargé dynamiquement.
- Nouvelle `AppErrorBoundary` (`apps/web/src/ui/error-boundary.tsx`) avec écran
  de reprise français, bouton « Recharger la page » et détails techniques
  repliés. L'import du routeur a désormais un `.catch` explicite. Deux tests
  jsdom couvrent le rendu normal et la reprise après erreur.

### 6. Nettoyage (R04)

- Suppression du cluster mort `apps/web/src/features/save-state/` (5 fichiers)
  et de son import CSS.
- Suppression de `apps/desktop/src/single-instance.ts` (aucune référence ;
  `main.ts` utilise `requestSingleInstanceLock`).
- Suppression des 8 assertions E2E `conflict-notice` qui vérifiaient l'absence
  d'un composant jamais rendu. Les assertions significatives voisines
  (`sync-status`, contenu de l'éditeur, état de synchronisation) sont conservées.

### 7. R09 — documentation d'architecture

`docs/architecture/README.md` liste désormais les packages réels, les règles de
dépendance vérifiées et l'écart connu de `apps/desktop` (import relatif de
`packages/domain` sans dépendance déclarée).

### 8. Runners CI (R08)

`main` utilisait encore `ubuntu-latest` sur 22 jobs de `ci.yml` et 4 jobs de
`release.yml`/`desktop-release.yml`. Depuis la bascule de l'alias vers Ubuntu 26
(2026-10-19), ces jobs ne peuvent plus installer le client PostgreSQL 18
épinglé. Les 26 occurrences sont passées à `ubuntu-24.04`, avec :

- un commentaire d'avertissement dans l'en-tête de `.github/workflows/ci.yml` ;
- la note correspondante dans `docs/development.md` (section « CI cache
  boundaries »).

Les runners Windows (`windows-latest`, `windows-11-arm`) restent des alias :
c'est un choix à trancher séparément, et le label explicite doit être vérifié
sur l'offre GitHub actuelle avant de le remplacer.

## Vérifications exécutées

| Gate | Résultat |
| --- | --- |
| `bun run format:check` | ✅ 1 461 fichiers |
| `bun run lint:ci` | ✅ 0 erreur, 107 avertissements non bloquants |
| `bun run typecheck` | ✅ 11 packages + racine |
| Tests unitaires hors DB | ✅ **302 fichiers / 3 130 tests** |
| Tests web | ✅ 155 fichiers / 1 039 tests |
| Contrats de release (workflows) | ✅ 36 tests (`release-gates`, `desktop-release-artifacts`) |
| `bun run build` | ✅ 11 artefacts ; web 43 sorties, 88 assets précachés |
| `bun run security:audit` | ✅ aucune vulnérabilité (`--audit-level=high --prod`) |
| `bun run toolchain:check` | ✅ 2 539 fichiers suivis |

## Non exécuté — limites explicites

- **Aucun test PostgreSQL** : Docker et PostgreSQL sont indisponibles. Les
  suites `database-integration`, `api-contract`, `workspace-contract`,
  migrations, contrats de sécurité et E2E n'ont pas tourné. Le correctif D01 est
  vérifié par le typecheck, les tests d'enveloppe ajoutés et la lecture, pas par
  une exécution réelle.
- **Aucune capture visuelle** : les changements de tokens et de couleurs
  doivent être confirmés par les captures Playwright existantes (les tests
  `workspace-shell-visual` et `v1-surface-visuals` peuvent révéler un écart).
- **Aucun test desktop** : le retrait de `single-instance.ts` est vérifié par
  `grep` (aucune référence) et le typecheck, pas par un parcours Electron.
- **Aucune mesure de bundle en CI** : le build local donne 435 Ko de CSS brut ;
  un garde-fou de build empêche la ré-inlining, mais aucun budget chiffré n'est
  encore ajouté aux gates.

## Décisions encore ouvertes

1. **R03** — l'orchestrateur de migration chiffrée (738 lignes) reste sans
   point d'entrée de production. Il faut soit le câbler et le prouver, soit le
   supprimer et corriger la spec 002. Ce choix n'a pas été fait ici.
2. **D02–D05** — vérification incrémentale du backup, worker de rétention,
   réconciliation de recherche, répétition de restauration planifiée : ce sont
   des travaux de feature, pas des correctifs mécaniques.
3. **R02/R08/R10–R12** — couverture sur PR, runners Windows épinglés, doubles
   casts, tests web d'interaction : dette à planifier. Le pinning Linux (R08)
   est fait ; seul Windows reste ouvert.

## Prochaine étape recommandée

1. Lancer la CI complète (le gate de dépendances ne bloque plus) et vérifier
   les suites DB/API/E2E, en particulier les tests D01 ajoutés.
2. Traiter R03 par décision explicite.
3. Rejouer les captures UI (clair/sombre, 320 px, focus) avant de considérer
   U01/U02 comme livrés.
4. Reprendre la feature 029 (49 tâches ouvertes) une fois D01 validé par la CI.
