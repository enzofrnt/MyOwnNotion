# Feature Specification: Couleurs de contenu cohérentes

**Feature Branch**: `codex/notion-api-import`
**Created**: 2026-10-07
**Status**: Implémentée et vérifiée manuellement ; E2E différés
**Input**: Relever les couleurs réelles du Kanban Notion et corriger les couleurs
de l'application avec des transformations communes, sans couleurs brutes dans
chaque composant. Les E2E sont reportés explicitement par le propriétaire.

## Product direction

Le canevas §§14 (bases et Kanban), 17 (stockage local), 39 et 43.6 gouverne cette maintenance.
La demande remplace le contour en couleur pleine de 038 : l'accent d'une
propriété n'est pas sa couleur de bordure. Le contenu, le choix de thème,
les sauvegardes et les interactions existantes sont conservés.

## User Scenarios & Testing

### US1 — Lire un Kanban aux couleurs équilibrées (P1)

Une colonne reste subtile, ses cartes sont plus nettement teintées et les
badges portent la teinte la plus forte. Les contours délimitent sans dessiner
des cadres lumineux. Le bouton de création porte l'accent de sa colonne.

**Independent Test**: comparer les colonnes neutre, bleue et verte au repos,
au survol et pendant l'édition à la référence Notion relevée dans le navigateur.

1. Une carte neutre garde un fond neutre ; une carte colorée garde sa teinte.
2. Le survol éclaire légèrement la carte sans voile gris ni déplacement.
3. Les contours de carte/création font 1 px et restent discrets ; le texte
   d'un bouton coloré utilise un accent lisible adapté au thème.
4. Le badge de groupe est plus présent que le fond de carte et garde un point
   coloré et un libellé lisible. Une option de propriété reprend la même famille.

### US2 — Retrouver une même logique dans l'application (P2)

Les couleurs de propriétés, les surlignages éditoriaux et leurs démonstrations
suivent une palette commune dont chaque rôle se dérive d'une teinte de base.

**Independent Test**: examiner les neuf familles de contenu, les options de
table/éditeur et le sélecteur Page/Dossier en clair/sombre, au clavier et à 320 px.

1. Le changement de thème adapte fonds, contrastes et survols ensemble.
2. Les commandes et les états de danger conservent leurs rôles distincts.
3. La révision de couleur ne modifie ni géométrie, ni valeurs stockées,
   ni progression du chargement 040.

### Edge cases

Colonne sans option, gris, option longue, badge sur une carte d'une autre
couleur, propriété vide, édition ouverte, bouton désactivé, focus clavier,
thème système sans script de bootstrap et largeur de 320 px.

## Requirements

- **FR001**: Relever fonds, contours, taille des contours, badges et texte des
  créations depuis le rendu réel Notion ; distinguer observation et dérivation.
- **FR002**: Centraliser les teintes de base et les transformations par rôle ;
  les composants ne contiennent aucune table de couleurs brutes par état.
- **FR003**: Séparer les rôles texte coloré, accent, surface faible, surface de
  contenu, badge et contour. Le gris possède un comportement neutre explicite.
- **FR004**: Appliquer ces rôles aux colonnes, cartes, options, création et
  contrôles intégrés ; le survol conserve la teinte et la géométrie.
- **FR005**: Partager les fonds de contenu avec les surfaces éditoriales existantes,
  sans transformer les couleurs métier en états d'application.
- **FR006**: Vérifier le rendu réel aux deux thèmes, à 320 px et au clavier ;
  conserver les preuves et les limites. Les E2E restent une vérification différée.

## Success criteria

- **SC001**: Les colonnes neutre/bleue/verte utilisent trois niveaux distincts
  (colonne, carte, badge), les contours discrets restent de 1 px et les badges
  ne fournissent plus la couleur de contour des cartes.
- **SC002**: Les neuf familles de contenu utilisent les mêmes transformations
  de rôles ; une modification de la teinte ou du thème se propage sans valeurs
  brutes dupliquées dans les consommateurs.
- **SC003**: Les captures réelles montrent un survol teinté sans déplacement,
  un focus clavier visible, des libellés lisibles et aucun débordement de page à
  320 px. Aucun E2E n'est lancé pendant cette passe à la demande du propriétaire.
