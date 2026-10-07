# Plan de maintenance

Lire constitution et canevas §18/19/43.1 ; ui-quality + lessons pour la revue du
parcours d'ouverture, sans changement de présentation. États chargement,
connecté, hors ligne et erreurs restent ceux de l'application.

Caddyfile.dev : gzip négocié uniquement pour le shell/fichiers publics servis
par Vite (hors /v1*, /mcp*, /health*) et pour l'endpoint exact GET /v1/changes,
avec réponse application/json. Exclure explicitement SSE, auth, récupération
et MCP plutôt que compresser toutes les réponses privées. Pas de cache ajouté.
Niveau 1 : compromis mesuré pour réduire le coût CPU du helper local ; le HAR
donne environ 12,1 Mo après compression des 36,8 Mo éligibles à ce niveau,
contre 8,3 Mo au niveau 6 mais avec davantage de CPU. Ne pas promettre un gain
de durée sur loopback, où le transfert coûte déjà très peu.
Conserver reverse_proxy, headers d'origine et flush_interval ; aucune modification
de l'API ni des DTO. Vérifier la config avec Caddy 2.10.2 réellement installé.

Validation : contrats Compose/realtime existants plus assertion de frontière ;
test fonctionnel gzip/identity avec contenu synthétique via proxy jetable,
stream SSE immédiat et WebSocket HMR. Mesurer les octets du HAR en mémoire puis
le transfert live d'un asset public. Rechargements manuels avant/après sur 8082
avec cache HTTP désactivé, projection existante conservée. Ne pas les assimiler
à une première connexion sans projection ; pas d'effacement des données utilisateur.
Reload Caddy du projet myownnotion-notion-api uniquement, aucune recréation d'API
ou DB. Tests/config bornés ; ne pas prétendre à une validation globale production.
