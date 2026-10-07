# Implementation Plan: Parcours des cartes et volet droit

**Date**: 2026-10-06 | **Branch**: codex/notion-api-import | **Spec**: [spec.md](spec.md)

## Summary

Canevas §14/18/19/43.6. Réutiliser création atomique, présentations de vues, EntryPanel et éditeur canonique. Pas de nouvelle dépendance, API, migration ou stockage de document.

## Technical Context

React/TypeScript strict, Bun du repo, Ariakit, LocalContentService et projections locales. CSS propriétaire `database.css`, composition dans hierarchy-explorer et contextes éditeur. Ouverture de base reste montée derrière un volet indépendant ; état de présentation transitoire.

## Constitution Check

I/IV : même propriétaire, données chiffrées locales et synchronisation existante. II/V/VIII : une feature, artefacts avant code, changements réversibles. III/VI/VII : contrôles ciblés et revue manuelle demandée ; pas de campagne exhaustive suspendue. Checkpoint 0b3157a2 créé sans tests. Pas de violation.

## Phase 0 — Research

Observation réelle de Notion : carte inline, Entrée prépare suivante, Échap annule vide, clic ouvre aperçu latéral, propriétés dans réglages de vue. Carte temporaire déplacée dans la corbeille, aucun réglage du propriétaire modifié. Recherche en lecture seule déléguée selon speckit-plan pour la réutilisation des entrées ; [research.md](research.md).

## Phase 1 — Design

- BoardView : carte dépliée commune création/édition, ValueEditor et validation typée existants ; valeurs et relations envoyées à la création atomique. Création atomique sur Entrée ou clic extérieur, sans boutons ; garde anti-double et refus conservé. Édition existante automatiquement sérialisée, baseline avancée après chaque succès ; clic extérieur/Échap termine après sauvegarde. Type permanent via conversion canonique. Champs changés via saveEntryPropertyChanges et renommage canonique.
- BoardCards : propriétés visibles de viewColumns, hors titre ; valeurs réutilisant PropertyValue, case avec nom. CSS de densité conserve cartes compactes, zones title/menu puis valeurs sous le titre.
- Le DTO de requête omet les propriétés masquées : enrichir les lignes avec les valeurs/relations canoniques de la même révision pour le mode déplié. Ne pas substituer une projection locale plus ancienne à une requête récente. Les dates instantanées utilisent un contrôle natif local puis sont normalisées avec fuseau à l'enregistrement.
- Volet : contexte explicite d'ouverture de base pour containers et blocs intégrés, état indépendant de selectedItem ; chargement entrée/source/item local, EntryPanel et WorkspacePageEditor, titre/icône canoniques. Focus retour, fermeture, pleine page, état erreur/chargement ; responsive sans modifier le scroll de la base.
- Onglets : corriger la vraie cascade et le wrapper de survol pour toute la cellule.

## UI quality gate

Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) L009/010/019/020 et [guide UI](../../docs/design/ui-system.md). Les retours autorisent ces corrections. États : vide, saisie, attente, refus, succès, volet chargé/indisponible ; menus/focus non concurrents. Chaque story possède une revue navigateur documentée avant done. Captures contenant les données privées uniquement dans work/notion-api, jamais dans les artefacts suivis.

## Validation and delivery

Types/Biome/build ciblés, tests de comportement bornés si nécessaires ; aucune matrice. Revue manuelle Notion puis 8082 (création, visibilité, volet, clavier, thème, étroit). Déployer seulement web myownnotion-notion-api, préserver API/DB et instance 8080. [quickstart.md](quickstart.md), [validation.md](validation.md).

## Post-design gate

Conception cohérente avec données canoniques et présentation déjà stockée. Aucun changement du contrat de persistance ; seules signatures UI et état transitoire changent. Analyse avant code dans analysis.md.

## Précision issue de la recherche

Retours du 7 octobre : réutiliser ConvertItemControl dans le menu, garder son dialogue monté ; actions canoniques par contexte workspace. Drawer avec sortie terminée avant démontage/focus ; double-chevron et expansion. database.css seul propriétaire du hover et centrage. Revue des huit demandes, clair/sombre/étroit selon ui-quality + lessons. Aucun nouveau contrat ni migration.

L'enregistrement des valeurs validait la définition primaire et perdait sourceId pour une source secondaire. Le volet rend cet écart matériel : résoudre la définition depuis l'appartenance stockée, conserver sourceId et refuser une source étrangère. Même commande et format, aucune migration. Ajouter une régression bornée au test de création secondaire déjà existant. Le scroller du volet porte data-editor-scrollport ; menus restent au-dessus de ce volet nonmodal, et aucun portail d'historique n'est attaché à la barre de la base.

## Correction suivante du 7 octobre

FR003/010/014 → T017/018 supersèdent la validation explicite : édition
automatique sérialisée avec baseline avancée après chaque succès, fermeture
extérieure reconnaissant les événements React des portails, création atomique
sur Entrée/clic extérieur. La carte éditée reste montée dans sa colonne jusqu'à
fermeture même si le regroupement change. Présentation carte dédiée dans
ValueEditor ; choix Page/Dossier permanent dans ConvertItemControl et icônes
directionnelles partagées. Capsule crayon/menu commune. Skill ui-quality et
guide UI alignés avant code. Aucun contrat réseau ni migration. Vérifier
doubles écritures, refus, portails, regroupement, clavier, 320 px et thèmes.

## Regroupement dans les réglages de vue

FR015 → T019/T020. Réutiliser ViewSettingsPanel : rangée Grouper avec propriété
actuelle et écran group. GroupEditor partagé sélectionne les seules propriétés
compatibles, applique immédiatement la présentation existante, bloque les doubles
envois et garde une erreur/reprise locale. Le changement d'axe réinitialise seulement
l'ordre et les replis des colonnes ; les autres réglages sont conservés. Séparer ce
choix de SortGroupEditor dans le panneau et les réglages des blocs intégrés.
Retirer la toolbar et son CSS de BoardView ; conserver l'état indisponible avec
indication du point de reprise. Aucun nouveau réglage de masquage, sous-groupe ou
couleur ; aucun contrat ni migration. Appliquer ui-quality + lessons ; preuves
pleine page/intégrée, clavier, refus/pending, thèmes et 320 px avant done.
