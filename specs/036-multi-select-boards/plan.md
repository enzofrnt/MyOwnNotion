# Implementation Plan: Kanban par sélection multiple

## Summary and technical context

Bun 1.4.2 / TypeScript ; domaine commun, projection contracts partagée API/local, React BoardView, commandes canoniques chiffrées. Aucune dépendance, migration SQL ni modification du protocole. Canevas §4.2/4.3/14/29/42–44. Charger [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) et [guide UI](../../docs/design/ui-system.md) ; réutiliser controls/AsyncState et CSS database.css.

## Constitution check

Identité canonique unique, valeurs préservées, stockage/révisions existants, traitement local égal au serveur, Bun exclusif, tests de comportement et preuves navigateur. Aucun secret ni contenu réel dans les artefacts publics. Recherche déléguée en lecture seule conformément à speckit-plan ; implémentation séquentielle ici. Pas de publication distante demandée.

## Design

1. Domaine : regroupement retourne plusieurs IDs d'option active par entrée ; ordre déterministe ; déduplique les options ; missing si aucune option active. Lignes et pagination restent uniques. Statut/sélection simple restent compatibles.
2. Projection : conserver les valeurs de l'axe board même masqué (nécessaires à l'affichage et aux mouvements). Labels de groupes multi-select résolus. groupId scalaire conservé pour une appartenance unique ; null si plusieurs. Aucune extension DTO nécessaire : memberships dérivées des valeurs typées et groupes agrégés.
3. Board : accepter multi-select, placer une même row dans plusieurs colonnes ; origine du mouvement portée par les contrôles et le drag interne. Move A→C conserve B et refuse sans perte les valeurs historiques incompatibles. L’intention est résolue dans updatedCellProperties après relecture complète à chaque tentative canonique. Destination missing efface l'ensemble, avertissement explicite près du choix. Réutiliser mutation typée et annonce de refus. Éviter double envoi pendant mutation.
4. Configuration : création/choix d'axe multi-select, group et options cohérents ; groupe board aligné sur axe ; axe invalide signale indisponibilité avec choix d'une propriété compatible.
5. Import : accepter les regroupements multi-select. Réparation ciblée de présentation et copie legacy definition.views via commandes canoniques, après backup vérifié ; CAS/révisions et comparaison à l'état historique connu ; conserver properties actuelles et onglets ajoutés. Receipt chiffré, preview idempotente. Toute donnée réelle reste sous work/ ignoré.

## UI journeys and states

Succès : colonnes nommées/colorées, carte multiple identifiable par même titre, mouvements disponibles sans drag. Vide : colonnes vides explicites. Chargement : actions empêchent envoi répété. Erreur : annonce visible près du board, retry par contrôle. Axe indisponible : pas d'axe arbitraire ; sélecteur de reprise. Sans valeur : indication que toutes les sélections seront retirées. Clair/sombre, desktop/320 px, clavier/souris/tactile, offline. Propriétaire CSS unique inchangé ; preuves synthétiques versionnables, preuves réelles privées.

## Validation and operations

Tests rouges/verts domaine, projection, client query pagination, composant board/configuration/import ; API integration de query. Tests E2E source synthétique multi-select, axe masqué, mouvements origin-aware, reload/offline et échecs ; cinq profils du runner avec PG isolé 55433 et ports dédiés. Builds API/Web et types/static/format affectés ; gate complet requis avant toute publication des changements communs. Publication non demandée ; rapport distinguera la validation effectuée du gate de publication. Déployer uniquement les images notion-api-* sur compose myownnotion-notion-api ; aucun port/volume/image de myownnotion-ui-dev modifié.

## Finition UI US4 — décision du 2026-10-04

Maintenance du rendu existant, sans nouveau modèle, dépendance, contrat serveur ou migration. Référence : capture Notion fournie par le propriétaire. Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) L002/L003/L009/L010/L020/L021 et le [guide UI](../../docs/design/ui-system.md).

- Un seul propriétaire CSS : `features/databases/database.css`. Réutiliser les tokens de couleur des options, `ItemIcon`, les menus et popovers Ariakit existants. Conserver les scrollports et la virtualisation ; recalibrer l'estimation à la hauteur des cartes allégées.
- Colonnes arrondies, fond discret selon l'option, badge + compte et commande de repli iconique. Cartes compactes, titre/identité en premier ; bouton « … » dans une place réservée, révélé au survol/focus et toujours visible au toucher. Les destinations sont dans un menu portal non rogné par le scrollport ; menu clavier et Échap natifs. L'origine du mouvement et la restauration du focus restent explicites même avec un menu hors de la carte.
- Remplacer le formulaire de regroupement permanent par un popover compact. Garder la reprise explicite si l'axe manque. Le texte de suppression des sélections accompagne la destination Sans valeur dans le menu et sa zone de dépôt. État vide : texte discret ; pending : action bloquée ; erreur : annonce visible avec retry disponible. Aucun bouton de création factice.
- Tests ciblés Web + parcours Playwright existants adaptés aux menus ; preuve visuelle synthétique et vérification privée de Matière, clair/sombre à 1440/320 px. Déployer uniquement Web sur 8082 ; aucune écriture sur les entrées réelles ni redéploiement de l'autre instance.
- Le lab synthétique `?review=database&format=board` accepte `mutation=pending/refused` pour contrôler visuellement les états asynchrones du vrai composant et tester refus/reprise au navigateur sans données serveur.

### Maintenance de la méthode de couleur — 2026-10-06

Le retour propriétaire confirme que le mélange 88/12 assombrit trop peu les
fonds et les rend grisâtres par rapport à la référence. La palette reste
centralisée dans `tokens.css`, mais chaque thème reçoit une nuance de surface
calibrée : pastel en clair, ton profond et saturé en sombre. Les badges,
propriétés, surlignages et cartes consomment ces mêmes tokens. Les cartes
utilisent directement le ton de surface ; les colonnes le mêlent au canvas
pour rester en retrait. Les contours partent de la bordure du thème mêlée à
la couleur douce, jamais à un contour vif. Sans valeur reste neutre. Réduire
d'un pixel le padding vertical des cartes et élargir légèrement les gouttières
symétriques définies en 029. CSS : `tokens.css` et `database.css`.

Le flux de page des Kanbans et les en-têtes fixes table/Kanban sont précisés par [037](../037-database-page-flow/plan.md) sur demande du propriétaire ; ce périmètre remplace la conservation des scrollports Kanban en pleine page et intégrée.
