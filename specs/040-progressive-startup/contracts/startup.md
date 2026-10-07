# Startup contract

initialize : rend disponible le local déverrouillé et les racines préchargées,
pas une promesse de sync terminée. Les callers dépendant d'une frontière serveur
continuent d'appeler synchronize et leurs barrières existantes.

reconcile : callback optionnel après un lot dont toutes les enveloppes ont été
commitées, avec identités affectées, `rebuilt` pour un remplacement de projection
et `complete` pour sa couverture durable. Cet indicateur peut rester vrai sur un
lot non final d'un appareil déjà complet ; ce n'est pas un indicateur de dernier
lot. Le dernier lot initial accepté ou un snapshot complet établit la couverture.
Pas de callback avant durabilité ou après yield local.

Couverture visible dans le snapshot service ; la fin de découverte n'équivaudra
jamais à confirmer toutes les écritures utilisateur. Les notifications de lot
resteront subordonnées à l'ordre du journal et au verrou inter-onglets.
