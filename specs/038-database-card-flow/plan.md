# Implementation Plan: Parcours des cartes et volet droit

## Création immédiate et contours de colonne — 7 octobre

FR003/FR024 → T043–T045 ; canevas §14/18/19/43.6, skill ui-quality,
lessons journal et guide UI relus. Cette passe remplace le protocole historique
de brouillon de création décrit plus bas : « Nouvel élément » appelle la création
canonique existante avec Page et la valeur de colonne. L'identité retournée est
ouverte dans BoardCardEditor comme toute entrée existante, dès que sa vraie
révision est disponible. Les entrées locales complètes fournissent la reprise
si le filtre ou la pagination exclut cette identité ; aucune révision inventée.
Le bouton reste monté sous la liste, désactivé pendant la création seulement.
Son activation termine la sauvegarde courante ; pointerdown/focus sur ce bouton
ne replie pas la carte avant le clic. Une création refusée n'ajoute aucune carte
et propose une reprise dans cette même colonne. Échap ferme sans supprimer.
La passe initiale utilisait des contours pleins. La correction 041 demandée le
7 octobre la remplace par des rôles distincts : contour dérivé discret, accent
du bouton et niveaux colonne/carte/badge. Voir specs/041-content-color-system/plan.md ;
les métriques et le focus clavier sont conservés. Vérifier création répétée, données masquées,
autosave/refus/pending, thèmes et 320 px ; tests ciblés et parcours Playwright
dans un environnement isolé, sans redémarrer la pile du fil principal.

**Date**: 2026-10-06 | **Branch**: codex/notion-api-import | **Spec**: [spec.md](spec.md)

## Summary

Reprise de publication : le déplacement de propriété au clavier consomme
Échap avant la fermeture du volet. Le prédicat de dismissal de DatabaseEntryPeek
respecte la rangée de propriété en déplacement ; vérifier annulation sans
écriture, ordre conservé puis fermeture normale au second Échap. Le laboratoire
inline conserve l'ancêtre page-editor réel ; les tests mesurent le conteneur
sticky commun et utilisent le rail horizontal du corps, sans contourner les
gestes de dépôt ni élargir les tolérances. Les libellés de propriétés sont
ciblés exactement pour éviter « Nom »/« nombre ».
La fixture de flux Kanban expose seulement le titre pour vérifier son centrage
vertical, et conserve après la base un contenu plus haut que le scrollport pour
vérifier la sortie complète du sticky. Après un saut virtualisé, révéler la
dernière carte mesurée par le scroll natif ; la surface de base doit toujours
garder scrollTop à zéro. La recherche ouvre la route pleine page, dont le
contrôle de retour est distinct de celui du volet.
FR020 : mémoriser la modalité du retour de confirmation dans le sélecteur.
Un retour clavier peint le focus du bouton actif avec les tokens communs,
indépendamment de l'heuristique :focus-visible du moteur ; retour pointeur
discret conservé. Effacer cette intention au blur et au prochain geste.
Réutiliser les tests de conversion et leurs preuves réelles multi-moteur.

Canevas §14/18/19/43.6. Réutiliser création atomique, présentations de vues, EntryPanel et éditeur canonique. Pas de nouvelle dépendance, API, migration ou stockage de document.

## Technical Context

React/TypeScript strict, Bun du repo, Ariakit, LocalContentService et projections locales. CSS propriétaire `database.css`, composition dans hierarchy-explorer et contextes éditeur. Ouverture de base reste montée derrière un volet indépendant ; état de présentation transitoire.

## Constitution Check

I/IV : même propriétaire, données chiffrées locales et synchronisation existante. II/V/VIII : une feature, artefacts avant code, changements réversibles. III/VI/VII : contrôles ciblés et revue manuelle demandée ; pas de campagne exhaustive suspendue. Checkpoint 0b3157a2 créé sans tests. Pas de violation.

## Phase 0 — Research

Observation réelle de Notion : carte inline, Entrée prépare suivante, Échap annule vide, clic ouvre aperçu latéral, propriétés dans réglages de vue. Carte temporaire déplacée dans la corbeille, aucun réglage du propriétaire modifié. Recherche en lecture seule déléguée selon speckit-plan pour la réutilisation des entrées ; [research.md](research.md).

## Phase 1 — Design

- BoardView : carte dépliée commune création/édition, ValueEditor et validation typée existants ; valeurs et relations envoyées à la création atomique. Création atomique sur Entrée ou clic extérieur, sans boutons ; garde anti-double et refus conservé. Édition existante automatiquement sérialisée, baseline avancée après chaque succès ; clic extérieur/Échap termine après sauvegarde. Type permanent via conversion canonique. Champs changés via saveEntryPropertyChanges et renommage canonique.
- BoardCards : propriétés visibles de viewColumns, hors titre ; valeurs réutilisant PropertyValue, case avec nom. CSS de densité conserve cartes compactes, zones title/menu puis valeurs sous le titre.
- Le DTO de requête omet les propriétés masquées : enrichir les lignes avec les valeurs/relations canoniques de la même révision pour le mode déplié. Ne pas substituer une projection locale plus ancienne à une requête récente. Les dates instantanées utilisent un contrôle natif local puis sont normalisées avec fuseau à l'enregistrement.
- Volet : contexte explicite d'ouverture de base pour containers et blocs intégrés, état indépendant de selectedItem ; chargement entrée/source/item local, EntryPanel et WorkspacePageEditor, titre/icône canoniques. Focus retour, fermeture, pleine page, état erreur/chargement ; responsive sans modifier le scroll de la base.
- Onglets : corriger la vraie cascade et le wrapper de survol pour toute la cellule.

## UI quality gate

Suite acceptée par le propriétaire : FR019 → T029/T030. Séparateur dans le
wrapper de type, boutons 28 px au pointeur (rail 34 px), 44 px au toucher.
Un seul fond actif en pseudo-élément du fieldset glisse par transform (token
180 ms), suivant le type réel au repos et la destination demandée pendant
une conversion autorisée (raffinement T031 ci-dessous) ; le protocole canonique
de conversion reste inchangé. Texte et cibles ne bougent pas. Désactiver la
transition sous prefers-reduced-motion. Appliquer ui-quality + lessons ; revoir
les deux sens, clavier, attente/confirmation non destructive, création, thèmes
et 320 px. CSS local uniquement : contrôle statique/build et preuve navigateur.

Retouche Page/Dossier FR019 → T027/T028 : dans database.css, rail transparent
au contour fin et choix actif obtenu à partir du fond teinté hérité de la carte
et du texte du thème. Même principe pour le survol, arrondis internes adaptés
au retrait de 3 px. Conserver Button, aria-pressed, focus, cibles et protocole
de création/conversion existants. Appliquer ui-quality + lessons ; revue réelle
sur cartes grise/bleue/verte, création et édition, clair/sombre/320 px. Changement
CSS local : contrôle statique/build et revue navigateur, aucun test recopiant
les couleurs. Aucun changement de données, hors-ligne, permissions ou migration.

Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) L009/010/019/020 et [guide UI](../../docs/design/ui-system.md). Les retours autorisent ces corrections. États : vide, saisie, attente, refus, succès, volet chargé/indisponible ; menus/focus non concurrents. Chaque story possède une revue navigateur documentée avant done. Captures contenant les données privées uniquement dans work/notion-api, jamais dans les artefacts suivis.

## Validation and delivery

Reprise de publication du 7 octobre : le gate révèle que `headers` sur les
cellules du corps séparé vise une autre table. En page-flow, conserver le nom
explicite propriété/valeur et l'indice de colonne, sans cette relation HTML
invalide ; la table bornée garde ses en-têtes internes. Aligner les parcours
historiques sur le volet, le menu Actions et Grouper dans les réglages, sans
retirer leurs assertions de persistance, focus, déplacement ou navigation.
ui-quality/lessons restent applicables ; matrice complète et preuves avant push.

Types/Biome/build ciblés, tests de comportement bornés si nécessaires ; aucune matrice. Revue manuelle Notion puis 8082 (création, visibilité, volet, clavier, thème, étroit). Déployer seulement web myownnotion-notion-api, préserver API/DB et instance 8080. [quickstart.md](quickstart.md), [validation.md](validation.md).

## Post-design gate

Conception cohérente avec données canoniques et présentation déjà stockée. Aucun changement du contrat de persistance ; seules signatures UI et état transitoire changent. Analyse avant code dans analysis.md.

## Précision issue de la recherche

Retours du 7 octobre : réutiliser ConvertItemControl dans le menu, garder son dialogue monté ; actions canoniques par contexte workspace. Drawer avec sortie terminée avant démontage/focus ; double-chevron et expansion. database.css seul propriétaire du hover et centrage. Revue des huit demandes, clair/sombre/étroit selon ui-quality + lessons. Aucun nouveau contrat ni migration.

L'enregistrement des valeurs validait la définition primaire et perdait sourceId pour une source secondaire. Le volet rend cet écart matériel : résoudre la définition depuis l'appartenance stockée, conserver sourceId et refuser une source étrangère. Même commande et format, aucune migration. Ajouter une régression bornée au test de création secondaire déjà existant. Le scroller du volet porte data-editor-scrollport ; menus restent au-dessus de ce volet nonmodal, et aucun portail d'historique n'est attaché à la barre de la base.

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

## Regroupement dans les réglages de vue

FR015 → T019/T020. Réutiliser ViewSettingsPanel : rangée Grouper avec propriété
actuelle et écran group. GroupEditor partagé sélectionne les seules propriétés
compatibles, applique immédiatement la présentation existante, bloque les doubles
envois et garde une erreur/reprise locale. Le changement d'axe réinitialise seulement
l'ordre et les replis des colonnes ; les autres réglages sont conservés. Séparer ce
choix de SortGroupEditor dans le panneau et les réglages des blocs intégrés.
Retirer la toolbar et son CSS de BoardView ; conserver l'état indisponible avec
indication du point de reprise. Aucun nouveau réglage de masquage, sous-groupe ou
couleur ; aucun contrat ni migration. Appliquer ui-quality + lessons ; preuves
pleine page/intégrée, clavier, refus/pending, thèmes et 320 px avant done.

## Édition de carte sans changement de présentation

Correction T025/T026 : distinguer le crayon de la même instance Kanban des
interactions extérieures ordinaires. Les événements pointerdown/focusin sur ce
déclencheur laissent l'éditeur courant monté ; son clic sémantique existant
sauvegarde puis bascule. Aucun déclenchement sur pointerdown, délai arbitraire
ou changement de persistance. Vérifier le geste réel appui/relâchement : la
carte suivante ne doit pas remonter sous le pointeur avant le clic. Appliquer
ui-quality + lessons, annulation hors cible, clavier et brouillon en attente.

FR017/018 → T023/T024. Garder BoardCardEditor monté sur chaque carte interactive :
la même session sérialise les propriétés visibles au repos et celles révélées par
le crayon. Réutiliser ValueEditor/EntryChoicePicker, avec présentation compacte
sans icône ajoutée aux champs déjà visibles. Le titre seul ouvre le volet au repos ;
en édition, un texte éditable sans bordure reprend les mêmes métriques et place
le curseur en fin de texte. Conserver les champs visibles en premier puis ajouter
les autres, afin de ne pas déplacer les contrôles existants. Une référence de
session permet au passage entre crayons d'attendre la sauvegarde ; un refus
empêche ce passage et garde la reprise locale. Rafraîchir les champs non modifiés
depuis la projection canonique, sans écraser les brouillons ou écritures en cours.
Capsule de 26 px au pointeur fin, icônes de 16 px ; cible 44 px au tactile.
Appliquer ui-quality + lessons et le guide UI. Observer NSY103/Examen/crayon
dans Notion, mesurer le rendu local avant/après et vérifier sauvegarde, passage,
refus, clavier, thèmes et largeur étroite. Aucun contrat réseau ni migration.

## Enregistrement discret des entrées

FR016 → T021/T022. Les vues BoardView, GalleryView et ListView n'affichent
le badge database-sync que pour un conflit. Retirer la copie et le style
pending inutilisés ; conserver les commandes d'édition automatique et leurs
erreurs/reprises. Aucun changement de données, hors-ligne, synchronisation,
permissions ou migration. Appliquer ui-quality + lessons ; régression bornée
sur les trois vues (pending discret, conflit visible), puis modification réelle
d'une propriété sur 8082, rechargement et restitution de la valeur initiale.

## Conversion réactive et retour de confirmation

FR019/020 → T031/T032 : ouvrir la confirmation directement depuis le signal
positif holdsContent de la projection (carte/arbre), sans lancer une conversion
exploratoire qui attend le journal de page et la synchronisation. Conserver la
vérification canonique avant écriture, même avec un signal absent ou périmé.
Après succès, rafraîchir uniquement l'élément converti ; aucun rafraîchissement
de l'arbre après le refus de confirmation. Le sélecteur expose une destination
transitoire busy pour animer immédiatement le fond, indépendamment de la durée
de sauvegarde ; aria-pressed reste canonique et le fond revient en cas de refus.
Annuler une confirmation ouverte au pointeur rend le focus sans contour de
seconde sélection ; une nouvelle interaction clavier rétablit le focus visible.
Aucun effacement global des styles de focus. Appliquer ui-quality + lessons :
tests bornés de confirmation, attente/refus, anti-double et retour clavier ;
gestes réels Échap/Tab, thèmes et 320 px avant convergence. Aucun nouveau contrat,
stockage, migration ou changement du journal.

## Durée réelle des conversions et sauvegardes

FR021 → T033–T036 ; canevas §43.1 et §18/19, ui-quality et lessons pour le parcours.
Mesurer une carte temporaire dans la vraie base avant/après, du déclenchement
au type réel avec contrôle disponible. Ne pas présenter la durée du slider
comme celle de la conversion. Baseline clavier sur 8082 : Page → Dossier
1 636/1 574/1 463 ms ; Dossier → Page 467/784/828 ms, lecture DOM externe
incluse. Trois essais par sens, conditions locales, aucun benchmark général.

Dans LocalContentService, éviter la barrière réseau uniquement si aucune
ouverture, reconciler, ligne opérationnelle, update ou branche durable n'existe
pour la page. Conserver le protocole complet dans les autres cas, ainsi que
les gardes locales/serveur et le flush de carte. Compter les envois via l'index
de statut et les conflits via leurs identités, sans ouvrir leurs contenus.
Dans applyLocalMutation, charger seulement les alias des références de révision
de la commande, en conservant le remappage existant et la transaction atomique.
Dans le parent de la base native, éviter la seconde hydratation des entrées
déjà détenue par DatabaseContainerPage ; garder le chemin legacy.

Aucune migration, dépendance, nouvel état UI ou modification des règles de
synchronisation. Tests bornés de durabilité/réseau bloqué, garde de contenu,
activation/journal/offline, compteurs et alias ; types/static/build, parcours
Playwright et preuve manuelle desktop/320 px, déploiement web 8082 seul.

## Lecture et actualisation des bases

FR022 → T037–T040 ; canevas §14/18/19/43.1, ui-quality + lessons et guide UI.
Changement borné aux lectures de projection des bases existantes : aucune
écriture, migration, chiffrement, règle de sync ou permission modifiée.
Dans LocalDatabaseRepository.listEntries, lire les paires sélectionnées en
bulkGet puis déchiffrer par lots ordonnés de 64, hors transaction IndexedDB.
Préserver lignes synthétiques, disponibilité et filtres ; indexer les propriétaires
de sources pour listDatabases sans modifier la priorité des présentations.
Dans loadView, préférer la lecture de source par identité avec fallback legacy ;
paralléliser les lectures indépendantes et réutiliser le conteneur déjà ouvert.
Les deux surfaces drainent une seule actualisation à la fois, relancent une fois
si notifiées pendant une lecture et ne publient que le dernier tour ; await
refresh attend toujours ce tour. Annuler la publication après démontage ou
changement d'identité. Conserver toutes les notifications pour cette passe ;
un filtrage agressif risquerait de manquer des déplacements entrants.
DatabaseViewService retourne la première page complète locale avant le réseau,
sans appliquer cette règle à un curseur serveur ni à une couverture partielle.

États inchangés : chargement initial, rempli/vide, source/vue absente, erreur
avec reprise, pending/conflict et édition active. Vérifier source secondaire,
legacy, rafales, lecture suspendue et pagination, puis les gestes réels de vue,
crayon et volet en bureau/320 px/clair/sombre. Mesures avant/après sur 8082 et
fixture jetable scellée pour distinguer transport navigateur et coût de lecture.
Le HAR fourni le 7 octobre est analysé séparément, sans secrets ou contenu dans
les preuves ; ses conclusions détermineront tout correctif de première ouverture.

## Table vide et accès aux commandes sur mobile

FR023 → T041/T042 ; maintenance révélée par T040, ui-quality + lessons chargés.
Reproduction réelle à 320 px sur une base intégrée vide : table de largeur
328 px dans un rail de 304 px, corps de hauteur nulle et scrollWidth 304 px.
Le rectangle vide ne contribue donc pas à l'étendue défilante ; le mouvement
de l'en-tête piloté par ce corps ne peut pas révéler ses commandes. Conserver
une étendue non nulle minimale dans le corps en page-flow, sans fausse entrée
ni changement des cellules remplies. Une première hauteur CSS de table suffit
dans Chromium mais reste ignorée sur une table vide dans WebKit : utiliser
un élément de géométrie `aria-hidden`, large comme la table et haut d'un pixel,
uniquement quand aucune ligne complète n'est rendue. Il ne représente aucune
entrée et disparaît dès que les lignes existent. Aucune écriture, contrat ou migration.
Vérifier à la main geste horizontal et commandes au clavier, vide/rempli et
320 px/clair/sombre. Les tests de préparation mobiles emploient le focus clavier
pour révéler le bouton puis son clic normal : WebKit mobile ne supporte pas
Playwright mouse.wheel ; aucune activation forcée ou mutation de scroll via JS.
Parcours de composition/sync inchangé après préparation, plus test de géométrie
et défilement réel sur table vide. Rebuild et web 8082 seul si la correction
produit est validée ; conserver API/DB/8080.
