# Implementation Plan: Équations, sommaires et listes lisibles

**Branch**: `codex/notion-api-import` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Étendre le modèle v3 et son moteur avec equation.expression et tableOfContents.
Les équations inline utilisent un mark avec identité pour conserver deux formules
adjacentes. Rendu KaTeX local sans confiance ; source éditable. Partager collecte
et navigation des titres entre sommaires, limiter l'outline aux éditeurs actifs.
Recomposer ListView avec les icônes présentes dans DatabaseViewRow. Un subgrid
commun aligne les valeurs ; le titre prend la largeur restante et les colonnes
secondaires utilisent fit-content(14rem). Les gaps du parent et des rangées
restent identiques. Les statuts ne sont pas tronqués pour réserver une largeur
inutile au titre ; le parcours desktop contrôle aussi une colonne de lecture
de 688px. Sous 640px, les métadonnées reviennent à la ligne.

## Technical Context

Language: TypeScript strict, Bun 1.4.2. Dependencies: React19, BlockNote0.54,
Loro, KaTeX version exacte verrouillée. Storage: documents/propriétés/textes
opérationnels chiffrés existants. Tests: Vitest domaine/page-state/web/API et
Playwright instance isolée. Platform: Web/Electron hors ligne. Constraints:
aucun CDN/secret/journal privé, aucune migration SQL, aucune autre instance.
Performance: repère au prochain frame de lecture, collecte limitée au document.

## Constitution Check

Conforme I–VIII avant et après design : sources/export durables, éditions
préservées, lecture hors ligne, types inconnus préservés, aucun nouveau service.
Livraison locale avec tests ciblés/types/builds ; avant publication ultérieure,
checks:local requis car impact transversal. Aucun push demandé.

## Project Structure

- packages/domain/src/document/ et search/document-text.ts : types/validation/export.
- packages/page-state/src/ : initialisation/projection, transformations et marks.
- apps/web/src/features/editor/ : blocs, conversion/adapter et navigation des titres.
- apps/web/src/features/databases/list-view.tsx et database.css : liste.
- apps/api/src/imports/notion/ : adaptateur034 et hiérarchie/exclusion028.

## UI quality gate

Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md) et
[ui-system](../../docs/design/ui-system.md). L-009/010: propriétaire CSS et rendu
réel ; L-012: état UI hors DOM ProseMirror externe ; L-015: scroll local formule.

Équation vide: saisie nommée ; succès: formule ; erreur: source conservée et
corrigeable ; lecture: pas de commande d'édition. Échap ferme et clavier applique.
Sommaire vide: explication ; rempli: liens réactifs, clavier ; pas de chargement
artificiel. Outline absent si inactif ou moins de deux titres. Liste garde états
vide/offline/erreur/chargement, titre consultable, association nom-valeur masquée
visuellement ; metadata revient à la ligne à320px. Preuves synthétiques aux
largeurs1440/320 et thèmes clair/sombre dans validation.md.

### Suivi UI — largeur réellement disponible pour l'outline

Le portal latéral est hors du DOM du contenu et ne peut pas utiliser son
container query. Il mesure donc l'inline-size du scrollport workspace via
ResizeObserver ; sous le seuil déjà employé par le breakpoint étroit, il est
retiré de la présentation. Cela tient compte d'une barre latérale élargie même
si la fenêtre reste large. Le sommaire dans le corps de page reste disponible.

## Data, security and repair

Equation source stockée, jamais HTML. Inline mark equation avec expression exacte et identité stable
et fallback textuel sans LF/tab préserve les frontières adjacentes et n'étend pas le style à la saisie suivante.
KaTeX trust=false, throwOnError=true, limites d'expansion et taille ; CSS/fonts
locales. Export source en dollars. TOC sans liste persistée. Navigation scoped
bn-block-outer dans le host courant, ResizeObserver et requestAnimationFrame ;
déplier les ancêtres toggle. Le scroll place le titre à48px du début du
scrollport ; le repère le considère atteint à96px, une marge qui absorbe les
recalage du chrome et des blocs après activation. Les contrôles de
nœuds non éditables arrêtent les événements souris avant ProseMirror. Exclusion028 par IDs explicites, sources/membres,
pas de règle globale par titre. Résoudre block_id via forêts collectées.

Sauvegarde vérifiée puis réparation canonique de l'instance8082 : ne convertir
que les fallbacks encore inchangés, préserver IDs/éditions/snapshot original ;
déplacement natif de Simple Note, corbeille native de People et ses membres.
Aucun redémarrage API pendant QA navigateur.

## Delivery sequence

Fondations → US1 → US2 → US3 → adaptateur028/réparation → validation/convergence.

## Maintenance — couleurs et soulignement des liens

Appliquer ui-quality et ses leçons L-009/010/012 : correction dans le schéma
BlockNote et son propriétaire editor.css, sans mutation DOM ni réécriture des
documents. Placer la marque underline après link et textColor dans l'ordre
ProseMirror : chaque soulignement reçoit ainsi la couleur de son fragment.
BlockNote 0.54 recalcule les priorités à la création du schéma ; étendre la marque
résolue une fois, avant toute création d'éditeur. Hériter la couleur du fragment
explicite dans ses ancres, en conservant le comportement des liens ordinaires.
Pas de changement de stockage, import, synchronisation, permissions ou migration.
Revue visuelle directe sur la page signalée, puis remplacement du seul conteneur
Web 8082. Ne pas relancer les suites, conformément à la demande du propriétaire.
