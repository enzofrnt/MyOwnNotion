# Connecter un assistant à MyOwnNotion

MCP fait partie de la V1. Il utilise le serveur de votre installation : ouvrez
**Réglages → Sécurité et appareils → Accès des assistants** pour autoriser un assistant.
Une connexion représente votre délégation, sans créer de compte supplémentaire.

Choisissez un nom, les actions utiles, les branches autorisées et l'accès aux
fichiers. Une branche inclut ses descendants. Recherche et lecture sont des
permissions distinctes. L'option « Tout l’espace, y compris le futur contenu » doit être choisie
explicitement. Les accès expirent après 90 jours par défaut ; vous pouvez réduire
la durée ou reconnaître explicitement le risque d'un accès sans expiration.
Une authentification récente est nécessaire pour autoriser ou révoquer.

Le code affiché expire après dix minutes et ne fonctionne qu'une fois. Ouvrez
la page d'autorisation dans les réglages pour vérifier le périmètre avant de
transmettre ce code à l'assistant. L'assistant échange le code en envoyant un
objet JSON `{"code":"…"}` à `/mcp/exchange`. La réponse contient un
`accessToken`, à transmettre ensuite à `/mcp` dans l'en-tête
`Authorization: Bearer …`. Vos cookies de session ne sont jamais nécessaires.

Pour préparer un fichier de configuration depuis un checkout du dépôt, enregistrez
le code temporaire dans un fichier privé à l'aide de votre éditeur, puis lancez :

```sh
bun run mcp:connect --server https://notes.example.com --code-file /private/path/code --output /private/path/mcp.json
```

La commande écrit la configuration HTTP dans un **nouveau** fichier accessible
seulement à votre utilisateur et n'affiche aucun secret. Elle refuse l'écrasement
d'un fichier existant et les serveurs HTTP hors loopback. Le binaire serveur
compilé fournit aussi `bun dist/mcp/exchange-cli.js` avec les mêmes options.
Importez ou adaptez le bloc `mcpServers` pour votre client MCP ; il doit prendre
en charge Streamable HTTP et un en-tête Bearer explicite. Supprimez ensuite le
fichier du code utilisé. Conservez la configuration dans le stockage privé de
votre client ; elle contient une autorisation utilisable jusqu'à révocation.

Le serveur utilise le SDK officiel 2.0.0 : protocole 2026-07-28 et compatibilité
stateless 2025-11-25. Il ne fournit pas d'enregistrement OAuth générique. Une
intégration qui n'accepte que l'inscription OAuth automatique n'est donc pas
compatible avec cette première version. L'URL publique doit utiliser HTTPS via
votre reverse proxy ; `/mcp` et `/mcp/exchange` sont relayés par le serveur Web
fourni. HTTP loopback reste disponible pour le développement.

Les outils permettent de lister, chercher, lire, créer, renommer, éditer des
paragraphes et mettre du contenu à la corbeille. `read_item` fournit la révision
et l'empreinte du document à reprendre dans `edit_page` ; relisez la page si elle
a changé. Les modifications préservent chiffrement, historique et synchronisation.
Les fichiers sont lus par morceaux avec `read_file`, `offset` et `nextOffset` ;
chaque réponse contient au plus 65 536 octets encodés en base64. L'import et le
remplacement de fichiers utilisent encore l'interface de l'application.

Dans les réglages, vous pouvez consulter le statut, les événements et révoquer
une connexion. La révocation bloque la prochaine requête ; les données déjà
remises à l'assistant restent chez lui. Révoquer l'appareil ayant autorisé la
connexion coupe aussi cette délégation. Une restauration complète révoque tous
les anciens accès et codes. Pour renouveler ou après une réponse d'échange perdue,
autorisez une nouvelle connexion puis révoquez l'ancienne.

MCP a besoin du serveur disponible. Il ne stocke ni n'envoie de modifications
hors ligne ; les parcours locaux de MyOwnNotion conservent leur fonctionnement
habituel. La limite d'appel est 300 requêtes par minute et par adresse réseau ;
un dépassement est explicite avec 429. Les erreurs temporaires sont signalées sans
révéler de contenu privé ; les essais d'échange sont également limités.

Dans « Accès des assistants », « Générer le code d’accès » affiche le code
uniquement pour cette visite. « Masquer le code » le retire de l’écran, sans
révoquer la connexion. Le bouton « Actualiser les accès » recharge l’inventaire
et le journal. En cas de demande d’identité récente, confirmez votre passkey
ou votre mot de passe dans le panneau puis réessayez l’action : la saisie est
conservée. « Renouveler par un nouvel accès » reprend le périmètre à vérifier ;
l’ancien accès doit être révoqué séparément.
