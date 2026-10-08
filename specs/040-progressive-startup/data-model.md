# Data Model

La projection, placements, outbox, conflits et journaux éditoriaux sont inchangés.
Meta ajoute une couverture initiale : partial avant première lecture, complete
après un dernier lot durable sans erreur ni abandon pour écritures locales,
ou après l'installation durable d'un snapshot complet.
Une projection historique sans marqueur adopte partial : un curseur seul peut
provenir d'un premier téléchargement interrompu et ne prouve pas la complétude.
Le local reste lisible immédiatement. Un boot vierge établit partial avant
les transports concurrents. Un abandon réseau ne modifie jamais complete/partial
mensongèrement. Prélecture racines : verrou, garde outbox, aucun changement cursor.

La couverture UI correspond à son catalogue accepté : lire la frontière avant
le catalogue, publier les deux ensemble et attendre la lecture de l'abonné avant
la notification finale. Une frontière transport ne peut pas supprimer des onglets
dont la dernière lecture de projection n'est pas encore rendue.
