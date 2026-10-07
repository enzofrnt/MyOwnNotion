# Analysis before implementation

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
