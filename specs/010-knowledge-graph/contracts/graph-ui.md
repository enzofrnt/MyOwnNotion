# Contract: Knowledge graph UI

## Routes

| Route | Vue | Repli |
| --- | --- | --- |
| `/graph` | périmètre workspace | liste si petit écran ou préférence |
| `/graph/:itemId` | voisinage centré, profondeur récente | état introuvable/indisponible explicite |

Les filtres, le pan et la sélection ne sont pas encodés dans l'URL. Ouvrir un
nœud mène à `/notes/:itemId`. Retour navigateur restaure la route de graphe,
pas une copie de la page.

## Entry points

- bouton « Graphe » de la navigation principale ;
- action « Voir les relations » pour la page courante ;
- groupe « Référencé par » et groupe « Pointe vers » dans l'inspecteur.

## Required states

- chargement : squelette et étape en français ;
- vide : explication et actions pour créer/relier du contenu ;
- complet : badge « À jour sur cet appareil » ;
- partiel : raison et action de synchronisation ou téléchargement ;
- borné : nombres affichés/total et recommandation de filtre ;
- erreur : dernière vue sûre conservée, action « Recalculer » ;
- offline : connectivité séparée de la complétude.

## Controls

- choix du périmètre : espace, branche, voisinage, sélection ;
- profondeur 1, 2 ou 3 pour un voisinage ;
- filtres combinables visibles sous forme de contrôles nommés ;
- couches « Connaissances », « Hiérarchie » et « Pièces jointes », avec seule
  « Connaissances » active au premier affichage ;
- action unique « Réinitialiser les filtres » ;
- bascule « Carte / Liste » ;
- zoom +/−, recentrage et ouverture du nœud sélectionné.

Toute action possède un texte visible ou un `aria-label` français. Les états
actifs utilisent texte et attributs, jamais uniquement la couleur.

## Canvas keyboard model

- Tab atteint la barre de commandes, puis la liste ordonnée de nœuds ;
- flèches déplacent la sélection vers le nœud visuel voisin ;
- Entrée ouvre l'inspecteur, puis « Ouvrir la page » ouvre le contenu ;
- Échap ferme l'inspecteur et rend le focus au nœud ;
- `+`, `-` et `0` zooment ou recentrent lorsque la carte a le focus.

## Canvas pointer model

- glisser le fond avec le bouton principal déplace la carte et affiche un
  curseur de prise ; relâcher termine le déplacement même hors du SVG ;
- la molette au-dessus de la carte zoome autour des coordonnées du pointeur,
  empêche seulement le défilement correspondant dans la carte et respecte les
  bornes 50–200 % ;
- survoler un nœud conserve ce nœud, ses arêtes directes et ses voisins à pleine
  intensité et atténue le reste sans le masquer ;
- cliquer sélectionne et ouvre le détail ; double-cliquer ou activer l'action
  visible « Ouvrir la page » ouvre l'identité canonique ;
- quitter la carte ou appuyer sur Échap retire le survol/sélection sans modifier
  les données.

Le pan au pointeur ne capture pas le défilement de la page hors de la carte.
Avec `prefers-reduced-motion`, les transitions sont supprimées. La taille des
nœuds rend les hubs visibles à partir du nombre de références entrantes, dans
des bornes qui préservent leurs cibles de clic et leurs libellés.

## List equivalence

La liste expose pour chaque nœud : titre, type, lifecycle, comptes entrants et
sortants. Déplier un nœud montre les mêmes relations agrégées, direction,
libellé, autre endpoint, disponibilité et multiplicité que la carte.

## Responsive

- sous 480 px, la liste est le mode initial ;
- aucun contrôle ne force la page au-delà de sa largeur à 320 px ;
- les filtres se replient dans une région dédiée ;
- l'inspecteur devient un panneau dans le flux, pas une colonne fixe ;
- à 200 % de zoom, toutes les actions restent atteignables au clavier.

## Copy

Les termes français canoniques sont : « graphe », « élément », « relation »,
« référencé par », « pointe vers », « profondeur », « périmètre », « filtre »,
« vue complète » et « vue partielle ». Les UUID et types techniques bruts ne
sont jamais le libellé principal.
