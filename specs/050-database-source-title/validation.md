# Validation: Titre de source conditionnel

**Feature**: 050-database-source-title
**Date**: 2026-11-04

## Vérifications

- `database-view-loading` : nouveau test « hides the source title on a full page
  whose views share one source » ; 28 tests passent.
- La condition utilise désormais les `sourceId` des vues actives, plus la
  longueur de la liste des sources disponibles.
- Instance : la base de démonstration (une source) n'affiche que le titre de la
  page ; le titre de source réapparaît uniquement quand les vues changent de
  source.

## Limite

Le nettoyage des bases vides créées pendant les essais reste à faire ; elles
n'influencent pas la condition de titre.
