# Validation guide

Instance isolée uniquement : http://127.0.0.1:8082, projet myownnotion-notion-api.

1. Page synthétique : /équation, formule valide/invalide, modification, undo,
   réouverture et lecture hors ligne ; source exportable intacte.
2. Trois titres espacés et un titre replié : /sommaire, clics et scroll ; alterner
   vingt fois avec une page différente, vérifier un seul outline à jour.
   À largeur de fenêtre constante, élargir/rétrécir la barre latérale et vérifier
   que seul l'outline disparaît quand le scrollport workspace passe sous 960 px.
3. Liste synthétique statut/catégorie/date et texte long :1440/320, clair/sombre,
   clavier, vide ; preuves publiques sans données du propriétaire.
4. Import réel : parent réparé, base exclue, équations/TOC natifs, IDs et edits
   conservés. Tester domaine/page-state/web/import, types et builds affectés.
5. Inscrire résultats et preuves dans validation.md puis converger.
