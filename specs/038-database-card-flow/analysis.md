# Analysis before implementation

La demande ultérieure du 7 octobre remplace les contours pleins par le système
de rôles de [041](../041-content-color-system/spec.md). Les preuves ci-dessous
restent historiques pour les interactions et leur apparence au moment du relevé.

## Bouton permanent et couleur pleine — conversation latérale, 7 octobre

FR003/FR024 et canevas §14 alignés avant code ; T043–T045 et plan UI bornés.
La nouvelle demande remplace explicitement le brouillon transitoire historique :
activation = création canonique puis édition, sans nouvelle route ni migration.
BoardCreateCard devient une commande permanente ; BoardView attend la vraie
identité/révision et réutilise l'éditeur existant. Le passage au bouton de création
fait partie du protocole de sauvegarde/switch, au même titre que le crayon suivant.
Les entrées locales complètes couvrent les créations hors filtre/pagination.
Une garde identifiée par requête évite qu'une ancienne création libère l'attente
d'une nouvelle vue. Les couleurs proviennent directement de la palette commune,
avec contraste clair/sombre déjà prévu ; aucune opacité sur le contrôle en attente.
Portée de validation : composants, autosave, création/conversion canonique,
hors ligne, persistance/rechargement et couleurs aux deux largeurs. Les sources
et changements du fil principal sont conservés ; aucun commit, push ni
redémarrage de ses instances. Les observations de validation figurent dans
validation.md, sans réutiliser les preuves historiques comme preuve de cette passe.

## Lecture des bases et première ouverture, 7 octobre

FR022 → T037–T040 répond à l'autorisation d'optimisations supplémentaires.
Trois audits en lecture seule convergent : listEntries séquentialise I/O et
décryptage ; loadView ouvre l'inventaire global ; les surfaces peuvent lancer
des lectures concurrentes ; le service legacy attend un résultat réseau qu'il
ignore ensuite si la couverture locale est complète. Les gardes de curseur,
disponibilité, identité et démontage sont explicites dans le plan. Le canevas
§43.1 permet l'affichage local ; aucun changement de sync ou de sécurité.
Les tâches et preuves UI restent ouvertes. L'analyse du HAR ajouté ensuite
est indépendante des données de l'instance ; ne jamais publier ses secrets.

## Affinage du sélecteur accepté, 7 octobre

Le propriétaire valide le rendu précédent et demande séparation, compacité et
glissement. FR019 → T029/T030 réutilise le fieldset et ses deux aria-pressed :
un fond unique animé par transform évite de déplacer les boutons ou de simuler
une conversion qui n'a pas abouti. Confirmation/refus/attente restent canoniques,
réduction des animations et cible tactile explicites. Aucun nouveau stockage,
contrat, permission ou migration. ui-quality + lessons appliqués avant code ;
preuve réelle requise, pas de test recopiant une valeur CSS.

Convergence T029/T030 : rail 34 px et boutons 28 px mesurés, séparateur inspecté,
fond glissant observé à plusieurs positions intermédiaires avec libellés fixes.
Clavier, deux sens, confirmation conservant Page et réduction des animations
vérifiés ; rendu clair/sombre à 320 px dans validation.md. CSS/build/diff-check
réussis, protocole canonique inchangé, proposition prête pour revue propriétaire.

## Sélecteur Page/Dossier, 7 octobre

FR019 → T027/T028 précise la présentation de FR014 sans changer son protocole.
Le fond surface-sunken donne #151514 dans une carte grise #30302d : le rail
devient une rupture noire. Un rail transparent et un choix actif teinté par
le contexte conservent la hiérarchie du contenu. database.css possède les deux
usages existants (création et conversion), sans nouvelle primitive ni stockage.
ui-quality + lessons lus ; focus, survol, arrondis et deux thèmes à vérifier
réellement avant done. Aucune contradiction avec le canevas §14.

Convergence T027/T028 : rail transparent, choix actif et survol teintés observés
sur trois couleurs de carte ; mêmes dimensions qu'avant. Focus clavier visible,
création Page/Dossier sans entrée accidentelle et rendu clair/sombre à 320 px
vérifiés sur 8082. Contrôle CSS/build réussis ; preuves dans validation.md.
La proposition visuelle reste soumise au retour du propriétaire.

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

## Latence de conversion et contour après Échap, avant code

Reproduit sur 8082 : après une activation au pointeur, Échap rend le focus à
Dossier avec un outline 1 px alors que Page reste sélectionné. La confirmation
attend la commande complète (réconciliation du journal et synchronisation), puis
un rafraîchissement complet de l'arbre malgré le refus sans écriture. FR019/020
et T031/T032 corrigent cette latence côté présentation ; la frontière destructive
canonique reste inchangée. Un signal positif permet d'ouvrir la confirmation,
jamais d'autoriser la suppression. Le fond en attente représente la destination
demandée ; aria-pressed représente le type réellement appliqué. Le focus clavier
reste requis. ui-quality + lessons chargés, cohérence canevas §14/18/19.

Convergence T031/T032 : 14 tests bornés et le parcours Playwright ciblé passent.
Pointeur/Échap sans contour résiduel, clavier visible, demandes dans les deux
sens, réduction des animations et clair/sombre/320 px observés sur 8082. La
question ne lance aucune conversion ; les gardes canoniques demeurent en place.
Preuves et limites consignées dans validation.md, pas d'écart UI matériel restant
sur cette correction. Les fixtures ont été retirées ; données existantes intactes.

## Optimisation de durée réelle — 7 octobre

Les critères FR021/T033–T036 raffinent §43.1 du canevas sans changer la frontière
de destruction de 004 ni la durabilité locale. Lecture du service et deux audits
indépendants : barrière réseau inconditionnelle sur pages sans journal, compteur
ouvrant des payloads inutiles, lecture globale des alias et hydratation dupliquée
des entrées natives. Garder le flush, les gardes de contenu et la réconciliation
des autorités éditoriales existantes. Aucun écart constitution/canevas relevé
avant implémentation ; les tâches restent ouvertes jusqu'aux preuves réelles.

Convergence T033–T036 : les 80 tests Web, 172 tests client-core et cinq parcours
Chromium ciblés passent. Le cas de réseau maintenu bloqué prouve le succès local
du chemin rapide ; les cas de journal fermé, update, branche, activation et
reconciler en cours gardent la barrière. Compteurs de conflits/récupération et
remappage causal restent identiques, avec rollback en cas de quota. Revue manuelle
sur 8082 : médiane Page → Dossier de 1 574 à 792 ms sur la même carte sans journal,
propriété persistée après conversion/rechargement, confirmation/annulation et
clair/sombre/320 px. Aucun écart UI matériel ; limites de mesure et preuves dans
validation.md. La fixture seule a été mise à la corbeille, aucune entrée existante
n'a été convertie. Aucun changement de contrat, format, chiffrement ou migration.

## Lecture des bases et table vide

FR022/T037–T040 raffinent le canevas §14/18/19/43.1 : lecture de source par
identité, lot ordonné hors transaction, drain d'actualisation et première page
complète locale. Ordre, identités, diagnostics et curseurs restent obligatoires.
Le HAR et la compression sélective relèvent de 039, avec preuves distinctes.

La validation mobile révèle une maintenance FR023/T041–T042 : corps de table
vide à hauteur nulle, scrollWidth limité à clientWidth malgré une table plus
large. L'en-tête ne peut pas défiler pour révéler les commandes. Une étendue
non nulle minimale sans fausse ligne corrige cette composition, sans migration
ni changement des contrats. Les tâches UI restent ouvertes jusqu'aux preuves
réelles et parcours requis ; aucun contournement de clic n'est accepté.

Convergence T037–T042 : 64 tests client-core, 82 tests Web puis 23 tests de
table/viewport passent. Neuf parcours Chromium desktop valident bases, sources,
bloc lié, activation/cancel, conversion, composition et pagination ; les sources
et gestes pendant mises à jour distantes sont aussi vérifiés sur les quatre
autres profils, et le parcours de composition/table vide repasse sur les cinq
moteurs/viewport requis avec le code final. Corps vide de hauteur positive et
étendue horizontale, zéro fausse ligne, premier contenu et brouillons conservés.
WebKit requiert une géométrie séparée : la seule hauteur de table vide reste
ignorée par ce moteur. Aucun clic forcé ni garde de build/sync contourné.

Revue réelle 8082 : cartes/volet/édition et clair/sombre/320 px ; défilement et
commande d'une table vide, table remplie et retour au Kanban sans donnée existante
modifiée. Benchmark local 1 000 entrées 92,45 → 24,61 ms, sans extrapolation au
temps complet d'ouverture ; petit Kanban chaud sans gain significatif mesuré.
HAR et compression restent une preuve séparée dans 039. Types, format, builds,
prérequis et liens vérifiés ; web 8082 seul déployé, API/DB/8080 conservés. Preuves,
runs périmés/interrompus et limites dans validation.md, aucun écart UI matériel
restant sur ce périmètre. Les tâches de cette maintenance peuvent être closes.
