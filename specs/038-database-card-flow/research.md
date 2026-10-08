# Research

7 octobre : observation réelle création complète, crayon rouvrant les champs
et menu de carte (modifier propriété, icône, ouvrir, copier lien, déplacer,
corbeille). Seule la carte « Revue cartes complète 038 » mise à la corbeille ;
compteur Pas commencé revenu à 8. Les huit retours étendent 038. Réutiliser
les éditeurs typés et la confirmation de conversion. Les fonctions propres
à Notion ne sont pas simulées ; duplication récursive reste hors périmètre.

- Décision : création de carte inline au bas de chaque colonne. Observation dans Notion le 6 octobre : bouton Créer tâche, focus titre, Entrée prépare suivante, Échap retire vide. Alternative rejetée : ouverture directe, explicitement refusée par le propriétaire.
- Décision : propriétés depuis la présentation de vue existante. Les contrôles de visibilité/ordre existent déjà ; BoardCards les ignore. Alternative rejetée : nouvelle préférence parallèle.
- Décision : volet indépendant avec composants canoniques existants. La base doit rester montée. Alternative rejetée : navigation de route remplaçant la base ou copie d'éditeur/propriétés.
- Données privées de référence dans work/notion-api/notion-side-peek-reference.png. Carte temporaire nettoyée par déplacement dans la corbeille ; nombre initial rétabli, aucun changement de visibilité sur Notion.

## Réutilisation vérifiée

Recherche déléguée en lecture seule conformément au skill de planification :
EntryPanel et WorkspacePageEditor possèdent déjà les écritures canoniques.
DatabasePage est la jonction partagée des containers et blocs intégrés ; un
contexte de présentation évite de modifier les liens de navigation ordinaires.
Le scroller du volet doit être identifié par les mesures de l'éditeur et de la
virtualisation. Le portail d'historique du volet ne doit pas prendre celui de
la page sous-jacente.

La recherche a aussi identifié une perte de sourceId lors du remplacement des
valeurs secondaires. Résolution depuis l'appartenance, conservation du sourceId
et régression sur la création/édition secondaire. L'analyse d'impact d'une
définition exclut les appartenances des autres sources, dont les anciennes
appartenances primaires sans sourceId. Le passage en pleine page garde la même
définition secondaire que le volet.
