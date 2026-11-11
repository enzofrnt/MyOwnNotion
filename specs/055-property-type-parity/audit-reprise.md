# Audit de reprise — agrégations, formules, lieu et carte

**Date :** 2026-11-11. **Statut :** audit initial ; l'implémentation qui a suivi le même jour et ses limites sont consignées dans `validation.md` (« Reprise agrégations, formules, lieu et carte »). Ce qui suit décrit l'état **avant** correction. Audit statique du code présent dans le répertoire de travail, qui contient aussi des modifications préexistantes non attribuées à cette reprise. Les observations ci-dessous ne certifient ni le comportement du serveur en cours ni celui d'un commit publié. Les tâches et critères font autorité dans `tasks.md` et `spec.md`.

## Point de départ pour le prochain agent

1. Lire constitution, canevas §§ 4, 10, 14, 17, `spec.md`, `plan.md`, `tasks.md`, puis `validation.md` chronologiquement : ses entrées tardives corrigent parfois des limites plus anciennes. La mention initiale « implémentation à démarrer » est périmée.
2. Lire les skills [notion-parity](../../.agents/skills/notion-parity/SKILL.md), [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md), le [guide UI](../../docs/design/ui-system.md) et le [registre 054](../054-ui-parity-errors/errors.md). Prendre en compte les modifications locales existantes avant toute édition.
3. Utiliser le workspace Notion **de test**, jamais personnel. Capturer aussi le candidat, relever des étapes répétables et vérifier les captures ouvertes. Les artefacts dans `.notion-lab/parity/` sont ignorés par Git ; noter les chemins et conserver dans `validation.md` les constats partageables sans données privées. Les captures de 055 montrent des états historiques, pas une validation exhaustive de ces parcours.
4. Ne pas reproduire ou lire de secrets pour le diagnostic. Le fichier local `.env` n'est pas suivi par Git au moment de cet audit ; cela ne prouve ni absence d'exposition historique, ni restrictions effectives des clés Google. L'administrateur doit vérifier ces restrictions dans Google et effectuer une rotation seulement si une exposition est constatée.

## Références préparées le 11 novembre 2026

Lire le [dossier visuel et protocole de capture](notion-dossier-visuel.md), qui
rassemble des médias officiels publics, des captures interactives ciblées sur la
page autorisée par le propriétaire, leurs DOM expurgés et des parcours
reproductibles. La [référence fonctionnelle](notion-reference-fonctionnelle.md)
contient les fonctions, calculs, limites et liens Notion officiels. T100 reste
ouverte : plusieurs états et la comparaison avec le candidat manquent encore.

## Référence Notion et limites de connaissance

| Sujet | Faits documentés | À observer, ne pas inventer |
| --- | --- | --- |
| Agrégation | [Relations et agrégations](https://www.notion.com/help/relations-and-rollups) : sélection relation, propriété liée, calcul. | Menus, ordre exact, fonctions proposées par type, vides, suppression et erreurs. |
| Formule | [Syntaxe](https://www.notion.com/help/formula-syntax) : texte, nombre, booléen, date, personne et listes ; fonctions de listes ; [erreurs](https://www.notion.com/help/common-formula-errors) : limite de 15 niveaux de dépendances et accès aux bases. | Éditeur, recherche, insertion, validation, messages, détails du débogage et comportement des références renommées. Les personnes restent hors périmètre produit. |
| Lieu et carte | [Cartes](https://www.notion.com/help/maps) : nom/adresse ou géolocalisation autorisée ; recherche traitée par un tiers ; filtre nom/adresse ; carte jusqu'à 100 éléments affichés simultanément. | Fournisseur exact, pertinence, classement, langues, délais, seuils et états hors ligne. La limite de 100 n'est pas une limite de la base. |
| Types | [Propriétés de base](https://www.notion.com/help/database-properties) : liste et description des propriétés proposées par Notion. | Comparer à la version et au plan observés ; les propriétés multi-utilisateur ne deviennent pas implicitement compatibles avec notre modèle mono-utilisateur. |

La documentation est une référence fonctionnelle, pas une capture des libellés et styles. Dates de consultation : 2026-11-11. La parité totale, la liste définitive de calculs ou l'identité du fournisseur de Notion ne sont pas établies ici.

## Matrice initiale : preuves et risques

| Priorité | Constat dans le code / état observé | Conséquence et travail à préparer |
| --- | --- | --- |
| P0 | `apps/web/src/features/databases/entry-panel.tsx:101-109` affiche le nombre de cibles pour tout rollup ; `formula.ts:212-213` fait pareil quand `prop()` référence un rollup. | Un total de 30 calculé à partir de deux liens peut apparaître comme 2 dans le volet ou une formule. Tester les trois surfaces avec les mêmes données. |
| P0 | `formula-editor.tsx:144-160` sélectionne une ligne mais évalue `previewRow` ; `:237-259` affiche le nom sélectionné. `:267-277` ne bloque que la formule vide. | Un aperçu peut être étiqueté avec une autre entrée ; sauvegarde invalide possible. La spec demande conservation de la dernière expression valide. |
| P0 | `apps/api/src/databases/database-query-service.ts:602-665` évalue la vue avant d'ajouter les valeurs d'agrégation ; `apps/web/src/features/databases/filter-editor.tsx:83-91` ne propose pas d'opérande dédié formule/agrégat. | Ne pas déduire de T031 que filtrage/tri fonctionnent de bout en bout : faire tests avec pagination et comparer serveur/local. |
| P0 | `packages/domain/src/databases/rollup.ts:131-134` renvoie `null` pour une moyenne vide ; `apps/web/src/features/databases/database-value.ts:26-30` peut remplacer une valeur absente par le nombre de relations. `apps/web/tests/database-rollup.spec.ts:31-34` encode un tel fallback pour somme. | Différencier vide, absence et erreur ; corriger le test qui pérennise un résultat trompeur. |
| P1 | `property-configuration.tsx:1025-1035,1078-1109` conserve la cible après changement de relation et présente les options/calc​​uls sans toutes les contraintes métier ; `database-query-service.ts:623-640` construit la liste à partir de plusieurs sources. | Établir la bonne source reliée, réinitialiser ou invalider proprement les choix devenus incompatibles et tester. |
| P1 | `formula.ts` contient un parseur et une bibliothèque partielle côté Web ; types, coercitions, références par nom, horloge, limites de ressources et cycles sont à étudier. `database-value.ts` et `entry-panel.tsx` ne fournissent pas toujours `entryNumber`, contrairement à l'aperçu. | Construire une matrice vérifiée ; tester renommage, références imbriquées/rollup/identifiant, division, dates, erreurs, taille et performance. Ne pas promettre la couverture complète avant inventaire. |
| P1 | `apps/web/src/features/databases/place-property-field.tsx` diffère la recherche de 280 ms ; l'annulation d'une requête antérieure n'est pas immédiate lorsque la saisie devient trop courte. | Tester les réponses inversées, effacement et démontage ; seule la dernière intention doit l'emporter. |
| P1 | `apps/api/src/routes/places.ts` utilise Google Places (2–200 caractères, 6 résultats par défaut, délai limite 8 s) ; `apps/web/src/services/places.ts` présente une erreur générique. Aucune utilisation de géolocalisation n'a été trouvée dans `apps/` lors de l'audit. | Distinguer vide/erreur/clé absente, reprise, géolocalisation autorisée/refusée et tester la qualité avec jeux d'adresses variés sans promettre celle de Notion. |
| P1 | `apps/web/src/features/databases/map-view.tsx` charge Google Maps côté navigateur ; un échec de chargement et une configuration indisponible peuvent rester en cache durant la page. | État d'erreur et réessai à concevoir ; une carte déjà ouverte contacte un tiers. Lecture textuelle locale conservée même sans carte. |
| P1 | `packages/domain/src/databases/query.ts` filtre le lieu par nom, pas par adresse ; la documentation Notion mentionne nom et adresse. | Vérifier filtre/tri au niveau domaine, serveur et client, y compris données manquantes et accentuation. |
| P2 | `apps/api/src/imports/notion/properties.ts:122-127` traite formule et rollup comme instantanés texte. Les specs 045/047 décrivent des premières passes ; 055 les étend. | Expliquer précisément l'import actuel et concevoir toute migration séparément ; éviter une promesse de réévaluation d'une formule importée. |

Les chemins et numéros sont des repères de l'audit, à revalider avant intervention. Aucune de ces observations ne se substitue à une reproduction/test rouge.

## Référence de capture à compléter — préalable T100

Pour chaque surface : noter date, version, langue, taille, thème, données synthétiques, point d'entrée, recette (clic, clavier et clic droit si pertinent), capture référence et candidat, structure/libellés/ordre, dimensions/styles, états et différences. Comparer les deux thèmes et 320/390 px ; contrôler focus, Échap, retour focus, portails et absence d'occlusion. Respecter `notion-parity` et `ui-quality` ; les captures seules ne prouvent pas le calcul.

| Parcours | États à capturer | Statut |
| --- | --- | --- |
| Agrégation | création sans/avec relation, sélection source/propriété, changement de relation, calculs selon type, vide, résultat, erreur | À capturer/comparer dans cette reprise |
| Formule | création/édition, insertion de propriété, recherche/fonctions/doc, aperçu de deux entrées, invalide, sauvegarde, sortie/clavier, débogage si présent | À capturer/comparer dans cette reprise |
| Lieu | vide, saisie, chargement, résultats, sélection, effacement, aucun résultat, erreur, refus de position, hors ligne | À capturer/comparer dans cette reprise |
| Carte | création avec/sans propriété, pins, ouverture d'entrée, vide, chargement, échec, limite d'affichage, responsive | À capturer/comparer dans cette reprise |

## Inventaire d'autres types — non autorisé à élargir la livraison

`packages/domain/src/databases/types.ts` est l'inventaire effectif à comparer à Notion ; le document `docs/design/notion-database-reference.md` qualifie encore Lieu de manquant et doit être traité comme historique. La feature 055 exclut explicitement Relation (refonte), Bouton, Personne, Créée par et Dernière modification par, ainsi que l'IA. Pour chaque type : classer **présent vérifié**, **présent incomplet**, **absent/exclu** ou **à vérifier**, avec exemple et référence. Proposer un lot ultérieur distinct si nécessaire ; ne pas introduire de comptes, rôles ou collaboration en contradiction avec la constitution.

## Plan de vérification pour la suite

- Tests de domaine : toutes les fonctions retenues par type, vide vs zéro, valeurs manquantes/supprimées, dates/fuseaux, erreurs, cycles, renommages et déterminisme.
- Contrats et intégration : validation de la relation et de sa cible, projection serveur/local, filtre/tri **avant** pagination, cohérence table/volet/formule, chargement partiel et invalidation après modification ; migration, anciens clients, import/export et sauvegarde selon impact.
- Interface : composants puis parcours Playwright réels pour chaque histoire ; changements rapides, erreurs, reprise, clavier, focus, thèmes et tailles prévues. Captures comparées à Notion et revue visuelle consignées dans `validation.md`.
- Places : réponses simulées reproductibles, échecs/quota/timeout, concurrence, permissions et confidentialité. Ne jamais journaliser requête, coordonnées ou clés ; vérifier aussi les logs des intermédiaires contrôlés.
- Performance : reprendre les budgets et scénarios de `docs/development.md` pour les bases ; mesurer les calculs avant pagination sur jeu représentatif sans supposer que les résultats paginés suffisent.

## Analyse de cohérence avant implémentation

Cette reprise couvre FR-015 par T103–T108, FR-016 par T109–T114, FR-017 par T115–T119 et FR-018 par T100–T102 et T120–T122. Les 14 exigences antérieures restent suivies par les phases historiques : ce complément ne prétend pas les ré-auditer toutes. Risques ouverts : référence visuelle partielle pour cette reprise, sans comparaison candidat ni couverture sombre/mobile ; matrice de sémantique/types et modèle de calcul encore à arrêter avant code (T100–T101) ; statuts historiques et preuves contradictoires à réconcilier (T122). Aucun conflit constitutionnel intentionnel ; l'accès tiers et la protection hors ligne nécessitent les décisions et tests précisés au plan. Ne pas lancer l'implémentation des tâches de comportement avant résolution des prérequis T100–T101.
