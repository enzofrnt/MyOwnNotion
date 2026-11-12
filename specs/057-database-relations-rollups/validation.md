# Validation — relations entre sources et agrégations (057)

**État : P1 livré et vérifié (R1–R4). R5 (relation inverse) non implémentée, décision consignée dans `plan.md`. Aucun commit ni push.**

Passe du 11 novembre 2026. Arbre de travail préexistant préservé ; aucun reset ni stash.

## Ce qui fonctionne et a été prouvé

### Contrat et données (R1, R4)

- `relation.config.targetSourceId?: Uuid` désigne la **source canonique**. Son absence signifie « relation historique non configurée » ; aucune source n'est devinée.
- Champ optionnel validé (domaine + schéma filaire HTTP), conservé dans la définition JSON, les révisions et les archives. Aucune migration SQL : les liens existants gardent leurs UUID.
- Une source peut être choisie **vide** ; l'agrégation lit alors son schéma, pas celui d'une autre base.
- Les sources d'un même conteneur (plusieurs `sourceId` pour un `itemId`) sont distinguées côté API, côté SQL et côté local.

### Écriture (R2, R4)

- Seuls les **nouveaux** liens sont validés : source configurée active, appartenance exacte (`sourceId`), workspace, lifecycle, placement direct page/dossier. Un ancien lien hors cible ou indisponible reste conservable et retirable.
- Un remplacement de définition (ou une résolution de conflit) qui effacerait `targetSourceId` d'une relation encore présente est refusé : un ancien client ne peut pas détruire silencieusement la configuration.
- `database:property` n'est plus créable ni supprimable par les commandes de relations génériques ; le writer interne et la lecture historique restent intacts.
- Un `itemId` mal formé sur la liste des relations répond 400 au lieu d'élargir la requête au workspace.

### Agrégation (R3)

- `rollupValueOf` valide la source configurée, la source réelle du schéma cible, la propriété cible et l'appartenance des liens conservés ; sinon `undefined` (« — »), jamais un faux compte.
- **`count` lui-même** peut être indisponible (source supprimée, cible absente, corpus local partiel) : `displayRollupCell` n'affiche plus le nombre brut de liens à la place.
- Une entrée membre de plusieurs sources utilise les valeurs **de la source concernée** (`entriesBySource`), plus la dernière écrasée.
- Source propriétaire supprimée/archivée : sa projection et son schéma disparaissent de l'agrégation.
- Formulaire de configuration : cibles limitées à la source configurée ; une cible devenue étrangère est signalée, plus jamais présentée comme valide via la liste globale.

### Récupération (R4)

- `buildManifest`/`validateCanonicalExport` indexent désormais les sources par **`sourceId`** (repli legacy `ownedSourceIdFromItemId`) au lieu du `databaseId` hôte ; les vraies sources dupliquées restent refusées, les entrées sont validées contre leur source exacte.
- `createDatabaseRestoreTarget` indexe les sources séparément, vérifie la source propriétaire des entrées et réhydrate **toutes** les révisions de définitions, pas seulement celle du hôte.

### Interface

- Panneau de relation : rangée « Liée à » (recherche de source, chargement/erreur/réessai), rangée « Limite » (menu « 1 page » / « Aucune limite »). Confirmation non destructive avant changement de cible ou réduction de cardinalité ; les liens ne sont jamais supprimés.
- Cellule et volet : recherche des pages de la source configurée, retrait explicite d'un lien hors source, états chargement/erreur/réessai/vide. Les relations historiques non configurées conservent la liste antérieure (compatibilité assumée).
- Sous-menu d'agrégation : `overlap` + `gutter=0` supprime le trou de 6 px où le survol refermait le menu et détachait l'élément pendant un clic.

## Preuves exécutées

### Parcours navigateur (Playwright, pile isolée `myownnotion-057-e2e` sur 5547, jamais la base de dev)

- `tests/e2e/database-relations-rollups.spec.ts` — **2/2 sur `chromium-desktop` et 2/2 sur `chromium-mobile`**.
  1. Source B vide → relation A→B avec choix de source → agrégation configurée (cible `Amount`, Somme) pendant que B est vide → rechargement : la source est conservée → deux entrées 10 et 20 → somme **30** et formule **60** dans le volet et la table → rechargement → hors ligne, retrait d'un lien → **10 / 20** immédiats → reconnexion → rechargement → toujours 10 / 20.
  2. Deux sources dans le même conteneur : la propriété de la source principale n'est **pas** proposée, seule celle de la source secondaire l'est ; l'entrée principale n'est pas sélectionnable ; somme = 17 après rechargement.
- Captures expurgées (données de test) : `evidence/candidate/relation-settings-light.png`, `relation-limit-light.png`, `relation-source-search-light.png`, `relation-values-light.png`, `relation-values-dark.png`, `relation-values-dark-390.png`, `relation-values-dark-320.png`.

### Coût local

Le contexte d'agrégation local scanne toutes les sources et leurs entrées. Les
surfaces qui se montent ensemble (volet d'entrée et son aperçu, vue et panneau)
partagent désormais **une seule lecture en cours** au lieu d'en lancer une
chacune ; un montage ultérieur relit des données fraîches, donc l'invalidation
reste explicite et rien n'est servi depuis un cache périmé. Test dédié dans
`apps/web/tests/local-rollup-source.spec.ts` (une lecture pour deux appels
concurrents, une nouvelle lecture ensuite).

### Comparaison chiffrée référence / candidat (relation)

| Surface | Notion (mesuré) | Candidat (mesuré) | Écart assumé |
| --- | --- | --- | --- |
| Panneau de configuration | 300 × 94 px, **3** rangées | 262 × 64 px, **2** rangées | Pas de rangée « Ajouter une propriété liée » : R5 non livrée, aucune option factice. Largeur imposée par le panneau de colonne. |
| Menu « Limite » | 250 × 65 px, coche à droite | 288 × 82 px, coche à droite | Densité du menu commun (`property-settings__menu`), environ 34 px par item contre 28 px. Non modifiée ici pour ne pas changer tous les menus de propriété. |
| Ordre et libellés | Liée à / Limite (1 page, Aucune limite) | Liée à / Limite (1 page, Aucune limite) | Aligné. |
| Thèmes | clair et sombre relevés | clair et sombre vérifiés | Couleurs issues des tokens, pas des valeurs Notion. |

Ces écarts sont documentés, pas présentés comme parité atteinte.

### Portée élargie des contrôles

- `database-integration` **complet** : 44 fichiers, 426 tests verts sur PostgreSQL jetable (après mise à jour de l'attente de liste des migrations, qui ignorait `0021_database_entry_numbers` ajoutée par une autre passe).
- Build web : 4 193 sorties, 2 163 actifs précachés, code 0.

### Contrôle sur les données réelles du propriétaire (pile de dev, 8080)

Après les refactorisations (`entriesBySource`, `count` strict, résolution de la
source d'une vue liée), la base existante affiche toujours la même agrégation :
`89,9` sur l'entrée liée, `0` ailleurs, sans erreur console. Le panneau de la
colonne Relation ouvre bien « Liée à » (source conservée) et « Limite : Aucune
limite ». Aucune donnée n'a été modifiée par ce contrôle ; aucune capture de
cette base n'est conservée dans les preuves (noms du workspace réel).

### Tests automatisés (commandes et résultats réels)

- **Suites unitaires complètes** `vitest --project domain --project web --project client-core --project contracts` : **304 fichiers, 3 057 tests, exit 0**.
- **Typecript** : `tsc --noEmit` vert sur `packages/domain`, `packages/client-core`, `packages/contracts`, `packages/database`, `apps/api`, `apps/web`. Les erreurs de fixtures préexistantes du domaine (`schema.spec.ts`, `query.property.spec.ts`) sont corrigées.
- **PostgreSQL jetable** (`bun scripts/ci/run-vitest-with-postgres.ts`) :
  - `database-relation-recovery.integration.spec.ts` (owned + secondaire, archive chiffrée réelle, restauration, ré-export) : 2/2 ;
  - `database-relation-isolation.integration.spec.ts` (arêtes d'autres propriétaires préservées) : 3/3 ;
  - `relation-source-mutation.integration.spec.ts` (sources, lifecycle, concurrence, historique) : 13/13 ;
  - `relationship-security.integration.spec.ts`, `database.integration.spec.ts` : verts ;
  - `restore.integration.spec.ts` et `reference-backups.integration.spec.ts` : verts.
- **Domain** `canonical-export-sources.spec.ts` + `canonical-export.spec.ts` : **85/85**.
- **Menu de relation** (`relation-value-menu.spec.tsx`) : 3 tests — seule la source configurée est listée, recherche sans résultat, ajout, retrait d'un lien conservé hors source, liste historique préservée sans source.
- **Relations / menu / agrégation** : `relation-source.spec.ts` 7, `relation-catalog.spec.tsx` 2, `relation-property-settings.spec.tsx` 1, `rollup-settings.spec.tsx` 5, `local-rollup-source.spec.ts` 4, `database-rollup.spec.ts` 4, `property-configuration-async.spec.tsx` 6, `database-view-loading.spec.tsx` 29.
- **API projection** : `database-query-service`, `database-query-rollups`, `database-query-source-loading` verts.
- **Biome** : vert sur tous les fichiers 057 (seuls restent deux avertissements `organizeImports` préexistants dans `graph-canvas-paint.spec.ts` et `knowledge-graph-global.spec.tsx`, hors périmètre).

## Défauts antérieurs corrigés dans la même passe

Reproduits **sans** nos modifications (fichiers restaurés, tests relancés, puis rétablis), puis corrigés :

- `database-projection-loading.contract.spec.ts` > « batches protected fields… » : la projection transmettait tout son enregistrement (noms, dates, numéros) à la couche de contenu protégé, qui n'utilise que l'identité et la version. Seuls `{entryId, valueVersion}` traversent désormais cette frontière ; l'attente du test est alignée.
- `linked-databases.contract.spec.ts` > « restores an owned source… » : la restauration perdait `createdAt`/`updatedAt` des appartenances (colonnes `defaultNow()`). Les archives portent maintenant ces instants en optionnel — les archives antérieures restent valides — et la restauration les réinsère. Un horodatage invalide ou une modification antérieure à la création est refusé (`database-entry.timestamp`).

Après correction : `api-contract` et `workspace-contract` sont **entièrement verts** (237 fichiers, 3 122 tests, exit 0).

## R5 — avancement au 12 novembre (partiel, non livrable)

Décisions et observation Notion consignées dans `plan.md` et `reference-notion.md`.
Implémenté et vérifié à ce stade :

- `relation.config.reciprocalPropertyId` (domaine, schéma, contrat HTTP) et
  helpers `relationPairIssue` (forme **et** croisement des sources),
  `reciprocalRelationOf`, `inverseRelations`, `inverseTargetPropertyPairs`.
- Commandes `database.relation.pair.create` (transaction unique, CAS des deux
  définitions, auto-relation en une seule), `database.relation.pair.remove`
  (supprime l'inverse, conserve la relation et ses liens) et
  `database.entry.relation.patch` (une arête, idempotente, coordonnées de
  l'entrée propriétaire).
- Refus de supprimer une propriété appairée (`database.relation.pair-active`),
  libellés de changement dédiés, échantillons de parsing.

Preuves : domaine + contrats + client-core **130 fichiers, 1 934 tests** ;
`database-integration` **426 tests** sur PostgreSQL jetable ; `tsc` vert sur
domaine, contrats, database, client-core, API.

**Non fait, donc R5 non livrable :** la projection locale et l'outbox ne
connaissent pas encore ces commandes (elles sont refusées hors ligne), la
lecture inverse n'est pas branchée dans l'API ni en local, et aucune interface
n'expose la paire. Les commandes ne sont atteignables par aucun utilisateur ;
l'objectif reste ouvert.

## Limites et non-faits

- **R5 relation inverse** : non implémentée. Aucune option factice n'est affichée. Décision et sous-scope proposé dans `plan.md` ; il reste des choix produit (activation sur relation existante, désactivation, suppression/restauration de chaque côté, auto-relation, concurrence, hors ligne).
- Les relations historiques non configurées gardent l'ancienne liste de pages (pas de filtrage par source tant qu'aucune cible n'est choisie) : compatibilité transitoire, pas parité finale.
- Une entrée hors ligne dont les valeurs ne sont pas présentes localement affiche « — » (indisponible), jamais un résultat inventé.
- Le refus de géolocalisation, les erreurs réseau et l'état « source indisponible » dans le sélecteur ne sont couverts que par tests unitaires, pas par un parcours navigateur.
- Validation ciblée : pas de `checks:local` complet, pas de build d'images, pas de suite e2e Firefox/WebKit, pas d'exécution sur les autres parcours existants au-delà des suites relancées ci-dessus.
- Réciprocité : l'observation de référence (`reference-notion.md`) n'a jamais activé l'interrupteur Notion ; les effets réels n'ont pas été observés.
- Pas de comparaison chiffrée Notion/candidat (`notion:parity:verify`) sur les nouvelles surfaces ; captures relues visuellement seulement.
- Les données de la base de dev (profil `app-profile-8080`) ont servi aux essais exploratoires ; les parcours de validation utilisent une pile isolée et des bases jetables.

## Suite recommandée

1. Décider et implémenter R5 sur le sous-scope proposé, sans seconde vérité.
2. Ajouter un test navigateur des états d'erreur du sélecteur de source et du panneau de relation.
3. Comparaison Notion/candidat chiffrée et revue visuelle propriétaire.
