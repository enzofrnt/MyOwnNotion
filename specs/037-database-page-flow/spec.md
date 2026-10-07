# Feature Specification: Lire et enrichir les bases dans le flux de la page

**Feature Branch**: `codex/notion-api-import`
**Created**: 2026-10-04
**Status**: Fixation native revue sur 8082 ; suites suspendues à la demande du propriétaire
**Input**: Quatre remarques du propriétaire : cartes fines à padding vertical égal, scroll de la page avec en-têtes Kanban fixes, création au bas de chaque colonne, ligne d'en-têtes des tables fixe.

## Troisième retour — fixation stable

Le propriétaire accepte l'amélioration générale mais constate que les en-têtes bougent encore pendant le défilement et que le haut arrondi des colonnes Kanban est coupé. La fixation doit être immédiate et stable pendant le geste, avec le fond et les coins supérieurs entièrement visibles. Préserver le défilement vertical de page, l'alignement horizontal, les commandes uniques des en-têtes et l'ajout par colonne. Suites toujours suspendues ; revue directe du rendu sur l'instance isolée.

## Quatrième retour — alignement pendant le geste horizontal

La fixation verticale et les coins sont acceptés. Pendant un défilement gauche/droite, les en-têtes se décalent brièvement du corps. Ils doivent partager son mouvement pendant le geste, et pas seulement retrouver son alignement à l'arrêt. Préserver largeur des colonnes, focus/menu et gestures sur l'en-tête ; livraison isolée 8082, sans reprise des suites suspendues.

## Product direction and scope

Canevas §4.2/4.3, §14, §18/19, §42–44. Dépend de 029 (pages/vues), 033 (table dans le flux), 036 (Kanban par sélection multiple). Applique les quatre remarques aux bases pleine page et intégrées. Préserve filtres, tris, repli, appartenances multiples et contenu canonique. Aucune réinitialisation ou modification de l'instance UI du propriétaire ; mise à disposition sur 8082 isolé.

## User Scenarios & Testing

### US1 — Parcourir un Kanban dense (Priority: P1)

Les cartes occupent la hauteur de leur contenu avec un espace égal au-dessus et au-dessous. Un titre long revient à la ligne et agrandit sa seule carte.

**Independent Test**: titre court, titre sur trois lignes, dossier, état local en attente ; clair/sombre desktop et 320 px.

**Acceptance Scenarios**:

1. **Given** une carte avec titre court, **When** elle est affichée, **Then** sa hauteur reste compacte et le contenu est centré verticalement.
2. **Given** un titre long, **When** la largeur diminue, **Then** le titre reste entier, la carte grandit et les cartes voisines gardent leur propre hauteur.

### US2 — Lire toute la base en faisant défiler la page (Priority: P1)

Le défilement vertical de la page traverse la totalité du Kanban ou de la table. Une fois leurs en-têtes arrivés en haut, ils restent visibles pendant la lecture de leur contenu puis disparaissent lorsque la base sort de la fenêtre.

**Independent Test**: base longue pleine page et intégrée, contenu avant/après, défilement vertical et horizontal, changement d'onglet puis retour.

**Acceptance Scenarios**:

1. **Given** plusieurs colonnes inégales, **When** le propriétaire descend la page au-dessus des cartes, **Then** la page défile et les en-têtes des colonnes restent au bord supérieur visible de la base, sans scroll vertical interne.
2. **Given** une table longue, **When** le propriétaire descend puis défile horizontalement, **Then** toute la ligne d'en-têtes reste visible et alignée avec ses cellules ; ses commandes restent utilisables.
3. **Given** une base intégrée et un paragraphe suivant, **When** la base est dépassée, **Then** ses en-têtes cessent d'être affichés et le contenu suivant reste lisible.
4. **Given** un onglet de page conservé mais masqué, **When** une autre page est parcourue, **Then** ses en-têtes et son ancien scroll n'affectent pas la page visible.

### US3 — Créer dans la bonne colonne (Priority: P1)

Chaque colonne dépliée propose Page et Dossier après ses cartes, y compris à vide. Une création renseigne directement l'état ou la matière de cette colonne ; aucun ajout global n'est répété sous le Kanban.

**Independent Test**: créer une page dans un état, un dossier dans une matière, une entrée sans valeur ; recharger et vérifier l'identité, le parent et les propriétés.

**Acceptance Scenarios**:

1. **Given** une colonne active, **When** Page ou Dossier est activé une fois, **Then** une seule entrée canonique est créée avec la valeur de cette colonne, puis son titre peut être édité.
2. **Given** une colonne Sans valeur, **When** une entrée est créée, **Then** aucune valeur de regroupement n'est ajoutée.
3. **Given** une création en cours ou refusée, **When** le propriétaire interagit, **Then** les doubles envois sont bloqués, le refus reste près de la colonne et une reprise est possible sans entrée partielle.
4. **Given** un appareil hors ligne avec la source disponible, **When** il crée une entrée, **Then** l'entrée et sa valeur sont enregistrées ensemble localement puis synchronisées.

### Edge Cases

Colonne vide ou repliée, sélection multiple avec plusieurs occurrences, plus de 60 cartes par colonne, axe indisponible, titre très long, source retirée pendant l'action, filtre qui masque la nouvelle entrée, menu ouvert pendant le scroll, retour depuis une entrée et taille du panneau de réglages.

## Requirements

### Functional Requirements

- **FR-001**: Les cartes MUST rester compactes, avoir un espace vertical égal et envelopper les titres longs sans hauteur uniforme imposée.
- **FR-002**: En pleine page et intégrée, la table et le Kanban MUST suivre le défilement vertical de la page ; le défilement horizontal reste limité à la base.
- **FR-003**: Les en-têtes MUST rester au sommet visible pendant la lecture de leur base, s'arrêter à sa fin et rester alignés horizontalement ; leurs commandes gardent focus et actions.
- **FR-004**: Chaque colonne dépliée MUST proposer Page et, si disponible, Dossier après les cartes. Le Kanban MUST retirer l'ajout global redondant.
- **FR-005**: La création MUST enregistrer en une seule opération l'identité canonique, le type, le parent dans la source d'origine et la valeur active de la colonne ; Sans valeur n'ajoute rien. La sélection multiple commence avec cette seule matière.
- **FR-006**: Les créations MUST bloquer les doublons pendant l'attente, signaler les refus près de l'action et permettre la reprise ; aucun succès ni entrée partielle ne doivent être annoncés à tort.
- **FR-007**: Les flux MUST conserver le fonctionnement hors ligne, le regroupement natif, la navigation/focus et une lecture fluide avec 1 000 entrées ; les pages masquées ne déplacent pas le scroll visible.
- **FR-008**: Le rendu MUST fonctionner au clavier/souris/toucher, en clair/sombre à 320 px et desktop, sans débordement horizontal de toute la page.

### Key Entities

Entrée canonique (page/dossier, titre, source, valeurs), colonne (option active ou absence de valeur), vue (filtres/tris/ordre/repli) et page contenant la base.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Les quatre remarques sont vérifiées par parcours réels et captures ; titre court et long ont au plus 2 px de différence entre leurs espaces haut/bas.
- **SC-002**: Après un défilement de deux fenêtres, les en-têtes restent alignés à 2 px près et la dernière carte/ligne puis le contenu suivant sont accessibles par le scroll de page.
- **SC-003**: Une activation crée exactement une entrée et sa valeur, conservées après rechargement ; refus et attente ne créent aucun doublon.
- **SC-004**: Avec 1 000 entrées, la lecture et les commandes restent disponibles ; les cinq profils de navigateurs maintenus passent les parcours modifiés.

## Assumptions

Les remarques sont suffisamment précises, sans clarification supplémentaire. Les colonnes repliées masquent l'ajout jusqu'à leur ouverture. La création ouvre l'entrée pour éditer son titre, même si les filtres de la vue la masquent ; elle n'invente pas de valeurs pour satisfaire les filtres. La référence visuelle ne change ni People exclu ni les limites d'import déjà expliquées. Aucun changement de permissions, stockage, chiffrement ou migration ; même propriétaire et source canonique.

## Correction du propriétaire — seconde revue

Ajout par colonne validé. Scroll Kanban et en-têtes non validés ; densité améliorée mais insuffisante. Les en-têtes doivent apparaître sous la barre fixe du chemin et garder cette position ; le Kanban pleine page utilise toute la largeur du viewport comme la table, avec défilement vertical uniquement sur la page. Une carte courte cible environ 42 px au pointeur, avec texte 14 px et espace haut/bas égal ; un titre long reste entier. La campagne de tests reste arrêtée à sa demande ; examiner la vraie page sur 8082 avant de conclure.

## Évolution 038 — création et volet

La feature [038](../038-database-card-flow/spec.md) remplace la création Page/Dossier avec ouverture automatique par une carte de saisie dans la colonne, sans navigation. Les invariants de valeur initiale, scroll et en-têtes demeurent ; elle ajoute les propriétés affichées et le volet canonique.
