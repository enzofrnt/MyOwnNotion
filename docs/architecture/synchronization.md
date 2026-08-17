# Synchronisation multi-appareils

Trois décisions structurantes, et pour chacune ce qu'elle refuse de faire. Elles
proviennent de la fonctionnalité 006 ; le détail des exigences est dans
[`specs/006-multi-device-sync/spec.md`](../../specs/006-multi-device-sync/spec.md).

## 1. L'événement transporte une position, jamais un contenu

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

## 2. La détection de conflit n'a pas été reconstruite

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

## 3. La fusion refuse de trancher deux cas

`packages/domain/src/sync/merge-documents.ts` est pure et totale. L'unité est le
bloc, ce que le modèle de document rend possible : les blocs portent une identité
stable, donc « le même bloc a changé des deux côtés » est un fait et non une
supposition. Une fusion au caractère demanderait un historique d'opérations que le
modèle de révisions ne conserve délibérément pas.

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

## Ce qu'une résolution écrit

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
