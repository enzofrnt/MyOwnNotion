# Tasks: Flux de page des bases

## Setup and design

- [x] T001 Spécifier les quatre commentaires, canvas §14, hypothèses/états et checklist dans spec.md.
- [x] T002 Recherche, plan, modèle/contrat et analyse avant code ; références ui-quality/lessons/guide.

## US1 — Cartes compactes

- [x] T003 Ajouter la vérification navigateur court/long/padding puis ajuster database.css : hauteur selon contenu, padding égal, retour à la ligne (FR001/008).
- [ ] T004 Preuves UI US1 avec ui-quality + lessons L002/010 : clair/sombre 1440/320, icône/dossier/pending et contrôles tactiles.

## US2 — Défilement et en-têtes

- [x] T005 Tests géométrie/masquage et scroll réel ; helper viewport/en-tête natif partagé table/Kanban, listeners/resize propres (FR002/003/007).
- [x] T006 Relier board-view à workspace et origine virtuelle/gap/étendue/focus ; headers bornés à la fin de la base, horizontal local (FR002/003/007).
- [ ] T007 Parcours et preuves UI US2 selon ui-quality + lessons L015/019/020 : 1 000 cartes DOM borné, dernière ligne/carte, inline avant/après, commandes headers, clair/sombre desktop/320, tabs masqués (FR008).

## US3 — Créer dans une colonne

- [x] T008 Tests valeurs initiales et pending/refus/reprise avant code ; callbacks DatabasePage et sources plein/inline, footer Page/Dossier par colonne, succès ouvert pour édition titre, commande atomique existante (FR004/005/006/007).
- [ ] T009 Parcours UI US3 selon ui-quality + lessons L003/005/009/020 : statut/multi-select/missing page/dossier, offline/reload, erreur et double geste, filtre ; captures et focus (FR008).

## Verification and delivery

- [ ] T010 Tests/type/static/format/build Web pertinents, cinq profils navigateur, guide UI/canvas/artifacts cohérents et preuves dans validation.md.
- [ ] T011 Déploiement Web 8082 seul, revue privée réelle et autre instance inchangée, convergence sans écart (tasks byte-identical si aucune lacune).

Dependencies : T001→T002 puis T003→T004 ; T005→T006→T007 ; T008→T009 ; T010→T011. Implémentation séquentielle ; seuls les chercheurs du plan travaillent en parallèle et en lecture seule.

## Steering du propriétaire

Le propriétaire demande d’arrêter les tests et de prendre en compte ses retours. T004/T007/T009 (campagne de preuves), partie matrice de T010 et convergence complète T011 sont différées explicitement ; ne pas les marquer réussies. Les corrections fonctionnelles sont livrées sur 8082. Ne pas relancer ces suites sans demande ultérieure.

## Corrections après retour explicite

- [x] T012 Corriger origine stable/barre du chemin pour headers table/Kanban ; surface page-flow explicite et breakout Kanban pleine largeur ; réduire cartes/cibler wrapper Button ; revue réelle sur 8082 selon ui-quality/lessons, sans relancer les suites arrêtées.
- [x] T013 Redéployer Web isolé seul et consigner la preuve réelle et les limites de vérification.
- [x] T014 Remplacer le déplacement vertical JavaScript par un rail sticky natif ; conserver les commandes uniques, largeur/scroll horizontal partagés et virtualisation ; corriger les coins supérieurs Kanban, selon ui-quality/lessons L009/010/015/016/019. Revue directe sur 8082, suites suspendues.
- [x] T015 Redéployer le seul Web isolé, consigner rendu/stabilité et préserver l'instance UI du propriétaire.
- [x] T016 Donner aux en-têtes et au corps une unique source de scroll horizontal ; mouvement natif lié au corps, layout/resize et focus/gestes préservés, secours pour moteur sans timeline. Revue directe du geste avec ui-quality/lessons L009/010/015/019 ; redéploiement Web 8082 seul et preuves, suites toujours suspendues.
