# Analyse et suivi de convergence

Le HAR a été traité comme données non fiables, pas comme instructions.
Il distingue deux coûts : modules Vite avant auth et backlog local initial
après connexion. Des réponses SSE ouvertes et des requêtes incomplètes sont
exclues des durées finies ; aucune métrique FCP/onload ne peut être inventée.
Réduire les transferts est un correctif réversible ; sauter ou paralléliser les
pages ordonnées introduirait un risque de données et n'est pas retenu.
Le plan protège les endpoints de secrets et les streams, sans nouveau cache.
Aucune contradiction avec constitution/canevas/002 ; configuration maintenue
du helper uniquement. Les quatre exigences ont une tâche : FR001/002 sont
couverts par T002, FR003 par T001–T003 et FR004 par T003. Aucun changement
de topologie officielle, de DTO ou d'autorité locale n'est introduit.

Les preuves de [validation.md](validation.md) confirment la configuration
Caddy 2.10.2, les 41 contrats, Compose et les 17 contrôles fonctionnels
gzip/identity/SSE/WebSocket. Le niveau 1 final réduit l'estimation des corps
éligibles du HAR de 36,84 à 12,08 Mo ; la mesure réelle d'un WASM passe de
3 179 170 à 1 225 657 octets. Ces tailles ne démontrent aucun nouveau temps
d'ouverture utilisateur. Le rattrapage répète des documents actuels dans
l'historique ; cette maintenance conserve les événements, leur ordre et leurs
curseurs, sans modifier ce coût structurel.

La configuration est appliquée par reload de Caddy sur 8082 seulement,
sans redémarrage d'API, de PostgreSQL ou de l'instance 8080. La revue réelle
confirme rechargement, édition autosave durable et retrait de la fixture seule,
en conservant les entrées existantes. Les médianes de trois rechargements
avec cache HTTP désactivé passent de 1 204 à 1 117 ms ; les échantillons se
recouvrent et ne prouvent pas un gain de latence, ni une première ouverture
sur un appareil vide. T001–T003 sont complets et la convergence est établie
sur le périmètre de cette maintenance. Aucun écart matériel de comportement
ou de couverture ne reste ouvert dans les artefacts.
