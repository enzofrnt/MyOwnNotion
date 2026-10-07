# Analysis before implementation

## Reprise du passage entre crayons, 7 octobre

La preuve T024 portait sur deux colonnes différentes. Le nouveau retour révèle
un écart FR018 dans une même colonne : sur 8082, pointerdown sur le second
crayon replie le premier éditeur, déplace le crayon de 110 px vers le haut et
empêche son activation au relâchement. T025/T026 rouvrent cette convergence.
Reconnaître le crayon de la même instance dans la fermeture extérieure garde
la géométrie jusqu'au clic, sans exécuter l'action à l'appui. Les refus et les
écritures sérialisées restent dans le protocole existant. Aucun changement de
données, synchronisation, permissions ou migration ; revue réelle requise.

Convergence T025/T026 : la régression échoue avant correction puis les dix
tests carte/édition/création passent. Les événements physiques sur 8082 gardent
la cible exactement en place à l'appui, puis ouvrent la seconde carte au
relâchement ; saisie persistée après rechargement, geste annulé et clavier
vérifiés. Même résultat en clair à 320 px. Preuves et contrôles dans validation.md.

## Édition stable du 7 octobre, avant code

FR017/018 → T023 ; SC006 → T024. Le protocole automatique de FR010/016 reste
inchangé. Les mêmes contrôles et la même session couvrent cartes fermées et
dépliées ; les champs masqués s'ajoutent après les valeurs visibles. Le passage
entre crayons attend la sauvegarde et conserve les refus. Canevas §14 aligné,
ui-quality + lessons chargés, aucune migration ni nouveau stockage. Les preuves
de Notion montrent titre sans cadre et géométrie inchangée ; les mesures locales
et parcours de reprise sont requis avant convergence.

Convergence T023/T024 : mêmes positions et métriques mesurées sur le rendu réel,
propriétés directement modifiables, passage sauvegardé et refus conservé dans
les tests. 37 tests ciblés, types, Biome, build et revue clair/sombre/320 px
documentés dans validation.md ; aucune exigence orpheline ni écart UI matériel.

FR001 -> T009 ; FR002–004 -> T003/004 ; FR005 -> T005/006 ; FR006–009 -> T007/008 ; SC001–004 -> T004/006/008/010. Pas d'exigence orpheline. Canvas §14 mis à jour ; hypothèse d'ouverture automatique 037 supersédée explicitement. Aucune violation de constitution ni ambiguïté matérielle. UI gate exige preuves réelles, aucun done de code avant revue.

## Retours du 7 octobre, avant code
FR010/T012 couvre crayon et propriétés de création ; FR011/T013 actions et
conversion ; FR012/T014 animation/icônes ; FR013/T014/T015 table, centrage et
hover. FR003 remplace le blur validant par validation explicite pour les
popovers. Canevas §14 aligné ; commandes et éditeurs existants, sans migration.
Revue navigateur requise avant coches. Aucun conflit matériel identifié.

## Correction suivante du 7 octobre

FR003/010/014 → T017/018 supersèdent la validation explicite : édition
automatique sérialisée avec baseline avancée après chaque succès, fermeture
extérieure reconnaissant les événements React des portails, création atomique
sur Entrée/clic extérieur. La carte éditée reste montée dans sa colonne jusqu'à
fermeture même si le regroupement change. Présentation carte dédiée dans
ValueEditor ; choix Page/Dossier permanent dans ConvertItemControl et icônes
directionnelles partagées. Capsule crayon/menu commune. Skill ui-quality et
guide UI alignés avant code. Aucun contrat réseau ni migration. Vérifier
doubles écritures, refus, portails, regroupement, clavier, 320 px et thèmes.

## Regroupement dans les réglages

FR015/SC005 → T019/T020. Le canevas §14, 036 spec/plan et le guide UI décrivent
le même point d'entrée. GroupEditor partagé et écran group réutilisent le contrat
de présentation ; l'axe du Kanban reste obligatoire, les autres vues permettent
Aucun. Changer d'axe réinitialise seulement son ordre/repli, sans toucher aux
filtres, tris ni visibilité. Le tri ne présente plus de choix de regroupement.
Le périmètre déplace les capacités existantes : pas de sous-groupe/masquage/
couleur supplémentaire. Aucun conflit de données ou de migration identifié.

## Enregistrement discret

FR016 → T021/T022 ; canevas §14 aligné. Retrait du seul retour de succès/attente
dans les vues, sans suppression des états canoniques ni des diagnostics dans
les réglages. Conflits et refus restent visibles. Aucun changement de protocole,
persistance ou migration ; revue réelle requise avant done.
