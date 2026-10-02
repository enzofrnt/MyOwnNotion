# Modèle de données — 029

## Identités et relations

| Entité | Champs déterminants | Relations et règles |
| --- | --- | --- |
| Élément canonique | `itemId`, `kind`, `title`, `trashState` | `kind ∈ page, folder, file, database, database_view`. Un seul placement actif pour tout élément hors racine. Une base et une vue liée n'ont pas de document de page. |
| Page de base | `itemId` de type `database` ou `database_view` | Possède zéro, une ou plusieurs sources. Une page sans source propre est `database_view` tant qu'elle n'en crée pas ; la première source créée la fait devenir `database`. Enfants directs : pages et dossiers des sources qu'elle possède, jamais une autre base. |
| Source | `sourceId`, `ownerItemId`, `name`, `schemaRevisionId`, propriétés, rôles | `sourceId` différent de `ownerItemId`. Plusieurs sources peuvent partager le même `ownerItemId`. L'origine n'est pas unique. Existence, déplacement et suppression suivent cette page. Une source sans vue reste récupérable. |
| Présentation | `containerItemId`, `viewsRevisionId`, `views[]` | Le conteneur est `database` ou `database_view`. Les deux peuvent afficher plusieurs vues. `database_view` ne possède aucune source. Ordre des onglets stable. |
| Vue enregistrée | `viewId`, `sourceId`, `format`, `filter`, `sort`, `group`, `visiblePropertyIds`, `icon?` | `viewId` unique ; référence une source accessible, même d'un autre conteneur. Cinq formats : table, board, gallery, list, calendar. `icon` est un slug optionnel ; absent ou null, l’icône du format reste. Configuration par vue ; schéma/propriétés par source. |
| Entrée active | `entryItemId` page ou folder, placement `parentId = source.ownerItemId` | L'appartenance découle de ce placement direct ; aucun descendant implicite. Un élément n'appartient qu'à une source active à la fois. Il conserve son identité et peut héberger ses propres enfants, dont une base. |
| Valeurs historiques | `(sourceId, entryItemId)`, `valuesRevisionId`, valeurs | Persistantes même hors de la source ; montrées uniquement quand le placement rend l'entrée active dans cette source. Un retour réactive les mêmes valeurs. |
| Bloc intégré | `containerItemId` et `blockId` | Dans une page classique, affiche les vues de la page de base enfant. Pas de liste d'embeddings séparée du document. |
| Lien d'enfant | `targetItemId`, `blockId` | Bloc de lien habituel vers la base créée pleine page, sans badge flèche quand cible enfant direct. Distinct du placement. |

Les définitions et les valeurs restent chiffrées par les mécanismes applicatifs existants. Les contraintes SQL et domaine valident identité, type, propriété et placement avant d'accepter les charges protégées. Un champ de présentation ne doit pas contenir une copie du schéma de source.

## Matrice de contenance

| Parent | Enfants directs autorisés | Particularité |
| --- | --- | --- |
| Racine, page, dossier | page, folder, file selon les règles existantes ; database, database_view | Création depuis `+` et insertion éditoriale seulement là où le parent accepte. |
| Database | page, folder | Chaque enfant direct est une entrée d'une source rattachée à cette page. |
| Database view | aucun | La page sans source propre est une feuille ; créer une entrée depuis une de ses vues vise la page d'origine de la source affichée. Créer une source ici convertit la page en `database`. |

Déplacement sous une base : valider absence de cycle et type page/dossier ; les valeurs d'une source précédente restent archivées. Déplacement hors d'une base : l'entrée disparaît de ses vues mais garde ses valeurs historiques. La source d'une vue peut changer sans déplacer aucune entrée.

## Transitions

| Opération | État après succès | Échec ou interruption |
| --- | --- | --- |
| Créer base | `database` placée + source distincte + première vue Table, en une transaction | Aucun sous-ensemble persistant ; projection optimiste annulée ou récupérable par même idempotency key. |
| Créer vue liée | `database_view` placée + une vue pointant vers source existante, aucun propriétaire ajouté | Aucun lien vers source inexistant ; bloc non confirmé réessayable. |
| Ajouter vue | Nouvelle vue ordonnée. La source est existante, ou nouvelle et rattachée à la page courante | Révision concurrente rejetée avec état courant. |
| Changer source | Seule référence `view.sourceId` modifiée ; interdite si la page n'a qu'une vue | Aucune source n'est supprimée. |
| Retirer la dernière vue d'une source sur sa page d'origine | Choix : vue seule, la source reste ; ou vue et source, la source disparaît | Une vue d'une source née ailleurs ne propose pas ce choix. |
| Supprimer la page d'origine | Confirmation avec le nombre de sources ; ces sources sont supprimées ; les vues ailleurs restent avec l'état « source demandée inexistante » | Annulation ne supprime rien. |
| Déplacer la page d'origine | Les sources gardent le même `ownerItemId` | Une source ne change pas d'origine sans la page. |
| Déplacer entrée dehors / retour | Placement change ; valeurs `(sourceId,entryId)` dormantes puis actives | Aucun doublon d'entrée ; échec garde placement antérieur. |

## Cohérence hors ligne et import

Le journal de mutations ordonne la création du conteneur avant le bloc qui le référence ; les projections chiffrées gardent source et présentation sous des clés distinctes. Une projection locale partielle/offloaded est un état de chargement, pas une preuve de suppression. Les conflits de révision des vues et de propriété de source sont explicites et rejouables.

L'import Notion crée des IDs déterministes séparés pour propriétaire, source et vues ; place les membres directs sous le propriétaire ; matérialise les affichages liés comme blocs/éléments sans créer une deuxième source. L'aperçu décrit les mêmes placements que l'application et rejette cycles et doubles appartenances contradictoires. Export et restauration préservent tous les IDs, vues, placements et valeurs dormantes.
