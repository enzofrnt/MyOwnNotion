# Décisions de conception — 032

## Contrôles et propriétaires

- Décision : réutiliser les primitives et propriétaires 031, puis supprimer
  les contradictions locales réellement observées.
- Motif : la standardisation mécanique préservait intentionnellement les
  apparences historiques ; une nouvelle passe doit traiter leur cohérence.
- Alternatives : remplacement massif des règles ou framework CSS rejetés
  (cascade, édition et densités déjà validées).

## Revue sans effets sensibles

- Décision : démo locale neuve et vrais composants avec fixtures en mémoire
  pour compléter les états sensibles/inaccessibles.
- Motif : pouvoir voir les surfaces sans modifier les données du propriétaire.
- Alternative : modifier les états React/DOM depuis le navigateur rejetée ;
  un scénario vérifiable passe par l’interface ou une fixture explicite.

## Instance locale

- Décision : projet Compose `myownnotion-ui-dev`, mêmes ports, données neuves,
  CA précédente partagée ; conserver les volumes précédents.
- Motif : ancienne démo invalide au contrôle d’intégrité, image omettant
  l’import `tracked-files.ts` du preinstall. Nouvelle image reconstruite.
- Alternative : désactiver le garde de migration ou effacer silencieusement
  les données rejetées.
