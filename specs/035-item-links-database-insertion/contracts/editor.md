# Editor contract

- /lien : « Lien vers un autre élément », recherches par nom/chemin, cibles
  page/dossier/base active ; choisir insère la référence, pas une vue.
- /page, /dossier, /base : trois créations intitulées « … imbriqué(e) »,
  lien d'enfant sans badge de raccourci ; base ouvre son conteneur.
- /base intégrée : « Base de données intégrée » ouvre les deux choix. Les anciens
  alias /vue liée et /pleine page restent des recherches compatibles, sans
  entrée dupliquée. Une annulation ne crée aucun élément.
- Sources existantes : lecture locale, statut de chargement/vide/échec et retry ;
  sourceId choisi ; confirmation insère une vue sans copier ni déplacer.
- Retry : conserver le choix ; si la création est déjà durable, réutiliser
  conteneur/vue et bloquer le changement de choix jusqu'à insertion ou fermeture.
- Perte d'activité de la page : le dialogue disparaît et conserve l'appartenance
  de toute confirmation déjà déclenchée à son parent d'origine.
