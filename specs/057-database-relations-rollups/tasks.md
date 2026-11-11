# Tâches — relations entre bases et agrégations

Statut : P1 (R1–R4) livré et vérifié ; R5 (relation inverse) non implémentée, décision dans `plan.md`. `[~]` = partiel, pas terminé. Preuves et limites dans `validation.md`. Les premières corrections fonctionnelles ont commencé après reproduction automatisée et contrat P1, avant achèvement des captures sombre/mobile : écart de séquence à résorber avant convergence. Dépendances : T001–T004 avant changements durables ; T005–T009 avant T010–T013 ; T014–T016 après le socle ; T017–T020 avant convergence.

## Fondation

- [~] T001 [P] Capturer les surfaces de relation Notion autorisées, ouvertes et expurgées, avec recettes, états, mesures, clavier, clair/sombre et largeurs étroites ; compléter `audit.md` et documenter toute impossibilité.
- [x] T002 [P] Reproduire les scénarios de `audit.md` sur des données locales fictives ; documenter la base exacte, les résultats et captures expurgées sans modifier des données réelles. (source vide, deux sources par conteneur, lien hors source et historique : rouges avant correction, verts après ; pile isolée et PostgreSQL jetable.)
- [x] T003 Définir dans `plan.md` la source canonique, les états, cardinalité, migration historique sans perte, politique de changement, compatibilité clients/protocole/outbox et décisions restantes ; demander clarification si une décision produit irréversible est nécessaire. (contrat P1 et décisions consignés ; R5 explicitement reportée.)
- [x] T004 Ajouter d'abord des tests de régression source vide, plusieurs sources par conteneur, lien hors source et historique mixte dans les suites domaine/API/local ; vérifier qu'ils démontrent le défaut avant correction. (7 tests domaine, 4 locaux, 2 API démontrés rouges avant correction.)

## Relations unidirectionnelles — R1, R2, R4

- [x] T005 Étendre et versionner le contrat source cible dans `packages/domain/src/databases/`, `packages/contracts/` et consommateurs concernés ; protéger les champs inconnus et anciennes définitions ; tests aller/retour et clients mixtes. (domaine + contrat HTTP + conservation legacy ; 85 tests d'export.)
- [x] T006 Valider source, appartenance, lifecycle, cardinalité et workspace dans `packages/database/src/mutations/database-commands.ts`, dépôt des bases et `packages/client-core/src/outbox/` ; tests de refus, idempotence, concurrence et offline. (23 tests dédiés API SQL/local + régressions, conservation historique et protections ancien client ; le chemin cité initialement sous apps/api n'existait pas.)
- [x] T007 Tester le contournement par relations génériques dans `apps/api/src/routes/relationships.ts`, `packages/domain/src/content/relationships.ts` et `packages/database/src/repositories/` ; corriger les failles confirmées et le traitement d'un `itemId` mal formé ; tests de sécurité et compatibilité. (14 tests nouveaux domaine/API/SQL ; lecture historique et writer interne conservés.)
- [x] T008 Préserver données historiques et ajout du choix/résolution explicite dans `property-configuration.tsx` ; changement de source/cardinalité avec impact, annulation et reprise, sans perte silencieuse. (source/limite, recherche, confirmation non destructive, réessai ; captures clair/sombre/320/390.)
- [x] T009 Corriger recherche/sélection/retrait des seules entrées valides dans `relation-value-menu.tsx`, `hierarchy-explorer.tsx`, `table-view.tsx` et volet ; tester pages, dossiers, liens archivés, auto-relation selon référence, recherche, clavier et données partielles. (source configurée, recherche, retrait hors source, états ; parcours navigateur 2/2 desktop et mobile.)

## Agrégation de bout en bout — R3

- [x] T010 Corriger `local-rollup.ts`, requête locale et `database-query-service.ts` pour une source cible canonique même vide ; distinguer `sourceId` et conteneur, tester plusieurs sources et corpus incomplet. (source canonique vide, extraction par source, entrée multi-appartenante, propriétaire inactif.)
- [x] T011 Corriger `rollup-settings.tsx` pour valider la cible choisie contre la source configurée ; éviter toute liste globale de repli trompeuse et signaler la configuration historique ou devenue invalide. (cibles limitées à la source, cible étrangère signalée, repli global supprimé.)
- [x] T012 Couvrir le scénario 10 + 20 = 30, formule 60, mêmes valeurs table/volet/aperçu et filtre/tri avant pagination côté API et local ; ajouter tests dans `packages/domain/tests/`, `apps/api/tests/`, `packages/client-core/tests/` et `apps/web/tests/` selon couches réellement modifiées. (30 et 60 dans table/volet, hors ligne 10/20, isolement de deux sources ; PG et navigateur.)
- [x] T013 Ajouter un parcours Playwright maintenu dans `tests/e2e/` de création relation A → B, B initialement vide, création des entrées, liaison, somme et vérification des surfaces ; couvrir source multiple et rechargement. (tests/e2e/database-relations-rollups.spec.ts déclaré dans ci/test-impact.json.)

## Réciprocité — R5

- [~] T014 Observer et spécifier les transitions Notion, notamment auto-relation ; arrêter un contrat d'écriture atomique et cycle de vie dans `plan.md` ; ne pas masquer une décision non résolue. (référence observée sans activer l'interrupteur ; conception atomique proposée, choix produit restant listés dans plan.md ; aucun code.)
- [ ] T015 Implémenter la réciprocité retenue dans les couches domaine/API/local/UI sans double vérité ; tester création/retrait depuis les deux sens, concurrence et annulation, archivage et restauration.
- [ ] T016 Ajouter tests intégration et E2E réciprocité, auto-relation, hors ligne et synchronisation ; si explicitement reportée, documenter la limite et ne pas afficher l'option.

## Convergence

- [~] T017 Appliquer `ui-quality`, `lessons.md`, `docs/design/ui-system.md` et `notion-parity` ; comparer captures Notion/candidat, clavier, Échap/focus, erreur/vide/chargement, thèmes et 320/390 px ; conserver preuves sûres. (captures candidat clair/sombre/390/320, focus et Échap vérifiés ; comparaison chiffrée Notion non faite.)
- [~] T018 Vérifier migrations, ancienne définition/client, outbox, révisions, backup/restore, import/export et absence de contenu privé dans les logs ; documenter preuves et restrictions. (archive chiffrée + restauration multi-source PG vertes ; clients mixtes et import HTTP non testés.)
- [~] T019 Exécuter les contrôles de `docs/development.md` adaptés au diff, tests et Playwright pertinents ; reporter commandes, résultats, erreurs préexistantes et limites dans un `validation.md`. (unités complètes, PG, navigateur desktop/mobile, types et Biome ; deux échecs préexistants hors 057 documentés.)
- [~] T020 Analyser la cohérence spec/plan/tâches et actualiser les statuts des tâches 055 T103–T108 uniquement après preuves ; ne pas déclarer la parité ou la convergence avec un écart matériel. (statuts 055 déjà corrigés ; cohérence relue, R5 et échecs préexistants bloquent la convergence.)
