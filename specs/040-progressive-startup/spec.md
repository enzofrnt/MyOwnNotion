# Feature Specification: Chargement progressif du workspace

**Feature Branch**: `codex/notion-api-import`
**Created**: 2026-10-07
**Status**: Specified
**Input**: Afficher les premières pages racines sur un appareil neuf, puis charger le reste en arrière-plan ; corriger les autres lenteurs concrètes de navigation.

## Product Direction, Dependencies, and Scope

Raffine le canevas §§12 (navigation et états), 17–19 (local, hors ligne,
synchronisation) et 43.1/43.6 (rapidité perçue et UI). Préserve les contrats des
features 001, 005, 006, 018 et 039. Change la disponibilité de l'affichage,
jamais l'autorité du journal, les identités ou le chiffrement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Racines avant la fin du téléchargement (Priority: P1)

Le propriétaire voit les racines actuelles puis les descendants par lots.

**Independent Test**: Retarder un lot sur appareil vierge ; ouvrir une racine
avant sa libération, puis comparer l'état final au serveur.

**Acceptance Scenarios**:
1. **Given** un appareil vierge et un workspace rempli, **When** il démarre,
   **Then** ses racines actuelles sont visibles avant la fin des descendants.
2. **Given** un chargement incomplet, **When** une branche est ouverte,
   **Then** elle indique le chargement et ne prétend pas être vide ; une
   interruption indique l'indisponibilité et permet de reprendre.
3. **Given** une URL de descendant absent localement, **When** le chargement
   continue, **Then** sa destination reste réservée sans faux introuvable.
4. **Given** un rattrapage interrompu, **When** l'application redémarre,
   **Then** les données reçues apparaissent et le chargement reprend sans perte,
   faux vide, ni disparition des branches/onglets restaurés.

### User Story 2 - Retour aux données locales sans attendre (Priority: P1)

Le propriétaire retrouve son contexte local sans attendre le réseau.

**Independent Test**: Retarder le réseau sur un appareil rempli ; lire/modifier
une page locale, reconnecter et vérifier la convergence.

**Acceptance Scenarios**:
1. **Given** une projection locale, **When** le réseau est lent ou absent,
   **Then** navigation et contenu local apparaissent sans attendre ce réseau.
2. **Given** des écritures/conflicts en attente, **When** le rattrapage reprend,
   **Then** les intentions et projections locales sont conservées et les
   barrières d'activation éditoriale restent effectives.
3. **Given** une base dont la définition manque encore, **When** elle est
   ouverte, **Then** un chargement explicite remplace tout faux état vide.

### User Story 3 - Travail dérivé utile uniquement (Priority: P2)

La recherche ne reconstruit pas un index inutilisé pendant le téléchargement.

**Independent Test**: Cent notifications sans recherche ne déclenchent aucune
lecture/indexation ; la première recherche reflète les dernières données.

**Acceptance Scenarios**:
1. **Given** la recherche jamais ouverte, **When** des lots arrivent, **Then**
   aucun travail d'indexation locale n'est déclenché.
2. **Given** une première recherche, **When** elle s'ouvre, **Then** les données
   locales courantes sont indexées puis les résultats évoluent normalement.
3. **Given** un lot hiérarchique, **When** il est appliqué, **Then** les éléments
   non modifiés et le contexte de navigation restent stables.

### Edge Cases

Workspace vide ; racine avec beaucoup de texte ; page racine avec enfants ;
lien direct vers une base ; suppression/move en cours ; notification entre
lecture et commit ; plusieurs onglets ; panne locale/réseau ; appareil révoqué ;
projection partielle reprise hors ligne.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Prioriser les racines actuelles sur appareil vierge puis continuer
  automatiquement le téléchargement complet en arrière-plan.
- **FR-002**: Publier chaque lot durable reçu avant le dernier lot.
- **FR-003**: Afficher les données locales avant le rattrapage ; conserver les
  barrières de sécurité et d'autorité des écritures.
- **FR-004**: Distinguer couverture partielle/complète durablement, chargement,
  indisponibilité, erreur et vide véritable. Préserver URL, onglets et branches.
- **FR-005**: Conserver ordre, curseurs durables, idempotence, conflits, contenu
  non envoyé, chiffrement et reprise entre appareils/onglets.
- **FR-006**: Ne pas construire ni mettre à jour un index inutilisé ; conserver
  une première recherche exacte et les actualisations, y compris hors ligne.
- **FR-007**: Actualiser les lots hiérarchiques sans lectures unitaires répétées
  ni remplacement des éléments non modifiés.
- **FR-008**: Vérifier les états réels au clavier, à 320 px, dans les deux thèmes
  et les profils requis ; aucun toast technique à chaque élément reçu.

### Key Entities

- Projection locale : éléments reçus avec leurs placements et contenus.
- Couverture : indique la fin de la première découverte complète de l'appareil.
- Journal durable : écritures et frontière de reprise indépendantes de l'affichage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Avec au moins 300 descendants et un lot retardé de 5 s, les
  racines sont utilisables avant la libération du lot.
- **SC-002**: Sur appareil rempli et réseau retardé de 5 s, navigation et page
  locale apparaissent avant la réponse réseau.
- **SC-003**: Après interruption/reprise avec édition locale concurrente,
  projection finale égale au serveur et toutes les intentions conservées.
- **SC-004**: Cent notifications avant recherche produisent zéro lecture dérivée ;
  première recherche et changements ultérieurs restent exacts.

## Assumptions

Réutiliser les lectures autorisées et le journal existant, sans nouveau service,
suppression d'historique ou saut de frontière sur un préchargement partiel. La
durée totale peut rester identique ; le gain est la première disponibilité.
Les racines incluent leur contenu courant pour être ouvrables immédiatement.
Limiter les autres optimisations aux répétitions de travail constatées ici.
