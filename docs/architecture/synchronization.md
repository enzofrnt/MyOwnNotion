# Synchronisation multi-appareils

La synchronisation possède deux niveaux complémentaires : la structure du
workspace et les anciens corps v2 suivent le protocole de révisions de la
feature 006 ; les corps de pages actifs utilisent le journal CRDT incrémental v3
de la feature 017. Les exigences détaillées vivent dans
[`specs/006-multi-device-sync/spec.md`](../../specs/006-multi-device-sync/spec.md)
et
[`specs/017-v1-notion-like-workspace/spec.md`](../../specs/017-v1-notion-like-workspace/spec.md).

## Frontières d'autorité

- Les items, dossiers, propriétés de workspace et mutations anciennes sont
  ordonnés par `changes` et le graphe de révisions.
- Le corps actif d'une page est un état Loro reconstruit depuis un checkpoint et
  des updates immuables, identifiées et dédupliquées. Sa version vector décrit
  la frontier causale connue de chaque côté.
- IndexedDB est l'autorité durable de l'appareil ; une réplique d'éditeur en
  mémoire n'est jamais seule détentrice d'une saisie reconnue comme enregistrée.
- PostgreSQL est l'autorité durable commune. Le serveur accepte les updates de
  manière idempotente, matérialise le format canonique et publie ensuite sa
  position dans `changes`.

Le parcours v3 normal ne remplace jamais le document complet et n'appelle pas
`page.document.replace`. Chaque appareil peut donc modifier hors ligne le même
paragraphe : les opérations de texte convergent au caractère lors de l'échange,
au lieu que le dernier document envoyé écrase le premier. Les intentions que le
CRDT ne doit pas trancher silencieusement, notamment suppression contre édition,
restent des ambiguïtés durables et récupérables.

## Écriture locale et transport v3

Chaque onglet reçoit une identité de pair Loro distincte. Pour chaque geste,
l'adaptateur produit des opérations minimales, puis une transaction Dexie écrit
atomiquement les octets chiffrés, la version vector, le checkpoint éventuel et
la projection canonique locale. L'interface ne peut afficher « enregistré sur
cet appareil » qu'après ce commit.

Le transport groupe ces updates sans changer leurs identités. Sous verrou
serveur de page, l'API déduplique les lots, échange les frontiers, importe les
updates manquantes, valide et matérialise le document canonique, puis commit la
frontier et l'événement `changes`. Une page fermée reste découvrable par l'index
local de routage et reprend au lancement, au retour online ou après un signal
SSE : le montage de l'éditeur n'est pas requis.

## Coordination entre onglets

Deux handles Dexie ou deux bundles JavaScript peuvent viser la même base ; une
file en mémoire dans chaque module ne les sérialise pas. Les fenêtres critiques
sont donc protégées par des Web Locks exclusifs, nommés uniquement avec la base
locale et la ressource workspace ou page :

- une écriture de projection ou de page est atomique entre tous les onglets de
  la même origine ;
- le verrou workspace couvre une passe entière
  récupération-soumission-rattrapage ;
- le verrou page couvre la récupération et le transport d'une seule page ;
- la même ressource n'est jamais verrouillée deux fois dans une pile d'appel.

En dehors du navigateur, les tests injectent une file déterministe avec la même
sémantique. Quand un onglet disparaît, le navigateur libère son Web Lock. Le
successeur qui l'acquiert récupère seulement les lignes `sending` de cette file
et reprend leurs mêmes identités idempotentes. Il n'existe plus de reset global
au démarrage : un nouvel onglet ne peut pas voler ni réexpédier l'envoi vivant
d'un autre onglet.

## BroadcastChannel accélère, IndexedDB prouve

Le canal inter-onglets ne transporte pas une seconde autorité de contenu.
L'émetteur notifie seulement après le commit Dexie, avec l'identité, une copie
des octets et la version vector de l'update. Le destinataire n'applique jamais
les octets du message : il doit retrouver exactement l'update chiffrée dans la
base partagée, ou prouver que l'état durable de la page domine déjà causalement
sa frontier, avant d'adopter cet état partagé et d'actualiser l'interface.

Une notification invalide ou invérifiable n'est ni importée directement ni
acquittée. Après adoption, le service déclenche le drainage réseau borné ; le
canal est fermé lorsque la dernière session montée de cette page se ferme. Le
canal réduit donc la latence entre onglets, tandis que la convergence reste
correcte s'il est retardé, dupliqué ou absent.

## Stabilité d'une rafale de saisie

BlockNote peut avoir déjà calculé plusieurs offsets contre le texte visible
quand une update distante arrive. Importer cette update entre deux touches
réinterpréterait les événements restants contre une autre base. Pendant une
rafale locale, la session garde donc sa réplique visible stable tout en
committant chaque geste dans IndexedDB. À la fin de la rafale, elle adopte la
frontier durable complète. Cette courte frontière protège l'intention de saisie
sans retarder l'autosauvegarde ni créer une branche concurrente.

## Le flux serveur transporte une position, jamais un contenu

Le flux `GET /v1/changes/stream` envoie des événements de la forme
`{"cursor":"42"}` et rien d'autre. L'appareil qui les reçoit va ensuite lire
`/v1/changes?after=<son propre curseur>`, exactement comme il le fait quand rien
n'est connecté.

**Pourquoi ne pas pousser le contenu.** Ce serait un aller-retour de moins, et un
second chemin d'entrée du contenu dans l'appareil. Le chemin de lecture existant
résout les enveloppes scellées et vérifie la version de protocole ; un contenu
poussé sur le flux ne passerait ni par l'un ni par l'autre, et l'appareil
détiendrait alors des données qui n'ont franchi aucune de ces portes. La
fonctionnalité 005 a trouvé exactement cette forme de défaut dans la route de
lot : le chemin d'écriture le plus utilisé avait dérivé des garanties que les
autres appliquaient.

**Ce que cela offre en plus.** Une position est un fait, pas une opération : la
recevoir deux fois équivaut à la recevoir une fois. La redélivrance devient donc
gratuite (FR-007), alors qu'un événement porteur d'opération aurait exigé une
déduplication.

**Pourquoi SSE et non WebSocket.** Tout le trafic va du serveur vers le client.
Les appareils écrivent par les routes de mutation, qui portent déjà
l'idempotence, les contrôles causaux, le scellement et le blocage de rotation. Un
WebSocket ajouterait un second chemin d'écriture dont la seule particularité
serait de n'avoir aucune de ces protections. En prime, `EventSource` reconnecte
seul et renvoie `Last-Event-ID`, ce qui fait de la reconnexion et du rattrapage
un seul mécanisme au lieu de deux — et deux mécanismes, ce sont deux occasions de
perdre un événement.

## Révisions et conflits du workspace ou du protocole legacy

Le graphe de révisions répond déjà à la question. `parent_revision_ids` distingue
« en retard » de « divergé » : un appareil en retard produit une révision dont
l'ancêtre est la tête courante, un appareil divergé n'en produit pas.

C'est ce qui rend FR-011 — « un appareil simplement en retard ne doit jamais
produire un faux conflit » — structurel plutôt que promis. Un second mécanisme de
détection, fondé sur des horodatages ou sur des numéros de version, pourrait
désigner un conflit là où la lignée n'en voit pas, et l'ordre observé dépendrait
alors de celui des deux qui a répondu.

**La table `changes` est la seule autorité d'ordre**, et cette fonctionnalité n'en
ajoute aucune. Le flux ne fait que citer la position qu'elle a atteinte.

## La fusion legacy refuse de trancher deux cas

`packages/domain/src/sync/merge-documents.ts` reste la fusion conservatrice des
révisions legacy ; elle n'est pas le moteur d'un corps actif v3. Son unité est le
bloc, ce que le modèle de document rend possible : les blocs portent une identité
stable, donc « le même bloc a changé des deux côtés » est un fait et non une
supposition. La fusion au caractère des pages v3 appartient au journal
d'opérations Loro, pas à ce graphe de snapshots.

Deux situations sont rendues à la propriétaire :

- **le même bloc modifié des deux côtés** — évident ;
- **un bloc supprimé d'un côté et réécrit de l'autre** — moins évident, et c'est
  celui qu'une fusion naïve tranche silencieusement. Prendre la suppression jette
  une réécriture ; prendre la réécriture ressuscite ce qui a été retiré. Les deux
  sont des intentions, et aucune règle ne peut choisir sans se tromper une fois
  sur deux.

Tout le reste fusionne sans rien demander (FR-013). C'est ce qui protège la
question elle-même : une interface qui demande à chaque reconnexion apprend à sa
lectrice que la question est du bruit.

**L'ordre du résultat est celui de l'appareil local, puis les blocs présents
seulement à distance.** Entrelacer produirait un agencement qu'aucun des deux
appareils n'a eu, et que personne n'a donc relu. Quand cet ordre n'est pas le bon,
l'écran de résolution permet de le corriger à la main — ce que la règle ne peut
pas deviner, la personne le décide.

## Ce qu'une résolution legacy écrit

Une révision dont `parent_revision_ids` contient **les deux** révisions
résolues. Aucune table supplémentaire : elle contiendrait ce que la lignée
exprime déjà, et les deux pourraient se contredire.

C'est ce qui satisfait FR-016 sans machinerie. « Les versions d'origine sont
conservées » devient une propriété du graphe — les deux sources restent
atteignables comme ancêtres — et non une politique de rétention qu'un travail de
purge pourrait oublier d'honorer. L'historique se lit aussi pour ce qu'il est :
une résolution ressemble à un endroit où deux lignes de travail se sont rejointes.

## La fenêtre de compatibilité

`X-MyOwnNotion-Protocol` est envoyé sur **chaque** réponse, pas lors d'une
poignée de main. Une poignée de main est une affirmation sur l'instant où elle a
eu lieu, et ce serveur peut être mis à jour pendant qu'un client tient un flux
ouvert.

Deux seuils, et non un seul : `MINIMUM_READ_VERSION` et
`MINIMUM_WRITE_VERSION`. Un seuil unique ne sait exprimer qu'« autorisé » ou
« refusé », et refuser tout sur une incompatibilité prive une propriétaire d'un
appareil dont les lectures étaient parfaitement sûres. La paire rend le mode
lecture seule exprimable — et quelqu'un qui peut lire peut encore sortir son
travail d'une machine en retard. Les détails de la fenêtre sont dans
[`docs/development.md`](../development.md).

La révocation, elle, est appliquée par le serveur (FR-021) : le flux d'un appareil
révoqué est fermé et refusé à la reconnexion. La réaction du client — le dire,
cesser d'écrire — est une courtoisie qui rend la situation lisible, jamais le
mécanisme. Une garantie qui dépend de la coopération de la seule partie qui a une
raison de ne pas coopérer n'est pas une garantie.
