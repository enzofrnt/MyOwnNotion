# Feature Specification: Bases réutilisables intégrées aux pages

**Feature Branch**: `codex/026-linked-databases`  
**Created**: 2026-09-05  
**Status**: Spécifiée, en cours d'implémentation

**Input**: Une base indépendante peut être affichée dans plusieurs pages normales, avec des vues configurables table, Kanban et calendrier. Les entrées restent des pages canoniques.

## Product Direction, Dependencies, and Scope

Cette extension de la 009 applique les sections 10, 13, 14, 18–22, 27–33 et 42–44 du [canevas](../../docs/product/product-canvas.md). Elle remplace explicitement le report des vues liées de la 009. Les cinq vues déjà livrées, leurs propriétés et leurs garanties restent disponibles. Les fondations 002, 006 et 024 portent chiffrement, synchronisation et sauvegarde complète avant migration. Aucun partage public ni nouveau modèle d'identité propriétaire n'est introduit.

## Clarifications

- Une base est une ressource indépendante ; une page ordinaire l'affiche par un emplacement. Le propriétaire peut insérer plusieurs ressources dans une page et la même ressource dans plusieurs pages.
- Le schéma et les valeurs appartiennent à la source. Chaque emplacement possède ses propres vues enregistrées. Retirer un emplacement ou supprimer sa page conserve la source et les pages d'entrée.
- Une source sans emplacement reste disponible dans le sélecteur de bases. La suppression définitive de sources est exclue de cette extension ; le retrait d'affichage est réversible en réinsérant la source.
- Les bases existantes conservent leurs identifiants et leur affichage sur leur ancienne page hôte devenue une page ordinaire. Les entrées conservent identité, contenu, liens, valeurs et historique.

## User Scenarios & Testing

### User Story 1 — Réutiliser une source (Priority: P1)

Le propriétaire crée une base depuis une page, puis insère cette source dans une deuxième page sans dupliquer les entrées.

**Independent Test**: Créer deux pages, créer une source dans la première, la sélectionner dans la seconde et modifier la même entrée depuis les deux emplacements.

**Acceptance Scenarios**:
1. **Given** une page avec du texte, **When** une base y est créée ou insérée, **Then** le texte reste éditable et la base apparaît dans cette page.
2. **Given** deux emplacements de la même source, **When** une entrée ou propriété est modifiée, **Then** les deux emplacements reflètent la modification avec le même identifiant de page.
3. **Given** plusieurs sources, **When** le propriétaire choisit une source, **Then** son nom permet de la retrouver, y compris sans emplacement actuel.

### User Story 2 — Configurer chaque emplacement (Priority: P1)

Le propriétaire montre par exemple un tableau filtré sur la première page et un Kanban ou calendrier sur la seconde.

**Independent Test**: Créer des vues et filtres différents dans deux emplacements, recharger puis vérifier leur indépendance.

**Acceptance Scenarios**:
1. **Given** deux emplacements, **When** les vues, filtres, tris, colonnes ou regroupements changent dans un seul, **Then** l'autre garde sa configuration.
2. **Given** une propriété statut ou date adaptée, **When** une vue Kanban ou calendrier est choisie, **Then** les interactions existantes modifient les valeurs canoniques partagées.
3. **Given** un écran étroit, **When** l'utilisateur utilise l'insertion et les vues, **Then** les commandes sont utilisables au clavier et le tableau défile dans sa propre surface.

### User Story 3 — Conserver les données (Priority: P1)

Le propriétaire conserve les sources après retrait, corbeille ou purge des pages qui les affichent, et après synchronisation ou restauration.

**Independent Test**: Partir d'une base ancienne, migrer, retirer tous les affichages, supprimer puis purger les anciennes pages hôtes, réinsérer la source et vérifier les identités, valeurs, contenu et historique.

**Acceptance Scenarios**:
1. **Given** une source affichée sur une page, **When** l'emplacement est retiré ou sa page supprimée puis purgée, **Then** la source et toutes ses entrées restent lisibles et réinsérables.
2. **Given** des données présentes sur l'appareil, **When** l'utilisateur configure ou insère une base hors ligne et redémarre, **Then** le travail local chiffré est conservé puis synchronisé sans duplication.
3. **Given** une sauvegarde ou un export complet, **When** ils sont restaurés, **Then** sources, emplacements, vues et pages canoniques retrouvent les mêmes identités.

### Edge Cases

Source absente localement ; données partiellement téléchargées ; propriété retirée utilisée par une vue ; modifications concurrentes du même emplacement ; modifications de deux emplacements distincts ; ancien hôte déjà à la corbeille ; purge de tous les hôtes ; retrait pendant une édition d'entrée ; erreur de persistance gardant la saisie.

## Requirements

- **FR-001** Une source possède une identité et un nom indépendants de ses pages d'affichage.
- **FR-002** Une page ordinaire peut afficher plusieurs sources ; une source peut apparaître sur plusieurs pages.
- **FR-003** Chaque emplacement possède un identifiant stable et ses propres vues enregistrées table, Kanban, calendrier, galerie et liste.
- **FR-004** Les propriétés et entrées sont partagées par la source ; une entrée reste une page canonique éditable avec son historique et ses liens.
- **FR-005** Retirer un emplacement, supprimer ou purger sa page ne supprime ni source ni entrée par appartenance à la base.
- **FR-006** Une source sans emplacement reste sélectionnable et réinsérable.
- **FR-007** La migration conserve les identifiants de sources et entrées, documents, propriétés, valeurs, relations et révisions existantes ; elle utilise la sauvegarde complète préalable vérifiée.
- **FR-008** Les écritures passent par les garanties existantes de validation, chiffrement, révisions, outbox durable et synchronisation ; les divergences incompatibles restent récupérables.
- **FR-009** Les sources, emplacements et vues sont inclus dans export, restauration et sauvegarde. Les noms et configurations privés ne sont pas persistés en clair.
- **FR-010** L'interface présente des actions sémantiques, erreurs avec reprise, état vide, état chargé, thème clair/sombre, focus et largeur de 320 px utilisables.

## Key Entities

- **Source de base** : identité stable, nom, schéma et ensemble de pages d'entrée.
- **Emplacement intégré** : identité stable, page d'affichage et vues propres, sans propriété sur les entrées.
- **Page d'entrée** : identité canonique inchangée, contenu, révisions, valeurs et relations.

## Success Criteria

- **SC-001** Une entrée créée via un emplacement apparaît dans tous les autres sans nouvelle identité.
- **SC-002** Modifier la configuration d'un emplacement laisse toutes les configurations voisines inchangées après redémarrage et synchronisation.
- **SC-003** La suppression et purge de tous les hôtes conservent 100 % des sources et entrées du scénario de migration.
- **SC-004** Un aller-retour d'export/restauration conserve identités, valeurs et configurations ; aucun contenu privé témoin n'apparaît en clair dans les tables ou le stockage local actif.
