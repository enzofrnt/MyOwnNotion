# Feature Specification: Équations, sommaires et listes lisibles

**Feature Branch**: `codex/notion-api-import`  
**Created**: 2026-10-04  
**Status**: Implémentée et validée localement — publication non demandée  
**Input**: Corrections du propriétaire après essai de l'import API Notion.

## Product alignment

Le canevas produit §§7, 11, 13, 14, 18, 20 et 27.1 gouverne cette feature.
Elle étend l'éditeur 003/017/033 et la présentation des bases 029 ; la
conversion, la sélection et la hiérarchie d'import restent définies dans 028.
Elle ne crée ni couverture de page, ni collaboration, ni synchronisation Notion.

## User Scenarios & Testing

### User Story 1 — Lire et écrire des équations (Priority: P1)

Le propriétaire retrouve les équations Notion rendues dans ses pages et peut
insérer un bloc Équation avec `/`, modifier sa source LaTeX et poursuivre sa note.

**Independent Test**: Insérer une formule, modifier son expression, annuler,
réouvrir la page hors ligne puis exporter ; vérifier la source et le rendu.

**Acceptance Scenarios**:

1. **Given** un bloc équation importé, **When** la page est ouverte, **Then** la
   formule apparaît avec sa source intacte, sans exécution ou ressource distante.
2. **Given** une page éditable, **When** `/équation` est choisi, **Then** une
   saisie nommée permet de créer et modifier la formule au clavier.
3. **Given** une expression invalide, **When** le rendu échoue, **Then** la source
   reste modifiable et conservée ; aucune erreur ne bloque la page.
4. **Given** une équation dans une ligne de texte Notion, **When** elle est
   importée, **Then** elle conserve sa position, sa source et son rendu mathématique.

### User Story 2 — Naviguer dans la page courante (Priority: P1)

Le propriétaire insère un Sommaire à une position choisie. Ce bloc et le
sommaire latéral reflètent les titres de la page affichée et permettent de les rejoindre.

**Independent Test**: Alterner entre deux pages aux titres distincts, modifier
un titre, cliquer chaque sommaire et faire défiler une page longue.

**Acceptance Scenarios**:

1. **Given** une page sans titre, **When** `/sommaire` est choisi, **Then** un
   état vide explique comment alimenter le bloc ; un titre ajouté l'actualise.
2. **Given** plusieurs pages ouvertes, **When** la page active change, **Then**
   un seul sommaire latéral est affiché avec les titres de cette page.
3. **Given** un titre imbriqué, **When** son lien est activé, **Then** le bon
   titre devient visible, y compris dans une section repliée.
4. **Given** un défilement manuel ou programmatique, **When** la section lue
   change, **Then** le repère actif suit la section, jusqu'au dernier titre.

### User Story 3 — Parcourir une liste de base (Priority: P2)

La liste présente l'icône et le titre à gauche et les propriétés secondaires
alignées à droite, selon la capture fournie, sans répéter leurs noms à chaque ligne.

**Independent Test**: Ouvrir une liste avec statuts, catégories, dates et titres
longs à 1440 et 320 pixels dans les deux thèmes, puis ouvrir une ligne au clavier.

**Acceptance Scenarios**:

1. **Given** une liste renseignée, **When** elle est affichée sur ordinateur,
   **Then** chaque entrée tient sur une ligne avec les valeurs alignées.
2. **Given** des valeurs longues ou une largeur de 320 pixels, **When** la
   liste est affichée, **Then** elle reste lisible sans débordement horizontal
   de la page ; les valeurs complètes restent consultables.
3. **Given** une liste vide, en chargement ou en échec, **When** elle est
   consultée, **Then** les états existants et leur reprise restent disponibles.

### Edge Cases

- Titres identiques, imbriqués, modifiés à distance, page conservée en mémoire.
- Formule vide, invalide, longue ou contenant une commande de lien/HTML.
- Sommaire dupliqué, plusieurs sommaires dans une page, contenu chargé tardivement.
- Liste sans propriété secondaire, valeur vide, conflit, entrée sans icône.
- Import existant modifié localement : réparation limitée aux éléments inchangés.

## Requirements

### Functional Requirements

- **FR-001**: Conserver et rendre les sources LaTeX des équations de bloc et en ligne.
- **FR-002**: Proposer Équation et Sommaire dans le menu `/` avec recherche française.
- **FR-003**: Modifier une équation avec conservation, annulation/rétablissement,
  réouverture et export de sa source ; une erreur de syntaxe reste locale.
- **FR-004**: Calculer le sommaire depuis les titres courants, sans copie périmée.
- **FR-005**: Limiter le sommaire latéral à la page active et actualiser son repère
  lors du défilement, d'une édition ou d'une modification de mise en page.
- **FR-006**: Faire rejoindre le bon titre par chaque lien des deux sommaires.
- **FR-007**: Afficher la liste avec titre/icône, valeurs alignées et sans noms
  répétés ; conserver les propriétés configurées, l'ordre et l'ouverture des entrées.
- **FR-008**: Garantir clavier, focus, deux thèmes, réduction des animations et
  utilisation à 320 pixels, avec preuves visuelles synthétiques documentées.
- **FR-009**: Rendre les formules hors ligne, sans requête distante ni exécution
  de commandes non fiables ; préserver les données et formats non reconnus.
- **FR-010**: Livrer les corrections sur l'instance isolée 8082 en préservant
  les identités et éditions existantes ; relier la réparation d'import à 028.
- **FR-011**: Le sommaire latéral n'apparaît que si la zone de contenu du
  workspace a assez de largeur pour le laisser visible sans gêner la lecture.
  La disponibilité se recalcule quand cette zone change de taille, notamment
  après le redimensionnement de la barre latérale ; le sommaire inséré dans le
  contenu de la page reste indépendant.

### Key Entities

- **Équation** : source LaTeX, identité et position dans la page.
- **Sommaire** : bloc positionnable et projection des titres de la page.
- **Repère de lecture** : section active de la page visible, état de présentation.
- **Ligne de liste** : entrée, titre/icône courants et propriétés secondaires configurées.

## Success Criteria

- **SC-001**: Les équations de test conservent exactement leur source après
  édition, annulation, réouverture et export ; aucune syntaxe invalide ne bloque la page.
- **SC-002**: Les deux sommaires rejoignent chaque titre de test ; vingt
  changements de page ne produisent aucun titre périmé ni sommaire latéral dupliqué.
- **SC-003**: Les listes de test n'affichent aucun nom de propriété répété et
  ne font pas déborder la page dans les quatre combinaisons thème/largeur.
- **SC-004**: Les vérifications de modèle, persistance et parcours navigateur
  réussissent ; aucune modification de l'autre instance locale n'est nécessaire.
- **SC-005**: À fenêtre constante, réduire la zone workspace sous 960 px masque
  l'outline latéral ; l'élargir le réaffiche sans navigation, tandis que le
  bloc Sommaire dans le contenu reste utilisable.

## Assumptions and clarifications

- La demande d'ajout et de correction autorise l'implémentation et la livraison
  locale ; aucune nouvelle approbation UI n'est nécessaire.
- La capture guide les rangées de liste ; ses outils supplémentaires ne sont
  pas demandés. Sur écran étroit, les métadonnées peuvent revenir à la ligne.
- Les couvertures et propriétés Personne restent exclues conformément à 028.
- L'exclusion de la base People et la correction Archive > Lycée > Simple Note
  concernent l'import de test ; aucune exclusion globale par nom n'est imposée
  à tous les espaces Notion.

## Correction de présentation — couleur des liens (2026-10-04)

La couleur explicitement choisie sur un fragment de texte prime sur la couleur
par défaut d'un lien. Son soulignement suit la couleur visible, y compris dans
un titre mêlant texte et lien ou plusieurs couleurs. Un lien sans couleur
explicite garde sa couleur habituelle et un soulignement assorti. Les retours à
la ligne, les marques, les URL et le contenu enregistré restent identiques.
Livrer cette maintenance sur l'instance isolée 8082. Le propriétaire demande
de poursuivre les corrections sans relancer les suites automatisées ; conserver
une revue visuelle directe de la page signalée.
