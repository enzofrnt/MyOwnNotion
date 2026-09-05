# Implementation Plan: Bases réutilisables intégrées

**Branch**: `codex/026-linked-databases` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary

Séparer la révision de définition de la révision courante de l'ancienne page hôte. Le registre `databases` devient l'autorité de la source. Une ancre d'item existante peut rester pour le journal immutable et la compatibilité des enveloppes ; ni sa visibilité ni son cycle de vie ne déterminent la disponibilité de la source. Les configurations d'emplacements, noms et vues restent dans le payload de définition chiffré et empruntent les mutations, projections et exports existants.

## Technical Context

Bun/TypeScript, PostgreSQL/Drizzle, React, Dexie et services de protection actuels. Aucune dépendance ajoutée. Migration réservée `0016_linked_databases`. La création depuis une page peut créer une source avec une ancre sans emplacement de hiérarchie. Les anciennes bases gardent leur affichage par défaut sur leur page actuelle. Les entrées sont conservées hors de la branche de hiérarchie des hôtes afin que la suppression d'un hôte ne cascade pas sur leur appartenance.

## Constitution Check

PASS : propriétaire unique ; source canonique partagée ; aucune persistance privée en clair ; mutations offline atomiques ; historique préservé ; export/restauration explicites ; tests de comportements ; chaîne Bun et gates de `docs/development.md`. Pas de changement de principe constitutionnel. Canvas §14 et 009 doivent être alignés.

## Design

- La définition ajoute un nom de source et des emplacements `{id, hostPageId, views, state}` optionnels pour lire les anciennes définitions sans les réécrire avant déchiffrement. L'absence représente un emplacement historique sur l'ancienne page ; une liste vide représente une source sans affichage.
- Les vues d'un emplacement sont évaluées par le moteur 009 avec le même schéma et les mêmes entrées ; les changements de propriétés affectent le schéma commun. Les mutations gardent des révisions causales ; les emplacements distincts sont fusionnés par identité.
- Le registre de sources conserve sa propre `definition_revision_id`. Les écritures de pages, corbeille et purge ne l'avancent pas. Les révisions référencées par une source ne sont pas nettoyées avec l'historique d'un hôte.
- Les noms/configurations passent par les snapshots protégés existants ; aucune migration SQL ne déchiffre ou copie du contenu privé. Le protocole transmet la révision de source avec sa définition et conserve la projection locale chiffrée.
- L'UI réutilise `DatabasePage`, les cinq vues et l'édition d'entrée. Un sélecteur de source et une action de retrait encadrent l'intégration dans une page éditoriale normale. Référence obligatoire : [UI quality](../../.agents/skills/ui-quality/SKILL.md), tokens, boutons sémantiques et arrondis imbriqués.
- Les formats canoniques conservent leurs anciennes données lisibles, incluent les champs additifs des définitions et la révision de source, et vérifient leur cohérence. La sauvegarde complète 024 capture le catalogue SQL sans sélection de tables figée.

## Validation Strategy

Tests de domaine pour identité/validation/fusion d'emplacements ; tests réels PostgreSQL pour migration, suppression/purge des hôtes et accès ultérieur ; tests client pour persistance chiffrée et projection ; test UI et parcours Playwright pour deux pages, configurations distinctes et édition partagée. Exécuter les suites ciblées et signaler au parent les résultats. Le parent exécute le gate complet avant tout push ; cette branche reste locale.

## Project Structure

`packages/domain/src/databases/`, `packages/contracts/src/content-api.ts`, `packages/database/src/`, `packages/client-core/src/`, `apps/api/src/databases/`, `apps/web/src/features/databases/`, `apps/web/src/features/hierarchy/`, tests associés et `specs/026-linked-databases/`.
