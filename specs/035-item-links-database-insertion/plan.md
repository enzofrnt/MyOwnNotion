# Implementation Plan: Liens d'éléments et insertion de bases

**Branch**: codex/notion-api-import | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Conserver le mark canonique pageLink : le rendu résout déjà page/dossier/base.
Étendre uniquement sélection et copie UI. Trois créations imbriquées cohérentes,
une commande intégrée ouvrant un contrôleur qui réutilise DatabaseCreateChoiceDialog.
L'import distingue le champ is_inline avant la conversion child_database.

## Technical Context

TypeScript strict, Bun 1.4.2, React 19, BlockNote 0.54 ; aucune dépendance nouvelle.
LocalContentService et moteur opérationnel existants, lecture et mutations locales
hors ligne. Identités sourceId distinctes des conteneurs. Vitest et Playwright ;
services de dev exclusivement myownnotion-notion-api sur 8082/55433. Pas de SQL
ni de modification de la seconde instance ; aucune publication demandée.

## Constitution Check

Principes I–VIII : données locales/export inchangés, un dossier 035, intent/plan
séparés, chiffrement/secrets existants, architecture minimale, clavier/états,
toolchain et gates sélectionnés, canevas et 028/029/033 alignés. Avant un éventuel
push, vérifier le gate transversal ; la livraison de dev est validée par types,
format/lint, corpus Web/import ciblés, builds et matrice des parcours concernés.

## Phase 0 and design

Voir [research.md](research.md), [data-model.md](data-model.md),
[contracts/editor.md](contracts/editor.md) et [quickstart.md](quickstart.md).
Recherche en lecture seule déléguée selon speckit-plan ; implémentation séquentielle.

## Source changes

- editor-links.ts et page-link-picker.tsx : cibles actives page/folder/database/
  database_view, chemin courant ; nouvelle copie et icône reference pour l'action.
- editor-menus/slash-menu.tsx : onInsertInlineDatabase ouvre le dialogue après
  retrait durable de la requête slash ; aucune création à l'ouverture ; supprimer
  la commande dédiée vue liée, conserver ses alias vers l'entrée intégrée.
- page-editor.tsx : contrôleur intégré lié au bloc capturé ; fermeture à
  désactivation du keep-alive et retour de focus utile.
- integrated-database-picker.tsx : source locale, choix existant, retry, verrou
  synchrone contre double activation. Identités stables par bloc ; après création
  réussie, ne plus permettre de changer de source/type lors d'un réessai.
- database-create-choice.tsx : variante inline sans modifier les parcours de
  navigation, états de chargement/reprise et libellé « Insérer la vue ».
- hierarchy-explorer.tsx : lors du retry d'un enfant existant, retourner la vue
  réellement stockée, valider lifecycle et parent ; ne pas inventer de vue.
- ui-lab-review.tsx : exposer les états synthétiques du dialogue partagé dans
  la revue de base, sans service ou données du propriétaire.
- API plan.ts/blocks.ts : seule une base is_inline===true avec vue native devient
  databaseView. Sinon lien vers identité native ; un indicateur absent produit
  un avis explicite et un lien conservateur, sans affichage ajouté implicitement.

## UI quality gate

Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md) et
[ui-system](../../docs/design/ui-system.md). Propriétaires : editor.css pour
sélecteur de lien ; database.css pour DatabaseCreateChoiceDialog. AppIcon,
ItemIcon, NativeSelect, Button et Dialog existants ; pas de nouvelle cascade.

| Parcours | Vide/chargement | Succès | Échec/reprise |
| --- | --- | --- | --- |
| Lien d'élément | Recherche vide ou aucune cible | Icône/titre courants, navigation | Cible supprimée garde l'identité et son état |
| Création imbriquée | Menu, action courante | Lien enfant et ouverture | Erreur locale, retry par même identité |
| Intégration nouvelle | Choix visible, aucune écriture | Base/source enfant, un bloc | Choix conservé, source déjà créée réutilisée |
| Intégration existante | Sources chargent, liste vide explicitée | Un affichage, même source | Réessai du chargement/création ; aucune copie |
| Annulation | Échap/Annuler | Retour éditeur, aucun élément ajouté | Fermeture bloquée pendant confirmation |

Deux thèmes, 1440/320px, choix/chargement/vide/erreur, clavier/retour de focus.
Captures exclusivement synthétiques dans evidence/ et revue dans validation.md.
Une différence UI matérielle bloque convergence.

## Guarded import repair

Snapshot protégé existant, aucune requête Notion ni jeton nécessaires. Sauvegarde
complète vérifiée de la seule instance de test ; reconstruire ancienne projection
child_database et la comparer bloc par bloc aux documents courants. Convertir
seulement les databaseView full-page restés inchangés vers paragraph/pageLink, par
opérations canoniques. Préserver ID, emplacement, cible, éditions ailleurs,
sources/entrées/People exclue. Garder la seule base réellement inline intégrée.
Rapports privés ignorés ; preuve publique ne contient que des comptes.

## Delivery

Tâches setup → tests/liens → menu/dialogue → import → réparation → QA/convergence.
Builds puis images propres, redémarrage ciblé de 8082, smoke réel ; aucune API
recréée pendant les essais navigateur.
