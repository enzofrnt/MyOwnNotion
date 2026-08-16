# Ce que porte toute écriture acceptée

Toute mutation acceptée par le serveur doit porter deux garanties, quelle que
soit la route qui l'a acceptée :

1. **Le blocage de rotation est respecté.** Une fois `writeBlockAt` passé, une
   écriture protégée est refusée. Les lectures restent servies : le contenu
   existant demeure lisible dans tous les états, y compris `write-block`.
2. **Le contenu protégé est scellé.** L'enveloppe est écrite dans la même
   transaction que le contenu ; les deux s'engagent ensemble ou ni l'un ni
   l'autre.

Les deux sont vérifiées **à l'intérieur** de la transaction de la mutation. Une
décision prise avant peut être devancée par un blocage qui s'engage entre-temps,
et l'écriture ainsi laissée passer serait scellée sous une clé que la politique
avait déjà arrêtée. Comme la garde lève une exception, la mutation entière est
annulée : une écriture refusée ne laisse derrière elle ni contenu ni enveloppe.

## Pourquoi ce document existe

Ces règles étaient appliquées par `handleMutation`, donc par les routes qui
traitent une commande à la fois — `POST /v1/items/:id/convert`, `/trash`, etc.
La route `POST /v1/mutations/batch` ne les appliquait pas : elle appelait
`submitMutation` sans `onAccepted`.

Ce n'était pas une route secondaire. C'est **celle que le client navigateur
utilise pour tout ce qu'il a mis en file**, c'est-à-dire l'essentiel de ce
qu'écrit réellement un propriétaire. Le chemin le plus emprunté était donc le
seul dépourvu des deux garanties : un blocage de rotation ne refusait pas les
écritures faites depuis l'application, et leur contenu s'engageait sans être
scellé.

Un second défaut se tenait derrière le premier. `RotationWriteBlockedError`
n'était traitée nulle part dans le gestionnaire d'erreurs et retombait dans le
cas général, qui renvoie `500 internal.unexpected`. Le blocage était donc
appliqué sur les routes unitaires et jamais explicable au client — exactement ce
que FR-010 de la fonctionnalité 003 interdit : un refus sur lequel le
propriétaire ne peut pas agir.

## Ce qui empêche la régression

- `acceptedWriteGuards` dans `apps/api/src/plugins/mutations.ts` est le seul
  endroit qui construit ces gardes. Une nouvelle route qui appelle
  `submitMutation` sans elle est un oubli visible à la lecture, plutôt qu'une
  différence de comportement invisible entre deux routes.
- L'erreur est traduite en `409 write_blocked`, le code que le client
  reconnaît pour marquer une ligne de sa file d'attente comme bloquée.
- Dans le lot, le refus est rapporté **par mutation** et non pour la requête
  entière. Faire échouer tout le lot ne dirait pas au client *lesquelles* de ses
  écritures ont été refusées, et il les rejouerait toutes ; la file a besoin d'un
  verdict par ligne pour s'arrêter.
- Le parcours `save-state.spec.ts` « when the server refuses the write » pose une
  vraie politique de blocage en base et vérifie que les trois affirmations
  parviennent à l'écran. Il traverse toute la chaîne : c'est lui qui a révélé
  l'absence de garde, une réponse simulée n'aurait prouvé que le rendu du
  composant.
