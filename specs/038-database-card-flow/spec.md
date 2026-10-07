# Feature Specification: Créer et consulter les cartes sans quitter la base

**Feature Branch**: `codex/notion-api-import`
**Created**: 2026-10-06
**Status**: Implémentée et vérifiée manuellement sur 8082 ; proposée à la revue du propriétaire
**Input**: Retours du propriétaire : survol de tout l'onglet, création Kanban dans la colonne sans ouverture, propriétés visibles configurables, ouverture des entrées en volet droit. Checkpoint préalable sans tests : `0b3157a2`.

## Product direction

Canevas §14 (bases, vues et entrées canoniques), §18–19 (local/hors ligne), §43.6 (qualité UI). Raffine 029/036/037 ; remplace l'ouverture automatique après création dans une colonne prévue par 037. Conserve import, palettes, défilement de page et en-têtes déjà acceptés. Livraison sur 8082 uniquement.

## User Scenarios & Testing

### User Story 1 — Ajouter dans une colonne (Priority: P1)

Un bouton « Nouvel élément » pleine largeur crée une entrée puis ouvre son édition au pied de la colonne, avec titre, toutes les propriétés éditables et choix Page/Dossier à l'intérieur. Le bouton reste dessous pendant l'édition. Le propriétaire reste dans la base.

**Why this priority**: Ajouter plusieurs tâches sans interrompre la lecture.
**Independent Test**: Activer deux fois le bouton, renseigner les titres, fermer l'édition puis recharger et vérifier les deux entrées et leur colonne.
**Acceptance Scenarios**:
1. **Given** une colonne, **When** Nouvel élément est activé, **Then** une entrée Page est créée avec sa valeur de colonne et son titre reçoit le focus en édition, sans ouvrir le volet ; le bouton reste dessous.
2. **Given** l'édition courante, **When** Nouvel élément est réactivé, **Then** la saisie courante est sauvegardée et une seule nouvelle entrée s'ouvre en édition ; un refus garde la saisie courante.
3. **Given** une entrée nouvellement créée, **When** Échap, Entrée ou clic extérieur termine l'édition, **Then** l'entrée reste enregistrée, même sans changement du titre initial.
4. **Given** une création en attente ou refusée, **When** le bouton est observé, **Then** il reste présent ; une attente empêche les doubles envois et un refus permet de réessayer sans fausse carte.
5. **Given** une carte dépliée, **When** le type et des propriétés sont choisis, **Then** les changements s'appliquent automatiquement sans navigation ni boutons de validation ; une entrée masquée par un filtre reste éditable jusqu'à fermeture.

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
2. **Given** le volet ouvert, **When** il est fermé ou Échap est pressé hors d'un menu/éditeur/geste actif, **Then** le focus revient à la carte et la base garde sa vue et sa position. Pendant un déplacement de propriété au clavier, Échap annule seulement ce déplacement et conserve le volet et l'ordre précédent.
3. **Given** le volet ouvert, **When** Ouvrir en pleine page est activé, **Then** la même entrée est affichée dans la navigation normale.
4. **Given** une entrée/source indisponible, **When** elle est ouverte, **Then** un état local clair propose une reprise ou fermeture sans page vide ni perte de données.

### Edge Cases

Colonne vide/sans valeur/repliée, titre long, IME, filtre masquant la nouvelle entrée, source retirée, dossiers, sélection multiple, cartes virtualisées, menu ouvert dans le volet, navigation vers une autre page, petit écran et source partiellement disponible hors ligne.

## Requirements

### Functional Requirements

- **FR-001**: Le survol et le focus d'un onglet MUST couvrir toute sa zone de clic, sans changer sa taille.
- **FR-002**: La création Kanban MUST rester dans la colonne et enregistrer atomiquement titre, type, source et valeur initiale ; elle ne MUST NOT ouvrir l'entrée.
- **FR-003**: « Nouvel élément » MUST créer immédiatement une entrée canonique Page avec sa valeur de colonne, puis déplier tous ses champs éditables et le choix Page/Dossier. Le bouton reste présent sous les cartes pendant l'édition et l'attente. Entrée, clic extérieur ou Échap ferme l'édition après sauvegarde, sans supprimer l'entrée. Aucun bouton Créer/Annuler ; le passage entre champs ou leurs menus ne ferme pas l'édition. Une activation suivante termine la saisie précédente avant création ; un refus conserve celle-ci.
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
- **FR-016**: Les changements courants des entrées MUST s'appliquer sans message de succès ni badge « Enregistré localement » sous les cartes ou rangées des vues. Une attente de synchronisation ne constitue pas une erreur ; les refus et conflits MUST rester visibles et les diagnostics de synchronisation accessibles dans les réglages. Le retrait de l'indication ne change ni la persistance locale ni la synchronisation.

- **FR-017**: Les propriétés déjà visibles sur une carte MUST être directement modifiables sans déplier la carte ni ouvrir le volet. Le crayon révèle les champs supplémentaires après les propriétés visibles, sans déplacer ni redimensionner le titre et les contrôles déjà présents. Le titre se modifie à sa place, sans cadre de champ, avec le curseur initial en fin de texte ; un titre long conserve ses retours à la ligne.
- **FR-018**: Activer le crayon d'une autre carte MUST terminer l'édition courante puis ouvrir la nouvelle, sans perdre une saisie encore en attente. L'appui et le focus sur ce crayon ne replient pas la carte courante avant son activation, y compris dans la même colonne ; un relâchement extérieur annule le geste sans changer de carte. Un refus conserve la carte et son brouillon au lieu de les démonter. La capsule crayon/menu MUST être plus discrète au pointeur, en conservant ses aides, son clavier et les cibles tactiles.
- **FR-019**: Le sélecteur Page/Dossier MUST s'intégrer à la teinte de la carte, sans fond noir contrastant. Un contour fin et le relief du choix actif distinguent les deux options ; survol, focus et attente restent lisibles sans changer la géométrie, en clair/sombre et à 320 px. Un trait discret le sépare des propriétés ; sa hauteur reste compacte au pointeur et confortable au toucher. Le fond glisse dès qu'une conversion autorisée est demandée, indépendamment de sa durée ; le contrôle indique l'attente, son type réel ne change qu'au succès et un refus ramène le fond au choix précédent. La réduction des animations supprime ce glissement.
- **FR-020**: Une page déjà connue comme contenant du contenu MUST ouvrir immédiatement la confirmation avant toute conversion. Une information locale absente ou périmée ne contourne jamais la vérification canonique. Annuler par Échap garde la carte ouverte et son type ; une ouverture au pointeur ne laisse aucun contour assimilable à une seconde sélection sur Dossier. Le retour au déclencheur et le focus lors d'une activation au clavier restent disponibles.
- **FR-021**: La conversion d'une carte sans session ni travail éditorial durable MUST confirmer son enregistrement local sans attendre le réseau. Une ouverture en cours, un journal ou une branche éditoriale conservés MUST garder leur frontière de réconciliation avant destruction. Les sauvegardes et actualisations MUST éviter les lectures ou déchiffrements globaux inutiles sans changer les valeurs, leurs références causales, les diagnostics de conflit ni la durabilité. Mesurer la durée réelle jusqu'au succès local, distinctement de l'animation.
- **FR-022**: L'affichage et l'actualisation des bases MUST éviter les lectures successives par carte, les inventaires globaux inutiles et les actualisations concurrentes du même affichage. Une lecture dépassée ne MUST NOT remplacer un état plus récent ni une autre vue. Les ordres, identités de source, valeurs manquantes, conflits, brouillons et reprises hors ligne restent identiques. Une première page entièrement disponible localement ne MUST NOT attendre une requête réseau dont le résultat n'est pas utilisé ; couverture partielle et pagination distante conservent leurs garanties.
- **FR-023**: Les commandes d'un en-tête de table vide MUST rester accessibles quand ses colonnes dépassent la largeur disponible, au pointeur et au clavier, sans ajouter de fausse ligne de données. Le défilement horizontal de l'en-tête et du corps MUST rester coordonné après ajout d'une propriété ou d'une première entrée.
- **FR-024**: Les contours des cartes Kanban et du bouton « Nouvel élément » MUST utiliser un contour fin et discret dérivé de la teinte de la colonne. Le texte et l'icône du bouton utilisent son accent lisible adapté au thème ; les fonds colonne/carte/badge ont des intensités distinctes issues du système commun 041. Le survol conserve la teinte et les métriques ; une colonne neutre garde les rôles neutres. Édition, attente, focus clavier et thèmes clair/sombre restent lisibles. La demande du 7 octobre 2026 remplace ici l'ancienne règle de contour en couleur pleine.

### Key Entities

Brouillon de carte transitoire (titre/type/valeurs/relations/champs modifiés), présentation de vue existante (ordre/visibilité), entrée canonique, contexte de volet transitoire (identité/retour focus).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Deux activations successives produisent exactement deux entrées dans la colonne après rechargement ; le bouton reste visible sous l'éditeur et Échap conserve l'entrée créée.
- **SC-002**: Deux vues peuvent présenter des propriétés différentes et conserver ces choix après rechargement.
- **SC-003**: Ouvrir/fermer le volet conserve la vue et la position de défilement ; les modifications sont identiques en pleine page.
- **SC-004**: Les parcours initiaux et les huit retours complémentaires sont vérifiés sur 8082 avec captures et parcours clavier, clair/sombre, animations réduites et largeur étroite.
- **SC-005**: Depuis les réglages, changer État vers Matière puis recharger conserve le regroupement ; les autres vues restent inchangées. Vérification pleine page et base intégrée, clavier, clair/sombre et 320 px.

- **SC-006**: Sur 8082, titre et propriétés visibles gardent leur position, police et hauteur avant/après le crayon ; les champs masqués apparaissent en dessous. Une propriété se modifie directement depuis la carte fermée. Passer au crayon suivant pendant une saisie conserve celle-ci après rechargement ; une écriture refusée reste récupérable. Revue selon ui-quality, sombre/clair, titre long et 320 px.

## Assumptions and boundaries

Volet par défaut depuis les vues, navigation directe via arbre/liens en pleine page. Pas de modèles de base, aperçu centré, duplication, nouvelle propriété, nouvel import, modification de l'instance 8080 ou publication. Le retour du 7 octobre remplace le brouillon transitoire de création par une entrée persistée dès l'activation ; seul son état d'édition reste temporaire. Préférences existantes synchronisées ; aucun changement de permissions, chiffrement, sauvegardes ni migration.
