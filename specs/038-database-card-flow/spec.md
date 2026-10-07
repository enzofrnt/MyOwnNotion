# Feature Specification: Créer et consulter les cartes sans quitter la base

**Feature Branch**: `codex/notion-api-import`
**Created**: 2026-10-06
**Status**: Implémentée et vérifiée manuellement sur 8082 ; proposée à la revue du propriétaire
**Input**: Retours du propriétaire : survol de tout l'onglet, création Kanban dans la colonne sans ouverture, propriétés visibles configurables, ouverture des entrées en volet droit. Checkpoint préalable sans tests : `0b3157a2`.

## Product direction

Canevas §14 (bases, vues et entrées canoniques), §18–19 (local/hors ligne), §43.6 (qualité UI). Raffine 029/036/037 ; remplace l'ouverture automatique après création dans une colonne prévue par 037. Conserve import, palettes, défilement de page et en-têtes déjà acceptés. Livraison sur 8082 uniquement.

## User Scenarios & Testing

### User Story 1 — Ajouter dans une colonne (Priority: P1)

Un bouton discret pleine largeur ouvre une carte dépliée au pied de la colonne, avec titre, toutes les propriétés éditables et choix Page/Dossier à l'intérieur. Le propriétaire reste dans la base.

**Why this priority**: Ajouter plusieurs tâches sans interrompre la lecture.
**Independent Test**: Créer deux titres à la suite, annuler la carte vide, recharger et vérifier leur colonne.
**Acceptance Scenarios**:
1. **Given** une colonne, **When** Nouvelle page est activé, **Then** la carte de saisie déplie ses champs et le titre reçoit le focus sans ouvrir l'entrée.
2. **Given** un titre saisi, **When** Entrée est pressée, **Then** une seule entrée est enregistrée avec sa valeur de colonne et une saisie suivante vide est disponible.
3. **Given** un brouillon, **When** Échap est pressé, **Then** il est annulé sans créer d'entrée et le focus revient au bouton.
4. **Given** un échec, **When** la création est refusée, **Then** le titre reste disponible avec reprise locale ; une attente empêche les doubles envois.
5. **Given** une carte dépliée, **When** le type et des propriétés sont choisis, **Then** le brouillon reste ouvert ; Entrée ou clic extérieur enregistre l'ensemble sans navigation ni boutons de validation.

### User Story 2 — Choisir les informations des cartes (Priority: P1)

Les propriétés visibles et leur ordre appartiennent à chaque vue. Le titre reste visible et les options utilisent les couleurs communes.

**Why this priority**: Voir les informations utiles sans ouvrir toutes les tâches.
**Independent Test**: Afficher Matière/Examen, masquer État, changer de vue puis recharger.
**Acceptance Scenarios**:
1. **Given** des propriétés visibles, **When** le Kanban est affiché, **Then** chaque carte montre leurs valeurs présentes sous le titre, dans l'ordre choisi ; une case à cocher porte son nom même décochée.
2. **Given** une propriété de regroupement masquée, **When** sa visibilité change, **Then** le regroupement reste actif et les valeurs ne changent pas.
3. **Given** une vue modifiée, **When** une autre vue est affichée, **Then** elle conserve sa propre présentation.

### User Story 3 — Modifier dans un volet (Priority: P1)

Le clic sur une entrée depuis une vue ouvre un volet à droite avec titre, icône, propriétés et contenu éditables. La base et son défilement restent en place.

**Why this priority**: Consulter et éditer sans perdre le contexte.
**Independent Test**: Ouvrir une carte, modifier le titre/propriété/contenu, fermer puis rouvrir en pleine page.
**Acceptance Scenarios**:
1. **Given** une base pleine page ou intégrée, **When** une entrée est ouverte, **Then** un volet droit affiche l'entrée canonique et la base reste visible.
2. **Given** le volet ouvert, **When** il est fermé ou Échap est pressé hors d'un menu/éditeur, **Then** le focus revient à la carte et la base garde sa vue et sa position.
3. **Given** le volet ouvert, **When** Ouvrir en pleine page est activé, **Then** la même entrée est affichée dans la navigation normale.
4. **Given** une entrée/source indisponible, **When** elle est ouverte, **Then** un état local clair propose une reprise ou fermeture sans page vide ni perte de données.

### Edge Cases

Colonne vide/sans valeur/repliée, titre long, IME, filtre masquant la nouvelle entrée, source retirée, dossiers, sélection multiple, cartes virtualisées, menu ouvert dans le volet, navigation vers une autre page, petit écran et source partiellement disponible hors ligne.

## Requirements

### Functional Requirements

- **FR-001**: Le survol et le focus d'un onglet MUST couvrir toute sa zone de clic, sans changer sa taille.
- **FR-002**: La création Kanban MUST rester dans la colonne et enregistrer atomiquement titre, type, source et valeur initiale ; elle ne MUST NOT ouvrir l'entrée.
- **FR-003**: La création MUST déplier tous les champs éditables en rangées compactes et le choix Page/Dossier. Entrée crée et prépare la suivante ; clic extérieur crée puis ferme ; Échap annule le brouillon transitoire. Aucun bouton Créer/Annuler. Le passage entre champs ou leurs menus ne ferme pas le brouillon ; un brouillon vide ne crée rien.
- **FR-004**: Une attente MUST empêcher les doubles créations et un refus MUST conserver la saisie et permettre la reprise.
- **FR-005**: Les cartes MUST respecter l'ordre et la visibilité des propriétés de leur vue ; titre permanent, aucune modification des valeurs ni du regroupement.
- **FR-006**: Les vues de bases pleine page et intégrées MUST ouvrir les entrées en volet droit éditable, avec fermeture et accès pleine page explicites.
- **FR-007**: Le volet MUST réutiliser les mêmes données, enregistrements automatiques, relations et contenu que la page canonique, sans copie de document ; préserver les brouillons en attente/refus.
- **FR-008**: Les parcours MUST fonctionner au clavier, en clair/sombre et à 320 px ; le volet dispose de son propre défilement et peut occuper toute la largeur étroite.
- **FR-009**: Le volet MUST se fermer lors d'une navigation explicite vers un autre élément et conserver la base montée lors de sa seule ouverture/fermeture.
- **FR-010**: Une barre commune arrondie avec crayon et points de suspension MUST déplier l'édition existante. Les champs sont des rangées icône/valeur compactes ; valeurs vides « Ajouter [nom] ». Les changements s'appliquent automatiquement et seulement aux champs modifiés, avec écritures sérialisées ; aucun bouton Enregistrer/Annuler. Clic extérieur ou Échap ferme après sauvegarde ; refus/invalidité conserve saisie et reprise. Les menus de champs/confirmations restent dans le périmètre d'édition. Les propriétés masquées restent éditables.
- **FR-014**: Le choix Page/Dossier MUST rester visible pendant création et édition ; la conversion réutilise la confirmation canonique quand elle supprime du contenu. Une icône directionnelle commune à l'arbre et aux menus MUST montrer origine, flèche et destination.
- **FR-011**: Le menu MUST proposer modification, ouverture latérale/pleine page, copie du lien, déplacement de groupe, corbeille et conversion Page/Dossier. La conversion réutilise les confirmations de l'arbre ; aucune action non prise en charge n'est affichée.
- **FR-012**: Le volet MUST glisser depuis/vers la droite, rester monté pendant sa sortie et respecter la réduction des animations. Deux boutons icônes voisins ferment (double chevron) ou ouvrent en pleine page.
- **FR-013**: Les titres de table MUST rester éditables au clic avec ouverture latérale au survol/focus. Les en-têtes repliés MUST être centrés verticalement et le hover MUST éclaircir le fond teinté entier sans plaque grise.
- **FR-015**: Le regroupement MUST se configurer dans les réglages de la vue, via « Grouper » et un panneau dédié « Grouper par » indiquant la propriété actuelle. Aucun bouton de regroupement ne reste au-dessus du Kanban ni dans le panneau de tri. Le choix s'applique immédiatement, conserve filtres/tris/visibilité et reste propre à chaque vue. Un axe indisponible indique les réglages comme point de reprise, sans substitution silencieuse.

### Key Entities

Brouillon de carte transitoire (titre/type/valeurs/relations/champs modifiés), présentation de vue existante (ordre/visibilité), entrée canonique, contexte de volet transitoire (identité/retour focus).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Deux créations successives restent dans la base et produisent exactement deux entrées dans la colonne après rechargement ; Échap sur la saisie suivante n'en ajoute aucune.
- **SC-002**: Deux vues peuvent présenter des propriétés différentes et conserver ces choix après rechargement.
- **SC-003**: Ouvrir/fermer le volet conserve la vue et la position de défilement ; les modifications sont identiques en pleine page.
- **SC-004**: Les parcours initiaux et les huit retours complémentaires sont vérifiés sur 8082 avec captures et parcours clavier, clair/sombre, animations réduites et largeur étroite.
- **SC-005**: Depuis les réglages, changer État vers Matière puis recharger conserve le regroupement ; les autres vues restent inchangées. Vérification pleine page et base intégrée, clavier, clair/sombre et 320 px.

## Assumptions and boundaries

Volet par défaut depuis les vues, navigation directe via arbre/liens en pleine page. Pas de modèles de base, aperçu centré, duplication, nouvelle propriété, nouvel import, modification de l'instance 8080 ou publication. Brouillon vide non persisté, contrairement au brouillon créé immédiatement par Notion : même résultat visible sans entrée accidentelle. Préférences existantes synchronisées ; contexte du volet et brouillon de création temporaires. Aucun changement de permissions, chiffrement, sauvegardes ni migration.
