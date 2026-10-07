# Tasks: Parcours des cartes

## Retours du 7 octobre

- [x] T029 FR019 : appliquer ui-quality + lessons ; séparateur, taille un peu réduite et fond actif glissant, libellés fixes, conversion canonique et réduction des animations préservées.
- [x] T030 FR019 : preuve réelle des deux sens/clavier, confirmation sans destruction, création, thèmes et 320 px ; contrôles CSS/build et convergence.

- [x] T027 FR019 : appliquer ui-quality + lessons ; remplacer le fond noir de Page/Dossier par une surface intégrée à la carte, choix actif/survol/focus discrets et arrondis imbriqués.
- [x] T028 FR019 : revue réelle grise/bleue/verte, édition/création, clair/sombre/320 px et clavier ; contrôles ciblés et preuves avant convergence.

- [x] T025 FR018 : appliquer ui-quality + lessons ; conserver la carte courante pendant l'appui/focus sur le crayon suivant de la même colonne, puis basculer au clic après sauvegarde ; préserver l'annulation du geste et les refus.
- [x] T026 SC006 : régression séparant appui/focus et clic ; reproduction et vérification physique dans la même colonne sur 8082, saisie en cours, retour/clavier et relâchement extérieur ; contrôles ciblés et convergence documentée.

- [x] T023 FR017/018 : appliquer ui-quality + lessons ; propriétés visibles éditables au repos, présentation stable et titre sans cadre ; bascule entre crayons après sauvegarde, refus conservé ; tests de comportement ciblés.
- [x] T024 SC006 : observation Notion, mesures et parcours réels sur 8082, titre long/clavier/clair/sombre/320 px ; preuves visuelles, contrôles ciblés, web isolé uniquement et convergence.

- [x] T021 FR016 : appliquer ui-quality + lessons ; retirer le badge de succès/attente sous les entrées, préserver conflits et refus ; régression ciblée sur Kanban/galerie/liste.
- [x] T022 Vérifier manuellement modification silencieuse, fermeture et persistance sur 8082 ; preuves UI et contrôles ciblés, web isolé uniquement.

- [x] T019 FR015 : Grouper dans les réglages de la vue, panneau dédié partagé, mise à jour immédiate, axe indisponible et suppression du contrôle au-dessus du Kanban. Appliquer ui-quality + lessons.
- [x] T020 Preuves manuelles pleine page/intégrée, persistance/isolement, clavier/clair/sombre/320 px ; contrôles ciblés, web 8082 uniquement, convergence documentée.

- [x] T017 Appliquer ui-quality + lessons : autosave sérialisé, fermeture extérieure/portails, création sans boutons, refus conservé ; preuves manuelles et régression bornée.
- [x] T018 Rangées inline, choix Page/Dossier permanent, capsule crayon/menu, icônes directionnelles communes ; ui-quality + lessons, guide/skill, revue réelle sombre/clair/320.

T017/T018 supersèdent la validation explicite de T012. T012 reste une preuve historique.

- [x] T011 Observer création/crayon/menu Notion ; nettoyer la carte temporaire et analyser les huit retours.
- [x] T012 Création/édition dépliées : propriétés typées, relations, type, validation explicite, refus/clavier ; ui-quality + lessons et preuve réelle.
- [x] T013 Actions canoniques et conversion réutilisée, focus/confirmations ; ui-quality + lessons et preuve réelle.
- [x] T014 Volet animé, deux icônes, ouverture depuis table ; ui-quality + lessons, revue clavier/étroit/réduction animations.
- [x] T015 Centrage replié et hover teinté entier ; ui-quality + lessons, revue clair/sombre.
- [x] T016 Contrôles ciblés, web 8082 seul, nettoyage fixtures et convergence documentée.

- [x] T001 Checkpoint sans tests et observation Notion réelle, nettoyage carte temporaire.
- [x] T002 Spécification, plan, recherche, modèle, contrats, analyse et gates UI avant code.
- [x] T003 [US1] Création inline par colonne, titre atomique, Entrée/Échap/blur, type secondaire, refus/pending sans navigation.
- [x] T004 [US1] Appliquer ui-quality + lessons et preuve visuelle/interaction réelle.
- [x] T005 [US2] Valeurs de cartes suivant visibilité/ordre, checkbox nommée, titre permanent.
- [x] T006 [US2] Appliquer ui-quality + lessons, preuve de changement/persistance par vue.
- [x] T007 [US3] Volet droit canonique, containers/blocs intégrés, propriétés et contenu autosave, pleine page/fermeture/focus, erreurs et responsive.
- [x] T008 [US3] Appliquer ui-quality + lessons, preuve manuelle bureau/étroit et contenu canonique.
- [x] T009 Survol/focus sur toute cellule onglet ; revue réelle.
- [x] T010 Types/format/build ciblés, déploiement web seul 8082, nettoyage données de revue et convergence documentée.

Preuves et limites : [validation.md](validation.md). Revue réelle conforme à
[ui-quality](../../.agents/skills/ui-quality/SKILL.md) et
[lessons](../../.agents/skills/ui-quality/lessons.md), avant ces coches.

T013/T014/T016 : complétés lors de la reprise ; icône, animations réduites et
nettoyage vérifiés le 7 octobre. T017/T018 ont une preuve réelle bureau,
clair/sombre, 320 px et des tests ciblés. T003/T012 décrivent les livraisons
historiques ; le protocole courant est celui de T017/T018.

- [x] T031 FR019/020 : appliquer ui-quality + lessons ; confirmation sans conversion préalable si contenu connu, retour de focus discret au pointeur, glissement immédiat pendant une conversion autorisée et retour au type réel sur refus ; tests ciblés de sécurité et attente.
- [x] T032 Vérifier à la main pointeur → Dossier → Échap, reprise clavier, attente/refus et motion ; clair/sombre/320 px, web 8082 seul, contrôles ciblés et preuves avant convergence.
- [x] T033 FR021 : borner la barrière de conversion aux pages ayant une autorité éditoriale à réconcilier ; tests réseau bloqué, refus destructif, activation et journal durable.
- [x] T034 FR021 : compteurs sans ouverture des contenus et alias de révision lus par références ; vérifier identités, états de reprise et atomicité.
- [x] T035 FR021 : supprimer l'hydratation d'entrées en double dans le parent des bases natives ; conserver le rendu legacy et vérifier son parcours.
- [x] T036 FR021 : appliquer ui-quality + lessons, mesurer les deux sens avant/après et vérifier sauvegarde/rechargement/confirmation à la main et avec Playwright ; contrôles ciblés, web 8082 seul et convergence documentée.

- [x] T037 FR022 : lectures de paires en lot et déchiffrement borné, propriétaires indexés ; tests ordre/identités/disponibilité et benchmark jetable.
- [x] T038 FR022 : source sélectionnée lue directement, drain d'actualisations sans publication périmée et annulation au démontage ; appliquer ui-quality + lessons, tests sources/rafales/reprise.
- [x] T039 FR022 : première page complète locale sans attente réseau ; préserver pagination serveur/partielle, diagnostics et générations avec tests ciblés.
- [x] T040 FR022 : mesurer et vérifier manuellement vues/édition/volet, bureau/320 px/clair/sombre ; parcours Playwright, contrôles ciblés, web 8082 seul et convergence avec preuves. Analyser le HAR fourni avant de conclure sur la première ouverture.
- [x] T041 FR023 : garder une étendue horizontale mesurable pour les tables vides sans fausse ligne ; appliquer ui-quality + lessons, test géométrie/défilement/ajout au clavier, vérification des tables remplies.
- [x] T042 FR023 : revue réelle vide/rempli/320 px/clair/sombre, parcours mobiles dans les runtimes requis, types/static/build et web 8082 seul, preuves avant convergence.

- [x] T043 FR003 : création canonique dès « Nouvel élément », édition existante après retour de l'identité/révision ; bouton permanent, sauvegarde avant création suivante, filtre/pagination et refus sans doublon.
- [x] T044 FR024 : ancienne passe couleur pleine réalisée ; remplacée par le système de rôles de 041 à la demande du 7 octobre. La validation de cette nouvelle apparence appartient à specs/041-content-color-system/tasks.md et validation.md.
- [x] T045 FR003/FR024 : tests ciblés, parcours Playwright et inspection visuelle clair/sombre/320 px, preuve et convergence ; environnement isolé pour préserver le fil principal.
