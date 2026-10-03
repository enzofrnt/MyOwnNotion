# Feature Specification: Revue complète et composants communs de l’application

**Feature Branch**: `codex/033-app-ui-review`
**Created**: 2026-10-03
**Status**: Implémentée — revue du propriétaire en attente
**Input**: « Commit en l’état, passe complète sur l’app ; composants génériques réutilisables si cohérents, sans casser les interfaces. »

## Direction produit et périmètre

Canevas §§4, 7–22, 24, 26–33, 38–39, 43.4–43.6, 46. Suite de 031/032 :
étendre la revue aux familles implémentées et surfaces conditionnelles (conflits,
récupération, historique, fichiers, formats de base et menus). Le renderer
desktop partagé est inclus ; packaging et chrome natif OS restent hors périmètre.
Les fonctions futures ou réservées au terminal n’ajoutent pas d’écran.

## User Scenarios & Testing

### User Story 1 — Parcourir une application uniforme (Priority: P1)

Retrouver les mêmes repères, y compris lors d’erreur, attente ou décision rare.
**Why this priority**: Les états rares ne doivent pas ramener un autre style.
**Independent Test**: Inventaire des surfaces courantes/conditionnelles, revue
clair/sombre, 320/1280 px, actions sensibles sur exemples isolés.

**Acceptance Scenarios**:
1. **Given** les familles implémentées, **When** la revue finit, **Then** chacune
   possède un résultat/preuve, ou une exclusion motivée pour du code inutilisé.
2. **Given** conflit/fichier/révision, **When** il apparaît, **Then** contenu
   lisible, actions accessibles et aucun débordement du document à 320 px.
3. **Given** attente/erreur/vide, **When** il apparaît, **Then** il reste neutre,
   contextualisé avec reprise locale et géométrie stable.

### User Story 2 — Réutiliser les composants communs (Priority: P1)

Construire les futures interfaces avec des composants documentés et cohérents.
**Why this priority**: Éviter les variantes contradictoires sans casser les parcours.
**Independent Test**: Comparer usages réels de boutons, formulaires, dialogues,
menus, tableaux et états ; essayer les compositions du laboratoire.

**Acceptance Scenarios**:
1. **Given** un rôle partagé, **When** il est harmonisé, **Then** il réutilise un
   composant commun ou une exception de domaine motivée, sans bibliothèque parallèle.
2. **Given** un contrôle remplacé, **When** clic/clavier/Échap, **Then** action,
   focus, saisie, busy/disabled et récupération restent conservés.
3. **Given** tableau éditorial ou de base, **When** les communs évoluent,
   **Then** sélection, édition et géométrie spécialisée restent intactes.

### User Story 3 — Observer et reprendre le travail (Priority: P2)

Observer sur l’instance courante et disposer de règles réellement vérifiées.
**Independent Test**: App/lab accessibles ; guide, inventaire et contrôles consultables.
**Acceptance Scenarios**:
1. **Given** 032 enregistré, **When** la passe commence, **Then** sa référence Git
   reste identifiable et les corrections sont séparées.
2. **Given** données actuelles de dev, **When** les sources changent, **Then**
   elles restent conservées et l’instance utilise ce répertoire.

### Edge Cases

- Texte long/préformaté, fichiers/options, plusieurs colonnes, menus imbriqués.
- Clavier/tactile/mouvement réduit, hors ligne, récupération et erreurs.
- Code historique non monté : exclusion explicite, pas de faux rendu vérifié.
- Formats de base/propriétés typées/source indisponible.

## Requirements

### Functional Requirements

- **FR-001** : Conserver référence du commit initial et données de dev.
- **FR-002** : Inventorier familles et surfaces conditionnelles implémentées ;
  distinguer revue réelle, exemple du composant réel et code inutilisé.
- **FR-003** : Corriger différences de contrôles, titres, espacement et états
  constatées ; conserver densités/interfaces de domaine intentionnelles.
- **FR-004** : Consolider les génériques effectivement partagés ; documenter
  leur emploi/exceptions avec exemples exécutables.
- **FR-005** : Préserver interactions, saisies, focus et données ; aucune
  suppression/restauration/rotation réelle pour obtenir une preuve.
- **FR-006** : Vérifier clair/sombre, 320/1280 px, clavier et cibles tactiles
  sur surfaces corrigées ; scroll local des contenus larges.
- **FR-007** : Accents #4481D8/#D56C5E, palette de contenu conservée, focus
  discret visible, attente neutre, suppression neutre à texte/contour rouges.
- **FR-008** : Instance, preuves, tâches et guide reflètent la passe ; E2E
  différés explicitement à la demande du propriétaire.

### Key Entities

- **Surface** : famille, composant, état et accès réel ou exemple isolé.
- **Contrat commun** : rôle, interactions et variations de domaine admises.
- **Preuve** : rendu, dimensions, thème, contrôle et résultat associé.

## Success Criteria

### Measurable Outcomes

- **SC-001** : 100 % des familles/surfaces conditionnelles inventoriées ont un
  résultat ; aucune surface active exclue faute de données.
- **SC-002** : Aucun débordement du document à 320 px sur surfaces revues ;
  tableaux/code larges défilent localement.
- **SC-003** : Chaque correction commune a deux usages réels ou un besoin
  partagé identifié, documentés/vérifiés sans régression connue.
- **SC-004** : Défauts matériels observés corrigés avant clôture, avec preuves
  et contrôles locaux consultables.
- **SC-005** : App/exemples accessibles sur l’instance courante, données conservées.

## Assumptions

- La bibliothèque existante est la base ; pas d’abstraction arbitraire des
  modèles métier des tableaux, éditeur ou graphe.
- Revue complète des capacités implémentées/états distincts, pas des fonctions
  futures ni de toutes les combinaisons de données possibles.
- Pas d’E2E ni push ; risque et gates différés documentés, aucune release annoncée.
