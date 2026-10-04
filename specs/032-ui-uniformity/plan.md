# Implementation Plan: Uniformité des surfaces Web

**Branch**: `codex/032-ui-uniformity` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

Après le commit 031, remplacer la stack locale par les sources courantes,
auditer les familles Web, corriger les variantes locales contradictoires et
documenter les exceptions légitimes. Canevas §§4, 8–16, 18–22, 24, 26–30,
38–39, 43.4–43.6, 46. Sources UI obligatoires :
[ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons.md](../../.agents/skills/ui-quality/lessons.md),
[guide UI](../../docs/design/ui-system.md).

## Technical Context

- TypeScript strict, Bun 1.4.2, React, Ariakit, BlockNote et CSS existants.
- Storage : aucun changement de données, contrat serveur ou migration.
- Tests : Vitest ciblé pour comportements modifiés, types, lint et build ;
  revue du navigateur local sur fixtures, sans campagne E2E.
- Plateforme : Web partagé avec le renderer desktop, 320/1280 px, clair/sombre.
- Pas de dépendance, framework, abstraction ni seconde palette introduits.
- Contrôles optiques de domaine conservés (arbre, tableau, titre, graphe).

## Constitution Check

I/IV : données précédentes conservées ; captures sur démo/fixtures, aucun
secret réel. II/VIII : spec unique liée au canevas. III/VII : modifications
sur branche dédiée et tests ciblés ; E2E/gate de push différés à la demande
explicite d’Enzo, risque de régression de parcours documenté, aucune publication.
V : ajuster les propriétaires existants et primitives, pas de framework.
VI : clavier, labels, focus neutre visible, actions stables et surfaces étroites.
Recontrôle après conception : mêmes conclusions, pas de nouvelle exception.

## Phase 0 — Research

Inventorier CSS, usages natifs et overrides de primitives ; lire le rendu
avant de modifier. Comparer à 031 et aux références propriétaire.
Inconnues techniques résolues par lecture des composants existants ; aucune
recherche externe ni délégation nécessaire.

## Phase 1 — Design et états

Une famille : propriétaire CSS existant. Un contrôle commun : primitive ou
classe native explicite. Une adaptation : géométrie locale uniquement, sauf
exception optique documentée. Pas de sélecteur générique de panneau composé.

États : rempli/vide, premier chargement/rafraîchissement, erreur/disabled/busy,
menu/dialogue, focus/Escape/retour au déclencheur. Fixtures en mémoire pour
parcours sensibles sans exécuter rotation, révocation, export ou suppression.
Placeholder contextualisé ; conserver le contenu déjà visible lors du refresh.

## Project Structure

```text
specs/032-ui-uniformity/{spec,plan,research,data-model,tasks,verification}.md
specs/032-ui-uniformity/contracts/ui.md
specs/032-ui-uniformity/assets/
apps/web/src/ui/{compatibility.css,primitives/,ui-lab*}
apps/web/src/features/<propriétaire CSS existant>/
docs/design/ui-system.md
docker/{dev,api,web,e2e-browser}.Dockerfile
```

Le packaging Docker omettait `scripts/ci/tracked-files.ts`, import ajouté en
030 : rétablir sa copie avant `bun ci` dans les images concernées.
La stack ancienne échoue à la validation d’intégrité de ses données de démo.
Utiliser `myownnotion-ui-dev` avec nouveaux volumes de données, conserver
volumes et CA de l’ancienne stack, ports 8080/8443 et sources bind-mounted.

## Vérification et fermeture

Chaque famille reçoit une ligne d’inventaire et chaque correction une preuve
visuelle avant/après ou une composition des vrais composants avec fixture.
Deux thèmes, 320/1280 px ; clavier sur overlays touchés ; réduction du mouvement
et équivalent zoom 200 % si géométrie touchée. Ne pas marquer une tâche UI
terminée sans preuve (`ui-quality` L-010). Guide maintenu après convergence.
