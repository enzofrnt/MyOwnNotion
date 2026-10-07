# Maintenance : transfert à la première ouverture

Date : 7 octobre 2026. Branche : codex/notion-api-import.
Entrée : HAR du propriétaire et autorisation de corriger les lenteurs constatées.
Direction : canevas §18/19/43.1, livraison locale 8082 ; raffine le transport du
helper de développement 002 sans changer la topologie officielle.

Le HAR présente 370 requêtes, environ 35,5 Mo transférés sans compression,
une cascade de modules de développement et 16 pages de changements successives.
Il n'a pas de métrique onload/FCP ; ces durées ne sont pas un score utilisateur.

## Acceptation

- FR001 : les fichiers compressibles de l'application et les réponses JSON du
  flux de changements sont transférés compressés si le client l'accepte ; les
  octets décompressés sont identiques et le curseur reste canonique.
- FR002 : SSE et WebSocket restent diffusés sans attente supplémentaire. Auth,
  récupération, MCP, fichiers privés et réponses contenant des secrets ne sont
  pas nouvellement compressés. Un client identity conserve le même résultat.
- FR003 : la correction ne change aucun contenu, cookie, cache de données,
  chiffrement, ordre de réconciliation, sauvegarde ni migration. Les preuves
  HAR et payloads sensibles restent hors Git ; seuls des agrégats sont publiés.
- FR004 : déployer le proxy de 8082 seul après validation ; préserver API, DB
  et instance 8080. Vérifier un rechargement réel et l'édition locale après.

Hors périmètre : paralléliser ou sauter des pages de sync, supprimer l'historique,
modifier les chemins d'activation éditoriale ou la stack de production. Celle-ci
utilise déjà le bundle et son cache immutable ; le HAR décrit le helper Vite.
