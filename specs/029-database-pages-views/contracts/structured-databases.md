# Contrats de la refonte des bases

Les formes ci-dessous sont normatives pour les nouveaux échanges ; les noms précis des types TS et chemins HTTP peuvent être adaptés aux conventions de `packages/contracts`, mais identité et invariants ne changent pas.

## Mutations et réponses

- `database.create`: `itemId`, `sourceId`, `initialViewId`, `parentId`, `placement`, `title`, `sourceName`, `idempotencyKey`. Résultat : conteneur canonique, source, présentation et révisions. `parentId` obligatoire hors racine, parent autorisé par la matrice. Pas de `hostPageId` ni d'embeddings détachés.
- `database_view.create`: `itemId`, `viewId`, `sourceId`, `parentId`, `placement`, `title`, `idempotencyKey`. Résultat : élément canonique lié et présentation à une vue ; aucune nouvelle source.
- `database.view.add/update/remove/reorder`: `containerItemId`, `viewId`, `expectedViewsRevisionId`, définition de vue. Le serveur vérifie au moins une vue sur propriétaire, une seule sur vue liée, et refuse `sourceId` modifié quand le propriétaire n'a qu'une vue.
- `database.entry.create`: `sourceId`, `entryItemId`, `kind: page|folder`, `title`, `values?`, `idempotencyKey`. Le placement est le propriétaire de la source ; une valeur de colonne Kanban est comprise dans `values`. La réponse renvoie placement, source et révision des valeurs.
- Déplacements ordinaires page/dossier : la validation du parent et le calcul d'appartenance sont atomiques ; aucun appel séparé ne doit « rattacher » l'entrée. `entry.values.update` exige une entrée actuellement directe de la source, mais les anciennes valeurs restent stockées lors d'un déplacement.
- `database.source.rename` modifie le nom de source indépendamment du titre du conteneur. Corbeille/restauration s'appliquent au `ownerItemId` et propagent l'état de source.

Tous les rejets emploient les erreurs structurées existantes avec un code pour parent non autorisé, source introuvable/indisponible, source verrouillée de l'unique vue et conflit de révision. Les mutations sont idempotentes et les charges sensibles chiffrées.

## Lecture et synchronisation

- `source` : `sourceId`, `ownerItemId`, `name`, propriétés et révision. Une seule source par propriétaire.
- Une propriété porte facultativement `icon` (slug borné à 40 caractères ou null) : absence/retrait = symbole du type. Ce choix appartient à la définition de source, traverse les révisions chiffrées, export et sync, et ne modifie pas les valeurs. Les vues et pages de la même source le partagent.
- `presentation` : `containerItemId`, vues ordonnées et révision ; une vue expose `viewId`, `sourceId`, `format`, `filters`, `sort`, `group`, `visiblePropertyIds` et, si elle est choisie, `icon` (slug ou null ; absente, l’icône du format reste).
- `query(viewId)` : résout `sourceId` depuis la vue, inclut seulement les enfants directs actifs du propriétaire et leurs valeurs pour cette source ; état `ready | loading-partial | source-trashed | source-missing`, sans confondre cache partiel et suppression.
- La projection de hiérarchie envoie `kind=database|database_view` directement. L'entrée reste `page|folder`. Sa lecture reprend l'icône de cet élément (`icon`, emoji ou null) : la vue table l'affiche à la place du glyphe par défaut. Le cache local et le flux de sync scellent source et présentation séparément et conservent les curseurs/conflits existants.

## Document et échange durable

- Bloc canonique `databaseView` : `{containerItemId, viewId}` plus identité de bloc. Le bloc intégré affiche les vues de la page de base enfant et se place dans le flux du document ; retirer le bloc n'efface pas la source. Un lien pleine page reste le `pageLink` existant et conserve le vrai type d'icône de la cible.
- Export/backup v029 : éléments/placements canoniques, sources avec `ownerItemId`, présentations avec vues et leurs références, valeurs `(sourceId,entryItemId)` y compris dormantes, documents avec blocs de vue. Le validateur rejette source sans propriétaire, deux sources propres, vue sans source valide sauf source purgée référencée pour avertissement, entrée de type/placement invalide et cycle. La restauration est transactionnelle.
- Import Notion : aperçu et rapport annoncent le propriétaire et le parent réels de chaque membre ; même ID déterministe à l'application et à la reprise ; `.base` lié ne recopie ni source ni entrée.
