# Feature Specification: Liens d'éléments et insertion de bases

**Branch**: `codex/notion-api-import`  
**Created**: 2026-10-04  
**Status**: Implémentée et validée localement — publication non demandée  
**Input**: Retour du propriétaire sur CNAM et les commandes du menu `/`.

## Product alignment

Le canevas §§10, 11, 13, 14, 18 et 27.1 gouverne cette feature. Elle affine
les liens internes et créations de 033, les bases/sources de 029 et l'import
de 028. Le lien, le placement hiérarchique et l'affichage d'une source restent
trois relations distinctes. La livraison concerne l'instance isolée 8082.

## User Scenarios & Testing

### US1 — Ouvrir un élément par son lien (Priority: P1)

Le propriétaire retrouve dans CNAM un lien vers « Suivi des tâches », comme
dans Notion, et peut insérer un lien vers une page, un dossier ou une base.

**Independent Test**: Importer une base enfant présentée comme page et une
base intégrée ; retrouver respectivement un lien et un affichage de données.
Créer ensuite les trois sortes de liens, renommer leur cible et les ouvrir.

1. Une base Notion présentée comme page devient un lien vers la base native ;
   une base réellement intégrée reste intégrée.
2. `/lien` propose « Lien vers un autre élément », recherche pages, dossiers
   et bases actives, avec leurs titres, chemins et icônes courants.
3. Le lien ouvre sa cible, peut changer de cible et être retiré sans modifier
   sa hiérarchie, ses sources ou ses données.

### US2 — Créer des enfants avec des commandes cohérentes (Priority: P2)

Le propriétaire comprend la distinction entre un enfant ouvrable et un
affichage de base dans le corps d'une page.

**Independent Test**: Créer une page, un dossier et une base depuis leur
commande ; chacun est enfant de la page courante et possède un lien ouvrable.

1. Les libellés sont « Page imbriquée », « Dossier imbriqué » et « Base de
   données imbriquée ». Les recherches `/page`, `/dossier`, `/base` restent utiles.
2. La base imbriquée conserve son parcours d'ouverture et de configuration.

### US3 — Insérer une base avec un seul parcours (Priority: P1)

« Base de données intégrée » permet soit de créer une nouvelle base avec sa
source, soit d'afficher une source existante. Le propriétaire choisit avant
la création ; « Vue liée de base de données » disparaît du menu `/`.

**Independent Test**: Annuler le dialogue sans créer d'élément ; créer une base
vide puis afficher sa source ailleurs, modifier une entrée et constater que
les deux affichages partagent les mêmes données.

1. Le dialogue présente les deux choix et leurs conséquences simplement.
2. Une nouvelle base/source est créée sous la page courante et affichée au
   curseur. Une source existante est affichée sans copie ni déplacement.
3. Les états chargement, absence de source, échec et réessai sont explicites.
   Un échec conserve le choix ; un réessai ne crée pas de doublon.
4. Clavier, Échap, focus, thèmes clair/sombre et largeur de 320px sont utilisables.

### Edge Cases

- Base sans vue disponible, indicateur de présentation absent dans la source.
- Cible supprimée, renommée, déplacée ou convertie ; titres identiques.
- Plusieurs sources dans une base, source supprimée pendant le choix.
- Annulation, double clic, interruption entre création et insertion, éditeur
  conservé en mémoire lors d'un changement de page.
- Contenu importé déjà édité localement : préserver cette édition.

## Requirements

- **FR-001**: Distinguer liens vers bases enfants et bases intégrées à l'import.
- **FR-002**: Rechercher et référencer pages, dossiers et bases avec titre/icône
  courants et identité stable, sans créer d'affichage de données à leur place.
- **FR-003**: Uniformiser les actions de lien et les créations imbriquées dans
  les menus concernés, sans changer les documents existants par renommage.
- **FR-004**: Une seule commande de base intégrée ouvre les deux choix de source.
- **FR-005**: Créer une nouvelle base/source ou afficher une source existante
  conserve la distinction de propriété et n'introduit pas de copie d'entrées.
- **FR-006**: Aucun élément n'est créé avant confirmation ; les erreurs sont
  récupérables et les réessais ne créent pas de doublon.
- **FR-007**: Vérifier clavier, focus, thèmes, largeur étroite et fonctionnement
  hors ligne pour les données déjà présentes.
- **FR-008**: Sauvegarder puis corriger l'import isolé en préservant identités,
  éditions locales, sources, entrées et l'autre instance de développement.

### Key Entities

- Lien interne : cible canonique, représentation courante et navigation.
- Élément imbriqué : enfant dans la hiérarchie avec lien dans le contenu.
- Affichage intégré : présentation d'une source, indépendante de sa propriété.
- Choix d'insertion : nouvelle source ou source existante, puis confirmation.

## Success Criteria

- **SC-001**: CNAM ouvre Suivi des tâches depuis un lien ; les fixtures distinguent
  les deux présentations sans perte de base, source ou entrée.
- **SC-002**: Les trois types de cibles sont recherchables et ouvrables au clavier.
- **SC-003**: Le menu contient trois créations imbriquées et une seule commande
  de base intégrée ; annulation et double activation n'ajoutent aucun doublon.
- **SC-004**: Les deux choix d'insertion et leurs états passent les tests ciblés
  et la revue visuelle dans les deux thèmes, à 1440 et 320px.

## Assumptions and clarifications

- Le choix « nouvelle source » crée une base enfant propriétaire et sa première
  source ; afficher l'existant crée une présentation liée sous la page courante.
- Les bases liées sont aussi des cibles de lien ; les fichiers restent hors du
  sélecteur demandé. Une base sans vue exploitable reste accessible par son lien.
- Les noms proposés par le propriétaire sont retenus. L'implémentation et la
  correction locale sont autorisées ; aucune publication n'est demandée.
