# Feature Specification: Propriétés URL, e-mail et téléphone

**Feature Branch**: `042-database-contact-properties`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Ajouter les trois types de propriétés de contact de Notion — URL, e-mail et
téléphone — aux bases de données, avec validation, affichage lisible, filtres et
tris, import Notion fidèle et recherche. Aucune migration de données.

## Product Direction, Dependencies, and Scope

Cette feature concrétise le canevas produit, sections 10 (modèle canonique des
contenus), 14 (bases de données et tâches), 21 (recherche) et 27 (import et
portabilité). Elle étend la [029](../029-database-pages-views/spec.md) et la
[009-databases-structured-tasks](../009-databases-structured-tasks/spec.md) sans
remettre en cause leur modèle : page de base, source, vue et entrée restent
inchangés.

Aujourd'hui les propriétés Notion de type URL, e-mail et téléphone sont
converties en texte simple à l'import, avec un avis
`import.property-static-text` ([properties.ts](../../apps/api/src/imports/notion/properties.ts)).
Le propriétaire ne peut donc ni les créer, ni les valider, ni les rechercher
comme des adresses. Notion les présente comme trois types distincts, chacun
ouvrant l'application appropriée ; l'objectif est de retrouver ce niveau de
service, pas d'imiter un comportement dépendant du système d'exploitation.

Décisions cadrantes :

- Les trois types stockent une valeur texte. Le modèle de valeurs existant
  (`kind: "text"`) est réutilisé : filtres, tris et index de recherche gardent
  un seul chemin de comparaison de chaînes.
- Les valeurs sont validées à l'écriture ; à la lecture, une valeur héritée
  reste affichable même si elle n'est pas valide (aucune perte silencieuse).
- Aucun changement de migration : définitions et valeurs voyagent déjà dans les
  révisions protégées.
- Ouvrir un lien dans un nouvel onglet, lancer un client mail ou un appel reste
  hors périmètre de cette passe ; la valeur est affichée et copiable.

### Hors périmètre

- Propriétés personne, fichiers & médias, formule, rollup, créé/modifié le/par.
- Ouverture du lien, du client mail ou du composeur téléphonique au clic.
- Formatage riche du texte.
- Import des plages de dates et des statuts Notion.

## Clarifications

### Session 2026-11-04

- Le propriétaire veut d'abord les types manquants qui n'exigent ni nouveau
  stockage ni nouveau sous-système. URL, e-mail et téléphone répondent à ce
  critère ; personne, fichiers et formule restent des features séparées.
- Le propriétaire veut la même présentation que Notion : trois entrées distinctes
  dans le choix de type, une icône par type et un exemple de valeur au champ.
- Le propriétaire accepte que le clic ouvre l'édition de la cellule plutôt que
  le lien, tant que la valeur reste lisible et copiable ; l'ouverture directe
  est repoussée à la passe de chrome de table.

## User Scenarios & Testing

### User Story 1 — Créer et remplir une propriété de contact (Priority: P1)

Le propriétaire ajoute « URL », « E-mail » ou « Téléphone » à une source, saisit
une valeur dans une entrée, la voit affichée dans toutes les vues de cette
source. Une valeur invalide est refusée avec un message proche du champ.

**Why this priority**: sans création ni saisie, le type n'existe pas.

**Independent Test**: créer chaque type depuis une base, saisir une valeur
valide, recharger, la retrouver à l'identique dans les cinq formats.

**Acceptance Scenarios**:

1. **Given** une base ouverte, **When** le propriétaire choisit « Ajouter une
   propriété », **Then** URL, E-mail et Téléphone apparaissent à côté des types
   existants, avec leur icône.
2. **Given** une propriété URL, **When** il saisit `https://exemple.fr/page` et
   quitte le champ, **Then** la valeur est enregistrée et affichée telle quelle.
3. **Given** une propriété E-mail, **When** il saisit `sans-arobase`, **Then** la
   saisie est refusée, le brouillon reste dans le champ et un message explique
   le format attendu.
4. **Given** une propriété Téléphone, **When** il saisit `+33 6 12 34 56 78`,
   **Then** la valeur est acceptée.
5. **Given** une valeur existante, **When** il vide le champ, **Then** la valeur
   est retirée et la cellule affiche l'état vide.

### User Story 2 — Filtrer, trier et rechercher (Priority: P2)

Les nouveaux types se comportent comme du texte dans les filtres, les tris et la
recherche globale.

**Why this priority**: une propriété qu'on ne peut pas retrouver n'est pas utile.

**Independent Test**: filtrer avec `contient`, trier A→Z, retrouver la valeur par
la recherche de l'espace.

**Acceptance Scenarios**:

1. **Given** une propriété E-mail renseignée, **When** le propriétaire filtre
   avec `contient "@exemple.fr"`, **Then** seules les entrées correspondantes
   restent visibles.
2. **Given** plusieurs entrées, **When** il trie la propriété URL, **Then**
   l'ordre est celui des chaînes, valeurs vides en premier ou en dernier selon
   le réglage existant.
3. **Given** une valeur e-mail, **When** il cherche son domaine dans la recherche
   globale, **Then** l'entrée est trouvée.

### User Story 3 — Importer depuis Notion (Priority: P3)

Une base Notion contenant des propriétés URL, e-mail et téléphone est importée
avec les trois types conservés, sans conversion en texte.

**Why this priority**: la fidélité de l'import est un engagement du canevas.

**Independent Test**: importer une base de test Notion, vérifier les types et les
valeurs dans l'aperçu puis après application.

**Acceptance Scenarios**:

1. **Given** une base Notion avec une URL, **When** l'aperçu est calculé,
   **Then** la propriété porte le type `url` et la valeur est conservée.
2. **Given** une valeur Notion invalide pour le type, **When** l'aperçu est
   calculé, **Then** un avis d'import est émis, la valeur n'est pas écrite et
   l'archive originale reste disponible pour la récupération.
3. **Given** un ancien import où la propriété était devenue texte, **When** le
   propriétaire la convertit en URL depuis les réglages, **Then** les valeurs
   texte existantes restent affichées.

### UX States

- Vide : `—` dans les cellules et le champ montre un exemple (`https://…`,
  `nom@exemple.fr`, `+33 …`).
- Erreur : message sous le champ, saisie conservée, focus dans le champ.
- Chargement : les contrôles restent désactivés comme pour les autres types.
- Valeur longue : tronquée dans la cellule avec le titre complet accessible,
  champ défilant en édition.
- 320 px : la cellule et le panneau de propriété restent utilisables, sans
  débordement horizontal de la page.

## Requirements

### Functional Requirements

- **FR-001** : `DATABASE_PROPERTY_TYPES` expose `url`, `email` et `phone`.
- **FR-002** : une définition ne peut contenir ces types qu'avec une config vide.
- **FR-003** : la validation d'écriture normalise les espaces de bord et refuse
  une chaîne vide (retrait de valeur), une URL sans schéma `http`/`https`, un
  e-mail sans `@` et domaine, un téléphone sans chiffre.
- **FR-004** : les bornes sont 2048 caractères pour l'URL, 254 pour l'e-mail,
  40 pour le téléphone.
- **FR-005** : une valeur héritée invalide reste lisible en lecture.
- **FR-006** : les filtres `equals`, `not-equals`, `is-empty`, `is-not-empty`,
  `contains`, `not-contains` sont disponibles.
- **FR-007** : l'import Notion mappe `url`, `email` et `phone` vers les nouveaux
  types et conserve les valeurs.
- **FR-008** : l'import conserve l'avis `import.property-static-text` pour les
  types encore inconnus.
- **FR-009** : la recherche indexe les valeurs des trois types comme du texte.
- **FR-010** : l'export canonique accepte les trois types dans `sourceType`.
- **FR-011** : changer le type d'une propriété vers l'un des trois conserve le
  texte existant sans le convertir ni le perdre.

### Key Entities

- **DatabaseProperty** : gagne trois variantes à config vide.
- **EntryValues** : inchangé ; la valeur reste `{ kind: "text", value }`.

## Success Criteria

- **SC-001** : les trois types sont créables, modifiables et affichés dans les
  cinq formats.
- **SC-002** : une valeur invalide n'est jamais persistée par l'interface.
- **SC-003** : un import Notion conserve le type et la valeur.
- **SC-004** : les tests existants des bases restent verts.
- **SC-005** : aucune migration n'est ajoutée.
