# Audit de départ — 11 novembre 2026

Audit statique de l'arbre présent, non de HEAD. Aucun test ou reproduction navigateur lancé pour ce diagnostic. Les références et tests cités sont des pistes vérifiées par lecture, pas la preuve d'un scénario complet. Distinguer relation de propriété de base et relations génériques du graphe.

## Constat vérifié dans le code

1. `packages/domain/src/databases/types.ts` : la configuration relation ne porte que `cardinality`, pas l'identité d'une source cible. `property-configuration.tsx` configure la cardinalité sans choix de base.
2. `apps/web/src/features/databases/local-rollup.ts` infère les sources à partir des entrées déjà liées ; sans liens, `rollup-settings.tsx` propose toutes les propriétés. Ce n'est pas une preuve de source cible. La même fonction déduplique par `source.itemId` et attribue cette identité aux propriétés/entrées : vérifier le cas plusieurs `sourceId` sur un même conteneur contre `packages/client-core/src/databases/local-database-repository.ts`. `rollup-settings.tsx` résout la cible configurée dans `targets`, pas dans les seules candidates : une cible hors source peut paraître valide.
3. `relation-value-menu.tsx` et ses fournisseurs dans `hierarchy-explorer.tsx` ne filtrent pas par source ; la liste est alimentée par des pages actives et ne couvre pas forcément les dossiers-entrées valides. `table-view.tsx` exclut l'entrée courante : le cas auto-relation doit être examiné.
4. `apps/api/src/databases/database-commands.ts` valide l'existence des cibles et refuse les purgées, mais pas la source cible ; la projection `packages/client-core/src/outbox/apply-to-projection.ts` suit un chemin analogue. `packages/domain/src/databases/values.ts` déduplique les UUID et applique `one/many`. Examiner explicitement le statut corbeille et les changements concurrents.
5. Les valeurs de relation sont matérialisées comme liens `database:property` dans `packages/database/src/repositories/database-repository.ts`, avec metadata source/propriété. Le chemin générique `packages/domain/src/content/relationships.ts` ne réserve que `page:link` ; vérifier par test si `database:property` peut être créé/supprimé hors des invariants via les routes génériques, puis fermer tout contournement confirmé sans détruire l'existant.
6. Dans `apps/api/src/routes/relationships.ts`, inspecter la gestion d'un `itemId` invalide : le parseur pourrait substituer `undefined` puis élargir la liste au workspace. Tester le contrat et les permissions avant de qualifier l'impact ; une erreur doit rester bornée et explicite.
7. `database-view.tsx` charge le contexte local sous conditions différentes de `services/databases.ts` : vérifier la formule liée à une relation sans agrégation explicite. `useLocalDerivedOptions` intercepte une erreur ; vérifier état obsolète et reprise plutôt que supposer une cohérence.

## Scénarios à reproduire avant correction

- Sources A et B vides ; relation A → B ; agrégation configurée avant ajout de lien. Les propriétés de B seulement doivent apparaître.
- Deux sources distinctes dans un même conteneur ; chacune possède une propriété et des entrées différentes. Ni fusion ni perte de schéma.
- A → B, deux entrées de B 10 et 20 ; somme 30 et formule 60 ; table/volet/aperçu, filtre/tri puis pagination en ligne/hors ligne.
- Relation historique vers page ordinaire, sources multiples, cible archivée ou non disponible : conserver et expliquer, ne rien effacer au chargement.
- Deux sessions/devices, changement de cardinalité/source, concurrence, perte de connexion ; rejouer l'outbox, vérifier refus et réconciliation.

## Couverture existante à compléter

`packages/database/tests/relationships.integration.spec.ts`, `apps/api/tests/relationships.contract.spec.ts`, `packages/database/tests/database.integration.spec.ts`, `packages/client-core/tests/database-local-mutation.spec.ts`, `tests/e2e/relationships.spec.ts`, `tests/e2e/databases-schema.spec.ts`, `apps/web/tests/rollup-settings.spec.tsx`, `apps/api/tests/database-query-rollups.spec.ts`. Le test de menu d'agrégation injecte des métadonnées artificielles ; il ne prouve pas que la source correcte est configurée et transportée de bout en bout.

## Référence externe et limites

- [Relations et agrégations — Notion](https://www.notion.com/help/relations-and-rollups) : choix d'une base, sélection de pages, relation inverse facultative ; voir également [guide illustré](https://www.notion.com/help/guides/using-relation-and-rollup-properties).
- [Propriétés de base — Notion](https://www.notion.com/help/database-properties) : principe d'agrégation via une relation.
- Ces pages ne remplacent pas la capture de la référence. La disposition française exacte, le comportement d'auto-relation, les conséquences de changement et les interactions hors ligne restent à relever. Ne pas confondre synchronisation externe Notion et réciprocité.
