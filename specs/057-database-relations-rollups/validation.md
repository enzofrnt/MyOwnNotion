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

**Édition depuis le côté inverse** (implémentée, non encore prouvée en
navigateur) : le menu de la propriété inverse n'est plus en lecture seule ; il
écrit l'arête du partenaire via `database.entry.relation.patch` avec la page
courante comme cible, en utilisant l'identifiant d'entrée transmis par la table
et le volet. La construction de la commande est extraite
(`inverse-relation-edit.ts`) et testée (2 cas). Le pas E2E correspondant n'a pas
abouti : dans le volet de l'entrée cible, le bouton de valeur de la propriété
inverse n'a pas été trouvé (`Projets liés`) ; il reste à vérifier ce que le
volet rend pour cette propriété.

**Rangée « Ajouter une propriété liée »** (nouvelle surface, 2026-11-12) :
captures `evidence/candidate/pair-row-{light,dark}.png` et
`pair-menu-{light,dark}.png`, prises sur l'application réelle. Deux défauts
visuels trouvés et corrigés : le champ de nom s'affichait comme un titre (mise
en page de menu), et la rangée passait sur deux lignes en tronquant l'état. Elle
tient maintenant sur une ligne, état lisible à droite ; dans la largeur du
panneau (262 px contre 300 px chez Notion), le libellé se termine par une
ellipse — écart de largeur assumé, pas une troncature du sens.

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

Ajouté depuis : lecture inverse **serveur** (requête indexée par cible,
filtrée sur la source et la propriété partenaires) et dans le **contexte
d'agrégation local**, donc les deux côtés affichent les mêmes liens et une
agrégation sur la propriété inverse calcule la même valeur. Web complet
(178 fichiers, 1 148 tests) et projection API (21 tests) verts.

Ajouté précédemment : application **hors ligne** d'un patch d'arête (traduction vers
le remplacement de valeurs existant, idempotente, testée sur la vraie fonction)
et **lecture inverse** dans le chargement de vue local (arêtes entrantes du
partenaire fusionnées, carte d'entrée du appelant non mutée ; 2 tests).

Ajouté depuis : **correctifs serveur prouvés sur PostgreSQL** — résolution de
la source canonique (les commandes traitaient l'identifiant de source comme une
page hôte), retrait de paire par mise à la retraite de l'inverse (l'impact
destructif est explicitement assumé par la commande de paire seule), et ajout
de la colonne inverse à toutes les vues existantes pour qu'elle soit visible.
Tests d'intégration : création, retrait, refus de supprimer une propriété
appairée (`relation-pair.integration.spec.ts`, 2 cas) ; suite PostgreSQL
complète **428 tests**, avec `pg_dump` 18 sur le PATH comme documenté.

Ajouté depuis : **support local/outbox des deux commandes de paire**. La
projection prépare et applique les deux définitions dans une seule transaction
Dexie (deux révisions, deux lignes, chacun dans le bon magasin), et refuse
localement de supprimer une propriété appairée, comme le serveur. Tests
`relation-pair-local.spec.ts` : création, retrait (inverse retirée, relation
conservée), refus de suppression ; client-core **686 tests verts**.

Ajouté depuis : la **présentation enregistrée** reçoit la colonne inverse des
deux côtés — serveur (nouvelle révision de présentation dans la même
transaction) et local (présentation scellée avec la définition). Assertions
dédiées dans les tests PostgreSQL et client-core.

**Diagnostic du blocage d'exposition** : le chemin HTTP fonctionne. Un test de
contrat ajouté (`relation-pair.contract.spec.ts`) crée puis retire une paire via
`POST /v1/mutations/batch` et passe. En revanche, le parcours navigateur reste
bloqué : après l'activation, l'état de synchronisation affiché devient
« offline » alors qu'aucune réponse 4xx/5xx n'est observée (écouteur de
réponses en place). **Cause trouvée et corrigée** : après une paire, `GET /v1/changes` renvoyait
500, ce qui mettait la synchronisation hors ligne. Les définitions modifiées par
la commande de paire n'étaient pas scellées dans le contenu protégé (le plugin
ne scellait que `database.create`, `definition.replace` et `source.create`).
Le scellement couvre désormais les deux sources d'une paire ; les 500 du flux
ont disparu dans le parcours réel.

**Deux corrections de contrat supplémentaires** : un marqueur `inverseEdges`
distingue le côté qui lit les arêtes du partenaire (sinon le côté canonique
devenait aussi en lecture seule), et `inverseTargetPropertyPairs` ne dérive plus
l'identité de source depuis `definition.databaseId` (c'est l'item propriétaire,
pas la source, pour une source secondaire).

**Résolu** : la cellule inverse affichait « — » parce que la lecture
d'entrantes filtrait sur `metadata.databaseId`, alors que l'application écrit
l'identifiant de la **page propriétaire**, pas celui de la source. Les
identifiants de propriété étant uniques, la lecture ne filtre plus que sur la
propriété (SQL et Dexie). Un test client-core couvre le cas avec l'identifiant
réellement écrit.

**Parcours navigateur à deux sens : vert** — activation, colonne inverse sur la
source partenaire, lien créé côté canonique lu depuis l'inverse, y compris après
rechargement, sur **desktop et mobile** (3 parcours par projet). L'interface
d'activation est donc exposée.

Ancienne piste : l'état
« offline » est posé par `#runOperationalPageSynchronization` quand
`legacyConflictRecovery.recoverAvailable()` signale une panne de transport
(`apps/web/src/services/local-content.ts:800`), pas par le rejet de la commande.
Il faut donc instrumenter cette sonde/le transport au moment de l'activation,
et vérifier si la requête part réellement. L'interface est masquée tant qu'il n'est
pas isolé.

**Blocage d'exposition précédent** : une fois l'interface d'activation
rétablie et le parcours navigateur rejoué, les mutations reviennent en **500**
via HTTP alors que l'exécuteur passe en test direct sur PostgreSQL. L'interface
et le parcours ont donc été retirés à nouveau ; il faut diagnostiquer le chemin
HTTP (validation de commande ou sérialisation) avant toute exposition.

**Écart d'affichage précédent** : la colonne inverse est ajoutée aux
vues de la *définition*, pas à la présentation enregistrée. Tant que la mise à
jour de présentation (serveur et local) n'est pas écrite, la colonne n'apparaît
pas dans la table ; c'est la prochaine étape, avec la réactivation de
l'interface d'activation.

Précédemment : **l'interface d'activation a été retirée** : l'outbox locale ne sait pas encore
appliquer une commande qui écrit deux schémas, et l'application applique toute
mutation en local d'abord — le bouton échouait donc silencieusement. Aucun
contrôle inopérant n'est laissé visible.

Précédemment ajouté : **interface d'activation**. La rangée « Ajouter une propriété
liée » affiche Désactivé/Activé, demande le nom de l'inverse et crée la paire ;
« Retirer la relation liée » supprime l'inverse en gardant l'original et ses
liens. Le côté inverse est **en lecture seule** pour l'instant : il affiche les
liens du partenaire via la lecture partagée et refuse d'écrire sur la mauvaise
entrée, avec une explication pour les technologies d'assistance. Web complet
(178 fichiers, 1 149 tests) et typage verts.

**Non fait, donc R5 non livrable :** l'édition depuis le côté inverse n'est pas
livrée —
il manque la rangée « Ajouter une propriété liée » (valeurs Désactivé/Activé)
et le passage de l'identité de la source courante jusqu'au panneau de
propriété, puis l'édition depuis le côté inverse et la preuve Playwright à deux
sens (activation, mêmes liens des deux côtés, ajout depuis l'inverse, hors
ligne). La création/retrait de paire n'est pas appliquée hors ligne : c'est une
écriture de schéma, à traiter explicitement. Les commandes restent
inatteignables par un utilisateur ; l'objectif reste ouvert.

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
