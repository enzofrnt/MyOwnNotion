# Data Model: Bases de données et tâches structurées

## 1. Principes d'identité

- Une base est une page canonique enrichie. Son `databaseId` est exactement
  son `itemId`.
- Une entrée est une page canonique. Son `entryId` est exactement son
  `itemId`.
- Une appartenance de base ne remplace ni le placement hiérarchique, ni une
  relation. Elle possède sa propre ligne et ses propres contraintes.
- Une tâche structurée n'est pas une entité supplémentaire. C'est une entrée
  d'une base dont la définition possède des rôles de tâche.
- Une vue n'est jamais une copie d'entrée. Elle ne garde que sa configuration et
  produit une projection des identités membres.

## 2. Entités persistantes en clair structurel

Ces lignes ne contiennent aucun libellé, filtre ou valeur privé. Elles servent
aux clés étrangères, aux contraintes, au routage des enveloppes et aux
reconstructions.

### DatabaseRecord — table `databases`

| Champ | Type | Règle |
| --- | --- | --- |
| itemId | UUID, PK/FK items | Identité de la page hôte et de la base |
| workspaceId | UUID, FK workspaces | Même workspace que l'item |
| definitionVersion | entier ≥ 1 | Version d'enveloppe, monotone |
| createdAt | instant | Création de la capacité |
| updatedAt | instant | Dernier commit de définition |

Contraintes :

- l'item hôte existe et est de type `page` ;
- une page porte au plus une capacité base ;
- le lifecycle de la base est celui de l'item hôte ;
- une page hôte peut elle-même être l'entrée d'une autre base ; cela ne crée pas
  de cycle de hiérarchie ni une seconde appartenance.

### DatabaseEntryRecord — table `database_entries`

| Champ | Type | Règle |
| --- | --- | --- |
| entryItemId | UUID, PK/FK items | Identité de la page d'entrée |
| databaseId | UUID, FK databases | Base propriétaire de l'appartenance |
| workspaceId | UUID, FK workspaces | Identique des deux côtés |
| valueVersion | entier ≥ 1 | Version de l'enveloppe de valeurs |
| addedRevisionId | UUID, FK revisions | Révision de création |
| createdAt | instant | Date d'appartenance initiale |
| updatedAt | instant | Dernier commit de valeurs |

Contraintes :

- l'item d'entrée existe et est de type `page` ;
- la clé primaire garantit au plus une appartenance active par page ;
- `entryItemId != databaseId` pour une base qui se contiendrait elle-même ;
- la visibilité dans une vue dépend du lifecycle de l'item, pas d'un second
  lifecycle porté par l'appartenance ;
- l'appartenance survit à la corbeille afin que la restauration retrouve les
  valeurs et la base.

### PropertyRelationship — table `relationships` existante

| Champ | Valeur |
| --- | --- |
| sourceItemId | page d'entrée |
| targetItemId | page active choisie |
| relationType | `database:property` |
| metadata protégée | `{ databaseId, propertyId }` |
| createdRevisionId / removedRevisionId | révision de la page d'entrée |

Une cible à la corbeille reste identifiable mais est affichée indisponible. Une
cible restaurée retrouve la même relation. Une purge canonique retire la
relation active selon les règles de cycle de vie existantes.

## 3. Payload `DatabaseDefinition` protégé

Enveloppe `database.definition`, liée par AAD au workspace, au type d'entité,
au `databaseId` et à `definitionVersion`.

~~~ts
interface DatabaseDefinition {
  format: "myownnotion.database-definition+json";
  formatVersion: 1;
  databaseId: Uuid;
  properties: DatabaseProperty[];
  views: DatabaseView[];
  taskRoles: TaskRoleMapping | null;
}
~~~

### DatabaseProperty

| Champ | Type | Règle |
| --- | --- | --- |
| id | UUID | Stable après renommage et réordonnancement |
| name | string 1..512 | Privé, non vide |
| type | voir union | Immuable hors commande de conversion confirmée |
| positionKey | string | Ordre fractionnaire stable |
| state | active, retired | Une propriété retirée reste interprétable pour l'historique |
| config | union typée | Compatible avec `type` |

Types :

- `title` : exactement un, toujours actif, non supprimable, sans valeur
  dupliquée ; lit et écrit `item.name` ;
- `text` ;
- `number` ;
- `date` avec `mode: date | instant` ;
- `status` ;
- `select` ;
- `multi-select` ;
- `checkbox` ;
- `relation` avec `cardinality: one | many`.

Le type `title` est structurel et ne compte pas parmi les huit propriétés que
le propriétaire peut ajouter. Une conversion ne peut jamais viser ou quitter
`title`.

### PropertyOption

Présente dans la configuration de `status`, `select` et `multi-select`.

| Champ | Type | Règle |
| --- | --- | --- |
| id | UUID | Valeur persistée dans les entrées |
| label | string 1..512 | Affiché avec le libellé, jamais par couleur seule |
| positionKey | string | Ordre indépendant du libellé |
| tone | jeton de thème | Apparence décorative, jamais seul porteur de sens |
| state | active, retired | Une option utilisée ne disparaît pas silencieusement |

Renommer ou réordonner une option ne réécrit aucune entrée. Retirer une option
utilisée demande un aperçu d'impact. Sans instruction explicite de remplacement
ou de suppression des valeurs, elle devient `retired` et reste affichable.

### TaskRoleMapping

| Champ | Type | Règle |
| --- | --- | --- |
| statusPropertyId | UUID | Propriété active `status` ou `select` |
| dueDatePropertyId | UUID ou null | Propriété active `date` |
| priorityPropertyId | UUID ou null | Propriété active `status` ou `select` |

Les identités peuvent changer uniquement par une commande de définition. Le
payload ne duplique aucune valeur de tâche.

## 4. Payload `EntryValues` protégé

Enveloppe `database.entry-values`, liée à `entryItemId` et
`valueVersion`.

~~~ts
interface EntryValues {
  format: "myownnotion.database-entry-values+json";
  formatVersion: 1;
  databaseId: Uuid;
  entryId: Uuid;
  values: Record<Uuid, NonRelationPropertyValue>;
  preserved: PreservedValue[];
}
~~~

Le titre n'apparaît pas dans `values`. Les relations sont lues depuis les
`Relationship` canoniques. L'absence de clé signifie « valeur absente ».

### NonRelationPropertyValue

| Type de propriété | Forme canonique |
| --- | --- |
| text | `{ kind: "text", value: string }` |
| number | `{ kind: "number", decimal: string }` |
| date civile | `{ kind: "date", date: "YYYY-MM-DD" }` |
| instant | `{ kind: "instant", instant: "...Z" }` |
| status | `{ kind: "status", optionId: Uuid }` |
| select | `{ kind: "select", optionId: Uuid }` |
| multi-select | `{ kind: "multi-select", optionIds: Uuid[] }` |
| checkbox | `{ kind: "checkbox", checked: boolean }` |

Règles :

- les décimaux sont normalisés depuis une chaîne ; `NaN`, infinis, notation
  non décimale et séparateurs ambigus sont refusés ;
- une date civile est validée au calendrier grégorien et ne traverse jamais
  `Date` comme minuit local ;
- un instant est accepté avec un offset explicite puis stocké en UTC ;
- les ensembles d'options sont uniques et triés par UUID pour une égalité
  indépendante de l'ordre de clic ;
- une option ou propriété `retired` reste décodable mais n'accepte plus de
  nouvelle valeur ;
- `false`, `0` et `""` sont des valeurs présentes, distinctes d'une
  absence.

### PreservedValue

| Champ | Type | Règle |
| --- | --- | --- |
| propertyId | UUID | Propriété source |
| sourceType | PropertyType | Type avant conversion/retrait |
| value | payload ancien | Jamais interprété comme le nouveau type |
| preservedAtRevisionId | UUID | Preuve d'origine |
| reason | incompatible-conversion, retired-property, retired-option | Cause sûre |

Une commande de conversion déplace ici les valeurs incompatibles tant que le
propriétaire n'a pas choisi remplacement, suppression ou restauration. Les vues
actives ne les utilisent pas ; l'écran d'impact et de conflit les expose.

### DefinitionImpactDigest

Le digest SHA-256 canonique couvre `databaseId`, `baseRevisionId`, la
définition candidate normalisée, les identités de propriétés/options touchées et
les couples `entryId/propertyId` affectés. Il ne contient aucune valeur brute
et n'est pas persisté comme index. Une projection locale `complete` peut le
calculer hors ligne ; le serveur le recalcule dans la transaction. Toute
différence refuse la confirmation avec `database.impact-stale`.

## 5. DatabaseView

~~~ts
interface DatabaseView {
  id: Uuid;
  name: string;
  type: "table" | "board" | "gallery" | "list" | "calendar";
  positionKey: string;
  state: "active" | "retired";
  properties: ViewPropertyPresentation[];
  filter: FilterSet;
  sorts: SortCriterion[];
  group: GroupCriterion | null;
  options: ViewOptions;
}
~~~

Une définition possède au moins une vue `active`. La suppression de la
dernière est refusée. Dupliquer une vue crée un nouvel UUID ; cela ne duplique
aucune entrée.

### ViewPropertyPresentation

| Champ | Type | Règle |
| --- | --- | --- |
| propertyId | UUID | Propriété active ou référence explicitement indisponible |
| visible | boolean | Ne modifie jamais la valeur |
| positionKey | string | Ordre propre à la vue |
| width | entier optionnel | Présentation table, bornée 80..800 px |

### FilterSet

| Champ | Type | Règle |
| --- | --- | --- |
| mode | all, any | Combinaison plate explicite |
| criteria | FilterCriterion[] | Ordre stable pour édition, sémantique d'ensemble |

Chaque critère porte `propertyId`, `operator` et, lorsque nécessaire, une
`operand` du type canonique de la propriété.

Opérateurs :

- tous types : `equals`, `not-equals`, `is-empty`, `is-not-empty` ;
- texte : `contains`, `not-contains` ;
- multi-sélection et relation : `contains`, `not-contains` ;
- date : `before`, `after`, `between` avec opérandes du même mode ;
- nombre : `less-than`, `greater-than`.

Un ensemble vide en mode `all` ou `any` n'exclut rien. Un critère qui
référence une propriété indisponible met la vue en état `invalid` ; il n'est
jamais ignoré silencieusement.

### SortCriterion

| Champ | Type | Règle |
| --- | --- | --- |
| propertyId | UUID | Propriété connue |
| direction | ascending, descending | Appliqué dans l'ordre du tableau |
| missing | first, last | Explicite, indépendant du client |

L'ordre final compare successivement les critères, puis la clé texte
normalisée du titre, puis `entryId`. Les textes utilisent NFKD, retrait des
marques et casse Unicode pour la clé primaire, puis la chaîne Unicode brute pour
départager. Les options utilisent leur `positionKey`, les nombres leur décimal
canonique, les dates leur valeur canonique et les relations la liste triée des
UUID.

### GroupCriterion et options de vue

Le regroupement accepte `status`, `select` et `checkbox`. Toute entrée
rejoint exactement un groupe, dont un groupe `missing`. L'identité de groupe
est l'UUID d'option, `checked`, `unchecked` ou `missing`, jamais le libellé.

- table : densité et gel visuel de la propriété titre ;
- board : `axisPropertyId` statut/sélection, ordre et état replié des colonnes ;
- gallery : propriétés de carte et `preview: none | page | first-safe-file` ;
- list : densité et propriétés secondaires ;
- calendar : `datePropertyId`, mode mois initial, espace `unscheduled`.

## 6. StructuredProjectionGeneration

Projection dérivée, ouverte et non persistée.

| Champ | Type | Règle |
| --- | --- | --- |
| generation | entier croissant | Change après échange atomique réussi |
| state | cold, building, ready, degraded | Jamais partial sous l'étiquette ready |
| sourceCursor | curseur canonique/local | Dernier changement appliqué |
| definitions | Map databaseId → definition | Définitions validées |
| entries | Map entryId → entry projetée | Titre, valeurs, relations et lifecycle |
| memberships | Map databaseId → Set entryId | Identités actives/connues |
| indexes | présence/égalité par propriété | Dérivés, privés, mémoire uniquement |
| failureCode | code sûr ou null | Sans libellé ni valeur |

Transitions :

~~~text
cold -> building -> ready
ready -> building -> ready       reconstruction atomique
ready -> degraded                échec incrémental ou d'intégrité
building -> degraded             source impossible à ouvrir/valider
degraded -> building -> ready    réparation
~~~

Une ancienne génération `ready` peut rester lisible pendant une reconstruction
planifiée. Dès qu'un échec prouve qu'elle est obsolète, elle n'est plus annoncée
complète.

## 7. DatabaseQuery et DatabaseQueryPage

### DatabaseQuery

| Champ | Type | Règle |
| --- | --- | --- |
| databaseId | UUID de chemin | Base active autorisée |
| viewId | UUID | Vue active de cette base |
| limit | 1..100 | 100 par défaut |
| cursor | chaîne opaque optionnelle | Liée à la génération et à la définition |

La requête n'accepte pas de filtre arbitraire en V1 : elle exécute la vue
enregistrée, ce qui évite deux configurations concurrentes et garde les filtres
privés hors URL.

### DatabaseQueryPage

| Champ | Type | Règle |
| --- | --- | --- |
| databaseId / viewId | UUID | Contexte vérifié |
| definitionRevisionId | UUID | Version de configuration |
| generation | entier ou null | Projection serveur/local |
| coverage | complete, partial | Jamais complete si une valeur attendue manque |
| availableCount | entier | Entrées évaluables |
| expectedCount | entier | Appartenances actives connues |
| rows | DatabaseQueryRow[] | Au plus `limit` |
| groups | GroupSummary[] | Exhaustif uniquement si coverage complete |
| nextCursor | opaque ou null | Aucun contenu privé |

Une ligne contient `entryId`, `revisionId`, titre, valeurs visibles, état de
relation, groupe, disponibilité locale et état de synchronisation. Elle ne
contient jamais une propriété masquée sauf besoin explicite de filtre/tri côté
projection locale ; cette valeur reste interne au moteur et n'entre pas dans la
réponse serveur.

## 8. Projection Dexie

La version locale ajoute :

- `databases: "itemId"` avec métadonnées structurelles et
  `sealedDefinition` ;
- `databaseEntries: "entryItemId, databaseId, [databaseId+availability]"`
  avec `sealedValues` ;
- les `relationships` existantes, appliquées aussi lors d'un snapshot et du
  change feed ;
- les mêmes `revisionHeaders`, `outbox`, `conflicts` et `meta`.

Les payloads sont scellés avant toute transaction Dexie. Une mutation locale
écrit atomiquement les lignes préparées, les relations, la révision et l'outbox.
Le verrouillage détruit les projections mémoire ouvertes, pas les enveloppes.

### Couverture

- `complete` : définition présente et chaque appartenance active possède ses
  valeurs évaluables ;
- `partial` : titre/métadonnées d'au moins une entrée présents mais valeurs
  manquantes ou déchargées ;
- une base avec `offlineIntent=true` ne peut être annoncée prête hors ligne
  qu'après couverture complète vérifiée.

## 9. Révisions, changements et conflits

### Snapshot de révision

- révision de page hôte : item + `DatabaseDefinition` ;
- révision d'entrée : item + `EntryValues` + relations de propriétés actives ;
- toutes les formes restent dans `revision.snapshot` protégé.

### Change envelope et snapshot canonique

Les deux contrats transportent, dans le même curseur :

- items ;
- relations ;
- définitions de base ;
- appartenances et valeurs d'entrée.

Le digest de snapshot couvre les quatre ensembles triés. L'application Dexie
est une transaction unique qui préserve outbox et conflits pendant un fallback
après compaction.

### Fusion

1. Comparer ancêtre/local/distant par UUID d'objet et nom de champ.
2. Garder le côté qui seul diffère de l'ancêtre.
3. Garder une valeur identique produite des deux côtés.
4. Fusionner des clés de propriété, option, vue ou valeur distinctes.
5. Produire un conflit pour la même clé divergente, une suppression contre une
   édition, un type contre une valeur incompatible, ou une définition absente.
6. Une résolution écrit une révision à deux parents sans altérer les sources.

## 10. Cycle de vie

- Corbeille d'une entrée : son item devient `trashed`; appartenance et valeurs
  restent conservées mais aucune vue active ne la projette.
- Restauration d'une entrée : même item, appartenance et valeurs redeviennent
  visibles.
- Corbeille d'une base : aperçu d'impact, puis transaction unique qui révise et
  met à la corbeille la page hôte et toutes ses entrées actives.
- Restauration d'une base : transaction unique rétablissant les mêmes identités,
  la définition, les valeurs et relations.
- Purge : la future orchestration produit les lifecycles/tombstones ; cette
  projection retire alors définitions, valeurs et index actifs correspondants.

## 11. Recherche, export et sauvegarde

La recherche ajoute aux documents d'entrée :

- texte des propriétés `text` actives ;
- libellés actifs de `status`, `select` et `multi-select` ;
- statut, priorité et date canonique lorsqu'ils sont mappés comme rôles de tâche.

Chaque correspondance garde `entryId` et `propertyId`; une entrée reste un
seul résultat dédupliqué même si plusieurs vues la montrent.

L'export versionné décrit définitions, options, vues, valeurs et relations par
UUID. La sauvegarde physique inclut les nouvelles tables et enveloppes ; le
validateur de référence compare comptes, digests, clés étrangères, versions et
capacité à reconstruire une génération `ready`.
