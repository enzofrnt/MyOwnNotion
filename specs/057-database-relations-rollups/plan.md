# Plan de reprise — relations et agrégations

## Point de départ et précautions

Lire d'abord `AGENTS.md`, la constitution, le canevas (§ 14, stockage, confidentialité et sync), les specs 009, 029 et 055, `docs/development.md`, `ui-quality` et `lessons.md`, `notion-parity`, `docs/design/ui-system.md`, puis `audit.md` ici. L'arbre de travail était fortement modifié au cadrage ; préserver les modifications existantes, examiner le diff réel et ne pas restaurer ou écraser aveuglément. Aucun commit, reset, migration destructive ou déploiement implicite.

## Phase 0 — référence et reproduction

Dans la page Notion que le propriétaire avait explicitement autorisée, limiter l'observation aux surfaces et données de test, sans sidebar ni contenu personnel. Si la session est expirée, demander un accès plutôt que contourner. Relever création de relation, choix/recherche de source vide et remplie, cellule et volet, cardinalité, auto-relation, réciprocité, changement de source, agrégation et erreurs. Conserver recettes, captures recadrées et extraits DOM expurgés, métriques, clavier/focus et les inconnues ; pas de capture personnelle. Reproduire ensuite les défauts dans une base locale isolée ; si indisponible, enregistrer le blocage sans inventer.

La documentation officielle [relations et agrégations](https://www.notion.com/help/relations-and-rollups) décrit choix de la base cible, sélection des pages et relation inverse optionnelle ; [guide relation/rollup](https://www.notion.com/help/guides/using-relation-and-rollup-properties) illustre la somme. Elle ne prouve pas les détails UI, les états hors ligne ou nos règles de migration.

## Phase 1 — contrat de données et compatibilité (bloquant)

Identifier précisément la **source canonique** (`sourceId`) indépendamment de l'item hôte et d'une vue liée ; vérifier les cas de plusieurs sources par conteneur et les appartenances multiples avant de modifier le modèle. Étudier l'extension versionnée de `DatabaseProperty` relation (source cible stable, cardinalité, éventuellement identité inverse), les validateurs et contrats `packages/domain`, `packages/contracts`, API et client local. Spécifier matrices ancienne/nouvelle définition, ancien/nouveau client/serveur et outbox déjà en attente. Un champ optionnel compatible en lecture n'autorise pas à supposer qu'un ancien client sait préserver des champs inconnus : le prouver par tests, sinon appliquer un contrôle de version/refus sûr.

Définir états explicites `historique non configuré`, `configuré`, `cible indisponible`, `cible incompatible`, `données locales incomplètes`. Les anciennes valeurs restent stockées et visibles. Pour cible historique unique, ne suggérer une migration qu'après vérification complète et confirmation ; si ambiguë/incomplète, demander un choix sans suppression. Changement de source/cardinalité : prévisualiser l'impact et proposer annulation ou conservation des liens historiques incompatibles, avec stratégie de restauration ; aucune réinterprétation silencieuse. Documenter transactions, révisions, schéma SQL et mécanisme de déploiement/sync ; ne pas inventer de migration SQL si le modèle déjà versionné suffit.

## Phase 2 — intégrité et écriture

Étudier `packages/domain/src/databases/{types,values,schema}.ts`, `apps/api/src/databases/database-commands.ts`, `packages/database/src/repositories/database-repository.ts`, `packages/client-core/src/outbox/apply-to-projection.ts` et tests correspondants. Valider appartenance, workspace, lifecycle, cardinalité et compatibilité sur serveur **et** projection locale ; tester accès générique au type interne `database:property` en création/suppression dans `packages/domain/src/content/relationships.ts` et dépôt des relations. Réserver les écritures internes sans casser les enregistrements et usages légitimes existants ; considérer concurrence, idempotence, conflits et transactions. L'API générique et ses usages (graphe/backlinks) ne sont pas la même chose qu'une propriété de base ; évaluer leurs contrats avant restriction.

Réciprocité : décider et documenter modèle atomique et cycle de vie après tests de référence ; ne pas ajouter simplement deux écritures indépendantes. Régression spécifique auto-relation et simultanéité. Si cette étape nécessite une décision du propriétaire, la poser clairement sans bloquer artificiellement le parcours unidirectionnel P1.

## Phase 3 — interfaces et agrégations

Adapter `property-configuration.tsx`, `relation-value-menu.tsx`, `hierarchy-explorer.tsx`, `table-view.tsx` et les surfaces de volet selon les vrais points d'entrée. La source ciblée doit venir de la configuration, non des liens déjà présents. Dans `local-rollup.ts` et `database-query-service.ts`, vérifier la résolution source réelle, les appartenances, l'invalidation du cache, les sources partiellement chargées et le coût ; corriger aussi la validation de `rollup-settings.tsx` contre les candidates, non l'ensemble global. Conserver les règles 055 pour résultats vides/indisponibles ; tester formule/rollup dans toutes les vues et avant pagination. Éviter chargement systématique de toutes les bases sans mesure ; évaluer les index/limites.

Les overlays réutilisent les primitives du repo, tokens, propriétaires CSS et `AppIcon`, avec états accessibles et gestion focus. Appliquer les leçons en vigueur ; capturer le candidat réel et comparer aux références ouvertes, en clair/sombre à 320/390 px. Une lacune UI matérielle bloque la convergence.

## Phase 4 — validation

Tests de domaine, contrats API, intégration PostgreSQL, local/outbox et sync ; E2E Playwright commité pour R1–R3, migration historique, indisponibilité, erreur et réciprocité si livrée. Tester export/import et sauvegarde/restauration avec des relations anciennes et nouvelles ; aucune perte sur aller/retour. Couvrir champs et codes d'erreur sûrs, concurrence et ancien client. Réaliser la comparaison visuelle Notion/candidat et consigner preuves expurgées, commandes et résultats réels dans `validation.md`. Choisir les contrôles depuis `docs/development.md` selon le diff complet ; résoudre ou expliquer les échecs existants, ne jamais présenter un test ciblé comme une suite globale verte.

## Contrat d'implémentation P1 — 2026-11-11

- `relation.config.targetSourceId?: Uuid` désigne la source canonique. Absence = relation historique non configurée, pas une source déduite. Le schéma filaire accepte ce champ optionnel ; la définition JSON et les révisions le conservent sans migration SQL ni modification des UUID des liens.
- Les lectures des relations historiques restent inchangées. Pour une relation configurée, valider les **nouveaux** liens contre la source active et son appartenance ; conserver les liens déjà enregistrés même indisponibles/hors cible lors d'une modification d'une autre valeur. Le retrait reste possible. Un changement de cible ne supprime aucun lien existant ; l'UI doit annoncer cette conservation et signaler les incompatibles.
- Les remplacements de définition ne doivent pas effacer la source cible d'une relation configurée encore présente : refus explicite plutôt qu'effacement par un ancien client qui ignore le champ. Une suppression intentionnelle de la propriété reste soumise au mécanisme d'impact existant. Un ancien serveur refuse le champ par son schéma strict : déployer serveur avant nouveau client ; ne pas masquer le refus dans le client.
- Ne pas inventer une base pour une relation vide/non configurée : le panneau d'agrégation attend une source configurée. La source configurée vide fournit déjà son schéma.
- Les relations réciproques restent une étape distincte après observation et conception atomique ; ne pas afficher de commande sans effet.

## Décisions ouvertes, pas des faits

- Choix exact de stockage, versionnement et protocole de réciprocité ; politique de changement de cible et cardinalité avec liens existants.
- Politique explicite de migration pour relations historiques multi-sources, entrées archivées, suppression et restauration ; comportement en absence de données locales et client ancien.
- Effets du partage futur, hors de cette livraison mono-utilisateur ; ne pas promettre une parité de permissions Notion non vérifiée.

## Décisions arrêtées après implémentation P1 — 2026-11-11

- **Changement de cible ou réduction de cardinalité** : les liens existants ne sont jamais supprimés ni réinterprétés. L'interface demande confirmation et l'écrit serveur/local ne valide que les ajouts ; un lien hors source reste listé et retirable. Une réduction `many → one` avec plusieurs liens est donc acceptée au niveau du schéma et signalée à la prochaine écriture de valeurs (comportement du normalisateur existant), pas convertie silencieusement.
- **Ancien client** : un remplacement de définition qui retirerait `targetSourceId` d'une relation encore présente est refusé (`database.definition` inchangé), plutôt qu'effacé. Un ancien serveur refuse le champ par schéma strict : déployer le serveur avant le client, sans masquer le refus.
- **Identité de source dans l'export/restauration** : `validateCanonicalExport` et `createDatabaseRestoreTarget` indexent par `sourceId` (repli `ownedSourceIdFromItemId`), valident une entrée contre sa source exacte et réhydratent toutes les révisions de définition. Les doublons réels de source et d'appartenance restent refusés. Aucune deuxième table de valeurs.
- **Menu imbriqué** : les sous-menus d'agrégation se superposent à leur déclencheur (`overlap`, `gutter 0`). Un écart de 6 px laissait le pointeur traverser du vide, fermait le menu et détachait l'élément pendant le clic.
- **Relations historiques** : tant qu'aucune source n'est configurée, l'ancienne liste de pages est conservée (aucune régression de saisie) ; la validation par source ne s'applique qu'aux relations configurées. Cette compatibilité transitoire est assumée et devra être revue avec R5.

## R5 — relation inverse : décisions arrêtées (2026-11-12)

Le propriétaire a tranché : mêmes liens des deux côtés, suppression d'une
propriété de paire **refusée** tant que la paire existe, écriture depuis les
deux côtés, et hors ligne autorisé lorsque les deux sources sont présentes
localement. Notion observé le confirme : la paire apparaît des deux côtés et
« retirer » supprime la propriété inverse en gardant la relation d'origine.

Contrat retenu :

- `relation.config.reciprocalPropertyId?: Uuid` sur **les deux** propriétés de la
  paire ; chacune porte aussi `targetSourceId` vers la source de l'autre. Une
  référence mutuelle et symétrique est vérifiée par la commande de paire, pas
  seulement par le schéma.
- **Une seule vérité** : les arêtes `database:property` existantes restent
  seules autoritaires, orientées par l'entrée qui possède la propriété
  canonique. Aucune arête miroir, aucun second tableau.
- Lecture inverse : pour une entrée de B, les cibles de `PB` sont les entrées X
  de A telles qu'il existe une arête `X --PA--> cette entrée`. Ajout d'une
  requête d'arêtes entrantes (SQL et Dexie) filtrée par `propertyId` partenaire.
- Écriture : une commande dédiée patche **une arête** sur l'entrée canonique
  (`database.entry.relation.patch` : databaseId, entryId, propertyId,
  targetItemId, present). Depuis l'inverse, l'interface envoie l'entrée X, la
  propriété PA et la cible Y ; jamais un remplacement global de valeurs.
- `database.relation.pair.create` crée les deux propriétés dans une seule
  transaction, avec CAS sur les deux définitions ; échec = aucune écriture.
- `database.relation.pair.remove` (le « retirer la relation liée » de Notion)
  supprime la propriété inverse, efface `reciprocalPropertyId` côté canonique et
  **conserve** la relation et ses liens.
- Supprimer une propriété qui porte encore `reciprocalPropertyId` est refusé
  avec un message qui renvoie vers « retirer la relation liée ».
- Hors ligne : la paire et les écritures d'arêtes passent par le même chemin
  local que les autres mutations ; si l'une des deux définitions n'est pas
  disponible localement, l'action est explicitement indisponible.

## Anciennes notes de report (conservées pour l'historique)

**Décision : non implémentée dans cette passe ; aucune option n'est affichée.** La référence Notion n'a jamais activé l'interrupteur : les effets réels (activation sur relation existante, désactivation, propagation du retrait, suppression/restauration) restent inobservés, et le canevas impose une vérité unique et la cohérence hors ligne/concurrence.

Sous-scope jugé faisable sans seconde vérité :
1. Les arêtes `database:property` restent seules autoritaires, orientées par une paire stable `{sourceA, propertyA, sourceB, propertyB}` dont une extrémité est propriétaire canonique ; l'autre est un alias de lecture, sans arête miroir ni second tableau.
2. Création de paire atomique (`pair.create`) : deux propriétés fournies avant enqueue, CAS des deux définitions, commit tout ou rien ; auto-relation = deux identifiants distincts dans une seule définition.
3. Écriture par commande dédiée identifiant la paire et l'extrémité canonique, jamais par `values.replace` depuis le côté inverse (qui écraserait des entrées tierces).
4. Restrictions explicites au départ : création neuve, `many ↔ many`, refus des conversions historiques ambiguës, du changement de cible/cardinalité d'une paire, et pas d'activation sur relation existante tant que la politique n'est pas décidée.
5. Suppression/suppression d'extrémité : retirer la paire par commande explicite avec impact, conserver l'historique ; ne pas inventer de transfert de propriété.

Choix produit à arrêter avant tout code : (1) activation sur relation existante et sort des liens historiques ; (2) désactivation — canonique seule, deux relations indépendantes, ou retrait des deux ; (3) suppression/restauration de chaque côté ; (4) cible/cardinalité modifiables après création ; (5) auto-relation à deux propriétés orientées ou propriété symétrique ; (6) add/add et add/remove concurrents ; (7) actions autorisées hors ligne sur corpus partiel. Tant que ces choix ne sont pas tranchés, T015–T016 restent ouverts et aucune UI de réciprocité n'est rendue.

## Exception de couverture — 2026-11-12

Mesure : `bun run test:coverage` sur le commit `a041a671`, mode « full » du
plan d'impact. Tous les tests passent ; seuls les seuils absolus échouent.

| Métrique | Non couvert mesuré | Plafond précédent (`main`) | Nouveau plafond |
| --- | --- | --- | --- |
| Statements | 2 343 | 2 216 | **2 360** |
| Lignes | 1 844 | 1 866 | 1 866 (inchangé) |
| Fonctions | 282 | 337 | 337 (inchangé) |
| Branches | 3 074 | 2 470 | **3 090** |

Dont **683 statements et 1 114 branches apportés par les fichiers modifiés ou
ajoutés de cette branche**, concentrés sur
`packages/domain/src/databases/formula.ts` (113 statements, 204 branches),
`packages/database/src/mutations/database-commands.ts` (75 / 97),
`packages/domain/src/databases/rollup.ts` (48 / 80) et
`packages/domain/src/databases/commands.ts` (32 / 72). Le reste du dépassement
vient de branches défensives de fichiers déjà couverts, rendues plus coûteuses
par les nouveaux chemins de validation.

Pourquoi une exception plutôt que des tests immédiats : le comportement neuf
est couvert au niveau public (`formula.spec.ts`, `rollup.spec.ts`,
`relation-pair.spec.ts`, `relationship-security.spec.ts`,
`tests/e2e/database-relations-rollups.spec.ts`), mais les branches restantes
sont des refus et chemins d'erreur d'un parseur de formules et d'une
validation d'import qui demanderaient des tables de cas dédiées. L'exception
est bornée : aucun fichier n'est exclu du décompte, aucun `istanbul ignore`
n'est ajouté, et les plafonds lignes/fonctions de la spec 019 sont conservés.

Suite pour rentrer dans le budget : tables de cas sur les erreurs de formule
(token, arité, type, référence), chemins de refus des commandes de base de
données, et cas de rejet du mapping d'import Notion. Réduire ensuite les
plafonds dans `vitest.config.ts` et `docs/development.md` — une baisse de
budget est toujours un progrès et doit être conservée.
