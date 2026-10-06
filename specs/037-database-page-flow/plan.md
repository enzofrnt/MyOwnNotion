# Implementation Plan: Flux de page des bases

**Date**: 2026-10-04 | **Spec**: [spec.md](spec.md) | **Branch**: codex/notion-api-import

## Summary

FR001–008 : densité réelle des cartes, viewport vertical canonique, en-têtes épinglés natifs et création atomique par colonne. Canevas §14 étendu explicitement ; scope UI borné, pas de nouvelle route ni migration.

## Technical Context

Bun 1.4.2, TypeScript strict, React 19, TanStack Virtual 3.14, primitives Ariakit existantes. `database.css` possède cartes/colonnes/table ; `workspace.css` possède le scroll de page. Les sources pleine page et intégrées réutilisent `LocalContentService.createDatabaseEntry`. Approche finale : viewport workspace, rail CSS sticky natif hors du corps horizontal, commande atomique avec valeurs initiales et résolution de source secondaire locale. Aucune nouvelle dépendance.

## Constitution Check

I/IV : aucun contenu ni secret public, données locales chiffrées et mutations atomiques existantes. II/V/VIII : un dossier feature, références canvas, architecture locale minimale. III/VI/VII : tests de comportement, cinq profils navigateur et preuves UI ; outils Bun exclusivement. Pas de violation avant conception. Aucun second compte ou changement de permissions.

## Phase 0 — Research

Recherche en lecture seule déléguée conformément au skill speckit-plan : viewport/sticky/virtualisation et création canonique. Résolutions dans [research.md](research.md).

## Phase 1 — Design

- Réutiliser la mesure du viewport table pour le corps des cartes : workspace visible et origine du contenu, masque = aucun viewport, lab = surface locale bornée. Conserver hauteur totale et focused item pour >60 cartes. Les listes page-flow observent le scroll workspace, avec gap mesuré ; ne pas restaurer un scroll lors du montage d'un bloc intégré.
- Rail commun d'épinglage CSS sticky, hors du scrollport horizontal du corps, borné à la fin du tableau/Kanban. Pas de clone interactif ni de portal. Hook de mesure du retrait, de la gouttière et de la course au layout/resize ; corps unique source de scroll horizontal et animation native d'en-têtes depuis sa timeline, secours détecté pour moteur sans support ; aucune écriture liée au scroll vertical. Animation/listeners/observer nettoyés, pages masquées ignorées.
- Chaque colonne expose Page/Dossier à son pied. Construire les valeurs initiales depuis l'axe/option active (multi-select singleton, missing objet vide). Callbacks reçoivent ces valeurs et les passent à la commande existante atomique. Ref verrouillant les doubles soumissions et erreur locale. Après succès ouvrir l'entrée canonique pour titre, même filtrée.
- Cartes : supprimer min-height imposée, centrer contenu et menu, padding égal ; titre multi-ligne sans ellipsis. Cibles tactiles préservées, croissance due au contenu/contrôles uniquement.

Contrat et modèle : [contracts/ui.md](contracts/ui.md), [data-model.md](data-model.md). Validation : [quickstart.md](quickstart.md).

## UI quality gate

Références : [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) L002/003/005/009/010/015/019/020/021 et [UI guide](../../docs/design/ui-system.md). Guide mis à jour avec le propriétaire CSS/scroll. Les quatre commentaires autorisent les corrections ; aucune validation intermédiaire n'est requise.

US1 : mesurer court/long et padding haut/bas ; images clair/sombre 1440/320. US2 : base longue/full/inline, scroll horizontal, fin base et tab masqué, headers utilisables, 1 000 cartes avec DOM borné/focus. US3 : page/dossier, status/multi-select/missing, pending/refus/reprise/offline/persist ; boutons au bas des colonnes et absence du footer global. Captures publiques uniquement synthétiques, capture réelle privée en work/notion-api.

## Delivery and checks

Unitaires géométrie et création/interaction ; types Web/root, Biome fichiers concernés, corpus Web et tests locaux/source pertinents. Playwright ciblé 037 + régression 036/visuelles sur cinq profils via DB/ports isolés. Builds séquentiels à la matrice. Déployer uniquement Web myownnotion-notion-api, 8082/8445/55433 et cinq volumes isolés ; relever IDs/starttimes de l'instance UI avant/après. Aucun push demandé. Le gate complet de la branche avant publication reste indépendant de cette validation UI ciblée.

## Post-design gate

Recherche doit confirmer commande atomique et une seule interaction native par en-tête avant implémentation. Aucun besoin de migration/API. Correction bornée de résolution de source secondaire dans la préparation client de création, testée contre propriétaire et refus atomique. Artefacts et couverture analysés avant code.

## Correction du rendu réel

Le viewport de page est détecté par `.workspace-main` pour couvrir aussi les compositions legacy. Un attribut page-flow explicite sur la surface scope la CSS de scroll/headers. Les origines des en-têtes viennent de leur parent non transformé (table/section), jamais du header translaté ; tenir compte de la barre sticky `.workspace-page-title__path`. Kanban pleine page reprend le breakout 100cqi/gouttière de la table. Card/title/menu : alignement centré, wrappers de Button correctement ciblés, hauteur liée au texte ; commandes de création validées conservées. Revue navigateur directe privée, aucune relance des suites.

## Remplacement de la fixation après la troisième revue

La translation par JavaScript à chaque scroll ne satisfait pas la stabilité demandée. Elle est remplacée par un rail `position: sticky` natif, frère du corps à défilement horizontal, borné par la hauteur de la base. Les en-têtes interactifs restent uniques ; la table d'en-têtes et le corps partagent les mêmes largeurs de colonnes, et les deux rails synchronisent uniquement leur scroll horizontal. Aucun calcul ni écriture de position d'en-tête pendant le scroll vertical. Un ResizeObserver mesure le retrait sous le chemin lors des changements de taille. Le rail Kanban peint un fond opaque de canvas dans ses interstices et des surfaces de colonnes avec arrondis supérieurs complets. Les widgets bornés conservent leur structure locale. Appliquer ui-quality et lessons L009/010/015/016/019 ; vérifier directement fixation, coins, commandes et alignement sur 8082 sans campagne de tests.

## Mouvement horizontal commun après la quatrième revue

Le corps devient l'unique source de scroll horizontal. Le rail d'en-têtes ne possède plus de scrollLeft indépendant : son contenu suit une ScrollTimeline du corps, exécutée par le navigateur. Mesurer la course horizontale au changement de layout et observer les contenus pour les redimensionnements de colonnes ; nettoyer l'animation au démontage. Router vers le corps les gestes horizontaux/focus sur l'en-tête. Prévoir le moteur sans ScrollTimeline : gestes horizontaux coordonnés dans le même handler, traduction directe de secours pour les déplacements programmatiques/barre. Le sticky vertical et les contrôles originaux sont conservés. Revue directe du geste sur 8082 selon ui-quality et lessons L009/010/015/019 ; pas de matrice ni de nouvelles suites.
