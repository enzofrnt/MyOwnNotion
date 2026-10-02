# Contrat UI — 032

1. Bouton de formulaire/action commune : `Button`, rôle de variante conservé.
   Densité compacte explicite ; alignement label horizontal ; redimensionnement
   au hover/focus/busy interdit. Danger neutre, texte/contour rouges.
2. Saisie : `Field` ou `.ui-native-select` / `.ui-native-textarea` ; labels,
   disabled et erreur conservés. Contrôles éditoriaux/graphes restent spécifiques.
3. Information/vide : titre principal, aide muted, fond transparent.
   Premier chargement : skeleton contextualisé ; refresh conserve le contenu.
4. Menu/modal : primitives existantes, focus initial/retour/Escape, même surface
   neutre. Pas de halo ni overlay local qui réinvente la couche commune.
5. Layout : contenu dominant, aides secondaires, séparateurs fins. Pas de carte
   autour de chaque ligne de réglage. Texte long et 320 px sans overflow document.
6. Palette de contenu et données : inchangées. Pas de changement de API/storage.
7. Toute adaptation locale de primitive commune est justifiée dans l’inventaire
   et limitée au rôle/géométrie nécessaire, vérifiée sur rendu réel.
