# Feature Specification: Uniformité des surfaces Web

**Feature Branch**: `codex/032-ui-uniformity`
**Created**: 2026-10-03
**Status**: Implémentée ; revue visuelle documentée, validation release différée
**Input**: « Fais un commit pour le socle CSS ; remplace l’instance de dev par celle de ce répertoire, puis passons à l’uniformité. »

## Direction produit et périmètre

Affiner le langage visuel existant sur les surfaces Web déjà implémentées.
Canevas : §§4, 8–16, 18–22, 24, 26–30, 38–39, 43.4–43.6, 46.
Dépendances : 017 (primitives), 022/023 (navigation/éditeur), 029 (bases),
031 (propriétaires CSS, tokens et guide). Les références Notion et corrections
visuelles du propriétaire priment sur les anciennes différences locales.
Les comportements métier, données, synchronisation et capacités restent inchangés.
Les E2E sont différés par instruction explicite du propriétaire ; aucune
publication ni conformité aux gates de release n’est annoncée dans cette passe.

## User Scenarios & Testing

### User Story 1 — Observer la version courante (Priority: P1)

Le propriétaire utilise une instance de développement issue de ce répertoire,
mise à jour pendant le travail, après enregistrement du socle précédent.

**Independent Test**: Ouvrir l’application et le laboratoire aux adresses
documentées ; vérifier le répertoire monté, la santé et le rechargement des sources.

**Acceptance Scenarios**:
1. **Given** le socle 031 enregistré, **When** la nouvelle passe commence,
   **Then** son commit est identifiable et les changements suivants sont séparés.
2. **Given** une ancienne instance, **When** elle est remplacée,
   **Then** l’instance utilise les sources de ce répertoire et les anciens
   volumes ne sont pas effacés implicitement.

### User Story 2 — Retrouver les mêmes contrôles et états (Priority: P1)

Navigation, connexion, pages, bases, recherche, graphe, fichiers et réglages
emploient les mêmes règles pour les actions, saisies et états, avec une densité
adaptée au rôle de chaque surface.

**Independent Test**: Parcourir chaque famille avec des données synthétiques ;
comparer les contrôles communs, les overlays et états aux exemples de référence.

**Acceptance Scenarios**:
1. **Given** deux actions de même rôle, **When** on les examine au repos,
   survol, focus ou attente, **Then** leurs couleurs, contrastes, alignements
   et repères suivent les mêmes règles.
2. **Given** du contenu en chargement ou vide, **When** il est affiché,
   **Then** un placeholder contextualisé ou un texte sobre occupe la surface ;
   aucune grande carte colorée n’est introduite.
3. **Given** une confirmation destructive, **When** elle s’ouvre,
   **Then** elle reste neutre avec action à texte/contour rouges, clavier
   utilisable et fermeture/restauration du focus prévisibles.

### User Story 3 — Lire une interface cohérente (Priority: P2)

Le contenu reste dominant, avec une hiérarchie stable des titres, aides,
séparations et actions, proche des références Notion retenues.

**Independent Test**: Examiner toutes les familles en clair/sombre à 1280 et
320 px, avec texte long ; confirmer lecture, scroll local et actions visibles.

**Acceptance Scenarios**:
1. **Given** une page, base ou réglage, **When** le contenu est long,
   **Then** les alignements restent cohérents et le document ne déborde pas.
2. **Given** un écran étroit, **When** un menu ou dialogue s’ouvre,
   **Then** son contenu et ses actions restent accessibles.
3. **Given** un nouveau changement UI, **When** un agent reprend le projet,
   **Then** le guide indique les sources et exemples réellement vérifiés,
   ainsi que les exceptions de domaine encore justifiées.

### Edge Cases

- Texte long, champs invalides, désactivation, erreur réseau, rafraîchissement
  avec contenu déjà affiché, installation verrouillée/hors ligne.
- Table/code/kanban : scroll local légitime, jamais débordement du document.
- Icônes, titres éditables, sélecteurs de couleur et chrome BlockNote : géométrie
  de domaine légitime ; ne pas les convertir en grands boutons de formulaire.
- Données privées ou parcours irréversibles : revue sur fixture locale, pas de
  suppression, export, rotation ou révocation pour obtenir une capture.

## Requirements

### Functional Requirements

- **FR-001** : Le socle 031 est enregistré avant les modifications d’uniformité.
- **FR-002** : Remplacer l’instance de dev par une issue du répertoire actif et
  documenter adresse, données de démo et mise à jour des sources.
- **FR-003** : Inventorier toutes les familles de surfaces Web implémentées et
  classer chaque différence visuelle comme corrigée, cohérente ou exception
  justifiée ; aucun écran non vu ne peut être présenté comme vérifié.
- **FR-004** : Harmoniser les contrôles communs sans modifier leur rôle,
  interactions, saisies, état disabled/busy ni géométrie de données.
- **FR-005** : Appliquer les accents bleu et rouge retenus, sans halo de focus,
  sans changer la palette de contenu/propriétés.
- **FR-006** : Attentes neutres contextualisées, informations/vide sobres,
  erreurs proches des saisies et suppression à texte/contour rouges.
- **FR-007** : Préserver la hiérarchie contenu/chrome, les densités validées,
  le scroll local, le clavier, les deux thèmes, 320 px et réduction des animations.
- **FR-008** : Documenter preuves visuelles, contrôles exécutés et limites ;
  garder le guide et les exemples cohérents avec les corrections livrées.

### Key Entities

- **Surface de référence** : famille, état, thème, largeur et preuve visuelle.
- **Exception de domaine** : adaptation nécessaire, source propriétaire,
  justification et rendu vérifié.

## Success Criteria

### Measurable Outcomes

- **SC-001** : L’application et le laboratoire sont disponibles sur l’instance
  documentée, qui recharge les modifications du répertoire actif.
- **SC-002** : Toutes les familles inventoriées ont un résultat explicite de
  revue ; chaque correction possède une preuve du rendu réel.
- **SC-003** : Aucun débordement du document à 320 px sur les surfaces revues ;
  les composants larges défilent dans leur propre surface.
- **SC-004** : Les contrôles de même rôle n’affichent plus de variantes locales
  contradictoires ; les exceptions restantes sont explicitement justifiées.
- **SC-005** : Les parcours revus conservent leur action, saisie, focus et
  disponibilité ; les contrôles comportementaux pertinents réussissent.

## Assumptions

- Revue des familles Web existantes, pas de création de nouvelles capacités,
  ni refonte du client natif ou parité exhaustive avec Notion.
- Les évolutions antérieures d’autres agents sont intentionnelles ; les
  différences sont évaluées sur leur rendu et leur rôle avant correction.
- Le laboratoire peut accueillir des compositions utilisant les vrais
  composants et des fixtures en mémoire pour les états sensibles/inaccessibles.
- Les E2E et gates de publication restent différés ; pas de push demandé.
