# Research — 2026-10-04

- Décision : conserver pageLink et ses UUID. Le rendu et la navigation prennent
  déjà en charge database/database_view ; le sélecteur seul excluait ces types.
  Étendre ce sélecteur et la copie évite une migration ou un nouveau type de lien.
- Décision : réutiliser DatabaseCreateChoiceDialog et les mutations existantes
  database.create/database_view.create. Un contrôleur au niveau de PageEditor
  porte le bloc/choix, verrouille les doubles confirmations et conserve la cible
  déjà créée lors d'un échec d'insertion. Éviter deux commandes pour le même but.
- Décision : résoudre une vue réellement stockée sur le retry de création enfant.
  Le code actuel préférait un nouvel initialViewId fourni par l'appelant, pouvant
  produire un affichage vers une vue inexistante.
- Décision : sourceId est l'identité de la sélection, avec propriétaire dans
  le libellé si nécessaire ; des sources de même nom ne doivent pas se confondre.
- Décision : conserver is_inline du JSON de base déjà collecté. Le bloc
  child_database ne porte que son titre ; la distinction vient de la base.
  true → intégré si une vue existe ; false/absent → lien. Absence signalée.
  La [documentation primaire Notion](https://developers.notion.com/reference/database)
  décrit is_inline ; [child_database](https://developers.notion.com/reference/block#child-database)
  est un bloc distinct. Aucune API supplémentaire requise.
- Décision : réparer les seules projections inchangées du snapshot historique.
  L'audit privé constate huit liens full-page à rétablir et une intégration à
  conserver. Ne pas réimporter globalement ni modifier les sources/entrées.
