# Implementation Plan: Revue complète de l’application

**Branch**: `codex/033-app-ui-review` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

Inventorier composants montés/conditionnels, étendre le lab avec leurs vrais
rendus sur fixtures, corriger les défauts et consolider `ui/primitives/`.
Canevas §§4, 7–22, 24, 26–33, 38–39, 43.4–43.6, 46. Sources :
[ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md),
[guide](../../docs/design/ui-system.md).

## Technical Context

TypeScript strict/Bun 1.4.2/React/Ariakit/BlockNote existants. Aucun framework
ou dépendance ajouté. Web et renderer desktop partagé, 320/1280 clair/sombre.
Aucune migration/contrat serveur/protocole ni réinitialisation des données.
Primitives gardent leurs props et focus. Fixtures mémoire et APIs locales
injectées dans le lab si nécessaires ; adapters de production conservés.

## Constitution Check

I/IV : données/chiffrement/hors ligne/permissions conservés. II/VIII : dossier
unique lié au canevas. V : système existant, abstraction seulement répétée.
VI : clic sémantique/labels/focus/clavier/tactile. VII : Bun et vérification
types/lint/tests ciblés/build. III : exception autorisée par Enzo, aucun E2E
maintenant, pas de publication ; risque multi-navigateurs/natif non couvert,
suite de release avant push. Après conception : mêmes conclusions.

## Phase 0 — Research

Inventaire source et rendu des familles/contrôles ; comparer à 032. Sources
locales suffisantes, aucune inconnue externe nécessitant délégation.
Fixtures réelles pour états rares ; pas de hack DOM/React ou données privées.

## Phase 1 — Design et états

Rempli/vide, chargement/refresh, erreur/reprise, disabled/busy, overlays, texte
long et clavier. Un propriétaire CSS par domaine. Communs existants :
Button/Field/Status/Skeleton/Dialog/Drawer/Menu/Popover. Compléter au besoin
section, scroll local et tableau de lecture. Conserver tableaux métier et
éditeur. Chaque correction nécessite preuve du rendu avant tâche terminée.

## Project Structure

```text
specs/033-app-ui-review/{spec,plan,research,data-model,tasks,verification}.md
specs/033-app-ui-review/{contracts/,checklists/,assets/}
apps/web/src/ui/{primitives/,ui-lab*}
apps/web/src/features/{sync,reconciliation,history,files,databases,editor,...}/
apps/web/tests/
docs/design/ui-system.md
```

## Vérification

Revue navigateur des familles courantes et fixtures des états rares, thèmes
et largeurs. Captures/mesures dans verification.md. Tests comportementaux
pertinents, types/lint/build ; aucun test recopiant CSS. Instance HMR conservée.
