# Feature Specification: Titre de source conditionnel

**Feature**: `050-database-source-title`
**Date**: 2026-11-04

## Problème

Une base créée avec une seule source affichait deux noms : le titre de la page
et le titre de la source. Le second n'est utile que pour distinguer plusieurs
sources réellement affichées par les vues.

## Comportement attendu

- Base pleine page dont **toutes les vues actives utilisent la même source** :
  un seul titre, celui de la base. Aucun titre de source.
- Base dont les vues actives utilisent **plusieurs sources** : le titre de la
  source active est affiché au-dessus des vues, comme désambiguïsateur.
- Base intégrée dans une page : le titre de source reste affiché (comportement
  existant), même avec une seule source.

## Critères d'acceptation

1. Une base à une source et plusieurs vues n'affiche pas de titre de source.
2. Deux sources réellement utilisées par des vues affichent le titre.
3. Le titre de source ne dépend plus du nombre total de sources disponibles.
4. La base intégrée conserve son titre de source.
