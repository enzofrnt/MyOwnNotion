# Contract: Knowledge graph UI

## Routes

| Route | Vue | Repli |
| --- | --- | --- |
| `/graph` | périmètre workspace | carte |
| `/graph/:itemId` | voisinage centré, profondeur récente | état introuvable/indisponible explicite |

Les filtres, le pan et la sélection ne sont pas encodés dans l'URL. Ouvrir un
nœud mène à `/notes/:itemId` et ajoute cette page à la bande d'onglets tout en
conservant l'onglet graphe. Retour navigateur ou réactivation de l'onglet
restaure la route de graphe, pas une copie de la page.

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

La carte occupe tout le canevas sous la bande d'onglets. Les contrôles suivants
vivent dans une HUD et des panneaux superposés, fermés par défaut :

- un bouton révèle le panneau « Filtres et périmètre » ;
- choix du périmètre : espace, branche, voisinage, sélection ;
- profondeur 1, 2 ou 3 pour un voisinage ;
- filtres combinables sous forme de contrôles nommés dans ce panneau ;
- couches « Connaissances », « Hiérarchie » et « Pièces jointes », avec seule
  « Connaissances » active au premier affichage ;
- action unique « Réinitialiser les filtres » ;
- bascule « Carte / Liste » ;
- zoom à la molette et au clavier (`+`, `-`, `0`), sans plancher de
  dézoom (un plancher numérique 0,01 évite un viewBox dégénéré) ;
  le zoom avant reste borné à 4 ; « Ajuster » et le pourcentage vivent
  dans le bouton d'information, pas sur la carte ;
- les états de couverture, de troncature et de reconstruction vivent dans un
  bouton d’information, pas dans un bandeau permanent ;
- le détail d'un nœud s'ouvre en superposition à la sélection et se ferme sans
  quitter la carte.

Toute action possède un texte visible ou un `aria-label` français. Les états
actifs utilisent texte et attributs, jamais uniquement la couleur.

## Canvas keyboard model

- Tab atteint la barre de commandes, puis les nœuds de la carte ;
- flèches déplacent la sélection vers le nœud visuel voisin ;
- Entrée ouvre l'inspecteur, puis « Ouvrir la page » ouvre le contenu ;
- Échap ferme l'inspecteur et rend le focus au nœud ;
- `+`, `-` et `0` zooment ou recentrent lorsque la carte a le focus.

## Canvas pointer model

- glisser le fond avec le bouton principal déplace la carte et affiche un
  curseur de prise ; relâcher termine le déplacement même hors du SVG ;
- la molette, le pinch et le glissement deux doigts d'avant en arrière
  au-dessus de la carte zooment autour des coordonnées du pointeur, sans
  panoramiquer ; l'inertie après relâchement ne continue pas à zoomer ; un
  cran de molette reste un pas discret ; un glissement horizontal au
  trackpad ne déplace pas la carte ; le défilement correspondant dans la
  carte est empêché, le dézoom n'a pas de plancher UX et seul le zoom avant
  est borné ;
- « Ajuster » et le niveau de zoom ne forment pas une barre permanente sur
  la carte : ils restent dans le bouton d'information, avec les quatre
  forces (centre, répulsion, liaison, distance) au même endroit ;
- glisser un nœud le déplace sur la carte sans panoramiquer le fond, échauffe
  la simulation et laisse le voisinage suivre ; relâcher retire le pin ;
- les nœuds sont des disques pleins dont le rayon visuel suit le nombre de
  références, borné comme la formule publique d'Obsidian ; les libellés
  s'affichent sous le nœud et s'estompent avec le zoom ; les flèches ne
  s'affichent pas sur la carte (la direction reste dans l'inspecteur) ;
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

## Responsive

- sous 480 px, la carte reste la vue unique ;
- aucun contrôle ne force la page au-delà de sa largeur à 320 px ;
- les filtres se révèlent dans un panneau superposé, refermable ;
- l'inspecteur est un panneau superposé, pas une colonne permanente ;
- à 200 % de zoom, toutes les actions restent atteignables au clavier.

## Copy

Les termes français canoniques sont : « graphe », « élément », « relation »,
« référencé par », « pointe vers », « profondeur », « périmètre », « filtre »,
« vue complète » et « vue partielle ». Les UUID et types techniques bruts ne
sont jamais le libellé principal.
