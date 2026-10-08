# UI contracts

- Création : onCreateInColumn(kind, values, title, relationTargets), identité ou
  refus ; aucun callback d'ouverture. Entrée crée puis propose une carte vide ;
  clic extérieur crée et ferme. Passage entre champs/portails ne termine rien.
  Échap abandonne le brouillon transitoire. Aucun bouton de validation/annulation.
- BoardCardEditor : onSave(draft, continueCreating, previous). L'édition
  existante fusionne seulement les champs changés, sérialise et avance previous
  après succès. onCancel(restoreFocus) ferme après sauvegarde ; extérieur ne
  reprend pas le focus. Saisie refusée conservée, Réessayer local.
- ValueEditor presentation=card : rangées icône/valeur, checkbox et nom ensemble,
  vide « Ajouter [propriété] », date native locale puis instant normalisé.
  Menus/confirmations portalisés appartiennent au périmètre React de la carte.
- ConvertItemControl variant=switch : Page/Dossier toujours présent. Conversion
  canonicale, confirmation seulement si contenu supprimé ; icône origine/flèche/
  destination commune aux commandes de l'arbre et du Kanban.
- Visibilité : view.properties, titre permanent ; édition complète indépendante
  du masquage. Contexte workspace pour édition, conversion, corbeille, icône,
  pleine page. Aucun nouveau contrat réseau ; source issue de l'appartenance.
- Volet : onOpenDatabaseEntry(entryId, trigger, sourceId?), données/commandes
  canoniques ; sortie avant démontage, fermeture immédiate si animations réduites.
- Regroupement : écran group de ViewSettingsPanel, GroupEditor partagé,
  onChangeGrouping(view) attend l'écriture canonique. Choix immédiat, attente
  empêchant un second envoi, erreur avec choix conservé pour Réessayer ; retour
  du focus après réactivation du déclencheur sans voler un focus déplacé ailleurs.
  Axe board obligatoire ; autres formats acceptent Aucun. Filtres/tris/visibilité
  conservés ; ordre/repli des colonnes remis à zéro seulement si l'axe change.
