# Implementation Plan: Revue complète de l’application

**Branch**: `codex/033-app-ui-review` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

Inventorier composants montés/conditionnels, étendre le lab avec leurs vrais
rendus sur fixtures, corriger les défauts et consolider `ui/primitives/`.
Canevas §§4, 7–22, 24, 26–33, 38–39, 43.4–43.6, 46. Sources :
[ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md),
[guide](../../docs/design/ui-system.md).

## Technical Context

TypeScript strict/Bun 1.4.2/React/Ariakit/BlockNote existants. Aucun framework
ou dépendance ajouté. Web et renderer desktop partagé, 320/1280 clair/sombre.
Aucune migration/contrat serveur/protocole ni réinitialisation des données.
Primitives gardent leurs props et focus. Fixtures mémoire et APIs locales
injectées dans le lab si nécessaires ; adapters de production conservés.

## Constitution Check

I/IV : données/chiffrement/hors ligne/permissions conservés. II/VIII : dossier
unique lié au canevas. V : système existant, abstraction seulement répétée.
VI : clic sémantique/labels/focus/clavier/tactile. VII : Bun et vérification
types/lint/tests/build. III : le propriétaire réactive la validation automatisée
complète et autorise push/PR le 2026-10-03. Toutes les gates de docs/development.md
s’appliquent avant chaque push, puis la CI est suivie jusqu’au succès.

## Phase 0 — Research

Inventaire source et rendu des familles/contrôles ; comparer à 032. Sources
locales suffisantes, aucune inconnue externe nécessitant délégation.
Fixtures réelles pour états rares ; pas de hack DOM/React ou données privées.

## Phase 1 — Design et états

Rempli/vide, chargement/refresh, erreur/reprise, disabled/busy, overlays, texte
long et clavier. Un propriétaire CSS par domaine. Communs existants :
Button/Field/Status/Skeleton/Dialog/Drawer/Menu/Popover. Compléter au besoin
section, scroll local et tableau de lecture. Conserver tableaux métier et
éditeur. Chaque correction nécessite preuve du rendu avant tâche terminée.

## Project Structure

```text
specs/033-app-ui-review/{spec,plan,research,data-model,tasks,verification}.md
specs/033-app-ui-review/{contracts/,checklists/,assets/}
apps/web/src/ui/{primitives/,ui-lab*}
apps/web/src/features/{sync,reconciliation,history,files,databases,editor,...}/
apps/web/tests/
docs/design/ui-system.md
```

## Vérification

Revue navigateur des familles courantes et fixtures des états rares, thèmes
et largeurs. Captures/mesures dans verification.md. Tests comportementaux
pertinents, types/lint/build ; aucun test recopiant CSS. Instance HMR conservée.

## Validation automatisée et publication — 2026-10-03

La seconde tentative révèle un contraste insuffisant du texte destructif sur
le fond neutre de survol clair (T051). La variante `danger-text` claire devient
`#A94338` : rapports 5,06 sur `surface-hover` et 4,58 sur `surface-active` ;
l'accent de base et la palette de propriétés ne changent pas. L'audit du dialogue
inclut son état de survol réel et conserve une capture, selon ui-quality/lessons.
Le parcours de confidentialité réutilise la création de propriété partagée,
qui ferme le panneau avant l'action suivante ; aucun contrôle de contenu privé
n'est retiré.

T052 traite les écarts des gates de sécurité. Les liens symboliques Git sont
lus comme leur chemin stocké, sans suivre les données non suivies d'une cible ;
les fichiers `.agents/` restent scannés séparément. Les tests couvrent fichier,
lien de dossier, cible externe, borne de taille et erreur de lecture. Les
correctifs minimaux de [Fastify](https://github.com/advisories/GHSA-667r-xxjv-c9mm),
[Busboy](https://github.com/advisories/GHSA-xjh9-v7x6-24jw),
[gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j),
[brace-expansion](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[fast-uri](https://github.com/advisories/GHSA-qw65-cvwx-89v3) et
[Undici](https://github.com/advisories/GHSA-w293-vg96-wgc3) sont résolus par Bun
dans leurs majeures existantes, avec des overrides limités aux majeures affectées.
Les règles, budgets et seuils de sécurité restent inchangés. Le scan d'image
utilise Trivy 0.70.0, défaut de l'action CI épinglée, et sa base du jour.

T053 traite l'ouverture intermittente du formulaire pendant la création d'une
base. Le statut d'actualisation placé avant le tableau pouvait déplacer une
action entre appui et relâchement. Il suit désormais la vue et la pagination ;
la présentation au repos reste identique. Le parcours réel observe la connexion
du bouton et son déplacement durant le clic, puis conserve les garanties du
formulaire (appui, annulation et activation clavier). Rejeux répétés sur Firefox
Linux et Chromium, selon ui-quality et lessons, sans attente artificielle de
synchronisation ni clic forcé.

Sauvegarde demandée : commit 3ac40b2e. Le report des E2E est levé. Remettre les
tests en cohérence avec FR-009/012/017–021 et les améliorations du propriétaire
(configuration directe et catalogue de symboles partagé), sans restaurer les
anciens boutons ni modifier l’UI pour satisfaire des assertions obsolètes.
Appliquer ui-quality et lessons.md aux preuves de non-régression visuelle.

Les tests de sauvegarde attendent une écriture réellement observable avant la
file de synchronisation ; les tests de fichiers passent par les blocs de
l’éditeur. Ajouter les parcours manquants de configuration, choix d’icône,
réordonnancement/annulation et preview native dans un éditeur actif alors qu’un
autre onglet est masqué. Les tests unitaires couvrent concurrence, erreurs et
reprise ; les E2E couvrent persistance/rechargement et interactions réelles.

Exécuter la matrice locale isolée : Chromium desktop/mobile sur l’hôte,
Firefox et WebKit desktop/mobile dans les conteneurs Linux documentés sur macOS.
Chaque projet a sa base, ses ports, fichiers et clés jetables ; ne pas réinitialiser
l’instance myownnotion-ui-dev. Corriger les échecs pertinents, revoir les captures
avant toute actualisation de référence, puis exécuter checks:local sur le commit
publié. Ouvrir/attacher la PR, inspecter les logs de sa CI et répéter les
corrections/gates avant chaque nouveau push. Aucune fusion automatique.

## Retours du propriétaire — 2026-10-03

FR-009/010 affinent le canevas §§11.2, 12 et 15. Constitution et périmètre V1
restent inchangés ; specs 005 et 017 sont alignées avec ce retour. Les placements
de stockage restent compatibles et aucune migration ou suppression historique
n'est requise. Le skill ui-quality et ses leçons L-002, L-005, L-007, L-009/010
guident la correction.

Calculer une projection partagée des pièces jointes depuis les documents locaux
des pages avec les fonctions de domaine existantes. La sidebar consomme les
mêmes fichiers pour le panneau ; les notifications durables de
page et de métadonnées mettent à jour les deux sans liste serveur indépendante.
Le panneau reste une surface d'inspection : aperçu, usages, remplacement et
suppression globale confirmée, sans import ni retrait de placement indépendant.
Ne pas présenter une page sans document local comme une liste vide certaine.

Faire participer les actions révélées au layout de la ligne afin que le titre
utilise leur largeur intrinsèque, sans réserve estimée ni variable CSS héritée
depuis un descendant. Conserver les contrôles montés, leurs animations et le
rectangle de ligne. Réduire le retrait de la liste et utiliser AppIcon paperclip.

États et preuves : fichiers imbriqués/répétés, suppression de bloc, absence de
contenu, noms longs, vide, échec des usages, groupe ouvert/fermé, clavier/Échap,
clair/sombre et 320/1280 px. Tests ciblés sur la projection et le composant,
revue réelle et captures avant clôture ; pas d'E2E ni de reset de données.

Retour complémentaire : supprimer les deux compteurs et maintenir toutes les
actions de la ligne visibles pendant l'ouverture des pièces jointes. Les
mesures navigateur avant correction montrent 169 ms de script à la fermeture
et 79 ms à l'ouverture (une observation en dev, pas un benchmark). Les callbacks
de création recréés à chaque rendu et le Provider de contexte instable traversent
la frontière memo de l'éditeur. Ajouter une composition memo qui lie une fois
les commandes au parent, et stabiliser le contexte de l'éditeur. Ne pas retirer
ses sessions durables ni l'animation/reprise des coins de CollapsibleRegion.
Vérifier les commandes liées à la bonne page, mise à jour des données, focus,
et comparer le travail du navigateur ; pas d'E2E avant demande explicite.

La première stabilisation laisse environ 161 ms de script à la fermeture :
elle ne résout pas le coût principal. L'état des pièces jointes est actuellement
porté par HierarchyExplorer, ce qui recalcule tout l'arbre et ses menus à chaque
bascule. Le descendre dans une composition locale sans DOM supplémentaire,
autour de la ligne concernée. Fermer à la perte de sélection, conserver le
sous-arbre indépendant de cette bascule et les transitions existantes. Vérifier
que l'ouverture ne rerend ni le parent ni ses autres lignes/éditeurs.

Le profil du départ de page identifie aussi l'initialisation du sélecteur emoji
fermé et les contrôles des menus cachés. Utiliser `unmountOnHide` d'Ariakit
sur ces deux surfaces précises, sans modifier les primitives globales. Leurs
déclencheurs restent montés ; vérifier ouverture, fermeture/focus et callbacks
après remontage. Aucun contenu édité ni état métier ne dépend de ces overlays.
Les commandes du menu de navigation sont composées dans un enfant monté par
MenuContent pour éviter de construire les contrôles cachés à chaque rendu.
Mesures finales et limites consignées dans verification.md : bascule locale
22–34 ms de script observés, contre 79–169 ms avant ; navigation totale reste
plus coûteuse que la simple bascule, tout en évitant un second rendu global
pour fermer les pièces jointes. Aucun objectif de benchmark ajouté.

## Clarification suivante — compteurs et repère de dépôt

Le propriétaire précise que les compteurs sont trop gros, et souhaite les
conserver. Rétablir les compteurs issus des références locales dédoublonnées,
avec badges petits et métriques stables dans navigation.css (ui-quality et
lessons.md). Ne pas afficher une quantité certaine sans document disponible.
Le retour FR-011 remplace l'interprétation précédente « aucun compteur ».

Pour FR-012, le DOM réel présente un premier éditeur d'onglet masqué de largeur
0, avant l'éditeur actif de largeur 688 px. L'alignement global du dropcursor
lit actuellement ce premier éditeur et peut ramener le trait à largeur 0.
Résoudre sa colonne depuis `activeReorder.editor.prosemirrorView.dom` et
limiter la recherche du curseur à son offsetParent. Conserver le plugin,
le snapping au bord des blocs/tableaux et le dépôt opérationnel existants ;
configurer la couleur avec le token d'accent. État de preview hors du DOM
ProseMirror, aucune nouvelle mutation métier ni migration. Tester plusieurs
éditeurs (premier masqué), colonne/tableau et nettoyage, puis revoir le drag
réel sur fixture mémoire. E2E toujours différés à la demande du propriétaire.

## Ouverture des PJ d'une autre page — correction du parcours

Retour propriétaire : le lag persiste quand le trombone vise une autre page.
La mesure réelle depuis Produit vers les PJ de Livraison consomme 304 ms de
script et 393 ms de tâches cumulées ; le clic appelle `selectItemById`, ce qui
active une autre page avant son ouverture locale. Le panneau vide suffit à
reproduire : le coût vient de la navigation, pas de la récupération de fichiers.

Retirer cette sélection du clic PJ. `TreeAttachmentDisclosure` conserve l'état
local indépendamment de la ligne sélectionnée et le rattache à l'identité de
la vue active (page/dossier ou graphe) uniquement pour fermer lors d'une vraie
navigation. Garder les éditeurs, onglets et callbacks inchangés. Plusieurs
inspections de ligne peuvent coexister ; aucune liste serveur ni migration.
Ne monter les détails/actions secondaires d'un fichier compact qu'à l'ouverture
de son popover (`unmountOnHide` local), comme pour les menus de navigation :
une liste n'a pas à initialiser tous ses dialogues de suppression/remplacement.
Vérifier ouverture des détails, Échap et retour du focus sans action destructive.

Appliquer ui-quality et lessons.md (L-002/003/005/009/012/013) : la ligne inspectée
garde son trombone, « + » et menu, une surface sobre et sa jonction/fermeture
existante, même sans sélection. Tester la ligne non active, indépendance du
parent/éditeur, fermeture au changement de vue et réouverture. Rejouer exactement
le parcours réel, mesurer les deux sens et capturer page active + panneau autre
page, vide/rempli ; thèmes/largeur étroite sur la composition mémoire. Aucun E2E.

## Poignée de bloc — proportions et retrait

Appliquer ui-quality et lessons.md (L-009/012/013) à la poignée existante,
avec un unique propriétaire dans editor.css. Le dessin AppIcon GripVertical
reste inchangé : ses points occupent huit unités de moins horizontalement
que verticalement dans un viewBox de 24 unités. Retrancher un tiers de la
taille de l'icône à la largeur du bouton garde les quatre marges peintes
égales et la hauteur actuelle de 32 px. Un padding de groupe de 4 px
sépare la poignée de la colonne sans toucher au DOM éditorial.
La demande explicite de conserver le retrait supérieur actuel prime sur
la cible carrée générique : garder la hauteur de 32 px au pointeur et la
hauteur de 44 px déjà appliquée au tactile. La largeur est déduite de cette
hauteur, sans agrandir ni déformer le dessin.
Mesurer les points, le bouton et le texte dans la vraie page ; vérifier
survol/menu/clavier, thèmes et largeur étroite sur l'éditeur mémoire.
Aucun changement de données, de drag, de migration ou d'E2E.

## Boutons de bloc — alignement sur la première ligne

ui-quality + lessons.md (L-009/012/013), canevas §13 et 017 FR-012.
Remplacer les offsets de titres recopiés depuis BlockNote par une mesure
en lecture seule de la première portion de texte de `.bn-inline-content`
du bloc ancré. Le middleware du BlockPopover place le centre vertical du
groupe sur cette ligne, avec sa hauteur réelle (pointeur/tactile).
Ne pas centrer sur toute la hauteur d'un titre long ni écrire dans le DOM
ProseMirror. Pour un bloc textuel vide, utiliser son début et son interligne
calculé ; les blocs spécialisés sans contenu inline gardent leur placement.
Tests ciblés de géométrie et preuve visuelle sur le titre réel, puis titres
de niveaux 1–4, titre long/vide et paragraphe dans la fixture mémoire.
Revoir clair/sombre et largeur étroite. Pas d'E2E ni de modification des
données du propriétaire ; conserver forme et retrait déjà corrigés.

## Retour — pages d'entrée et prise de colonne

FR-015/016 affinent le canevas §14, les specs 029/017 et le guide UI.
Appliquer ui-quality + lessons L-009/010 : database.css possède les propriétés
et la prise ; workspace.css possède l'alignement de la composition de page.
Le fond gris mesuré au survol provient de compatibility.css (bouton natif).
Définir explicitement l'état transparent de cette prise sans réduire sa cible.

Réutiliser PageTitleEditor et workspace-page-canvas pour l'entrée canonique.
EntryPanel reçoit un slot d'en-tête, conserve le contrat de sauvegarde,
projection et brouillons. Réutiliser le menu de choix/pastilles des cellules
pour les brouillons de propriétés ; champs natifs pour texte, nombre, date,
case à cocher ; relations dans un menu compact avec pages nommées.
Pas de nouveau modèle, API, commentaire ou migration.
Conserver les groupes de rôles de tâche accessibles sans doublon visuel.

États : valeurs remplies/vides, propriété longue, plusieurs options, données
indisponibles, validation/échec/sauvegarde en cours/succès. Preuves réelle et
fixture mémoire, thèmes/320/1280 px, menu au clavier et focus de retour.
Tests ciblés de brouillon/sauvegarde et partage du contrôle, types/lint/build.
Aucun E2E, reset ou écriture de données utilisateur pour la vérification.

La preuve étroite a révélé un débordement de la liste invisible de mesure du
chemin : la contenir, conserver ses segments intrinsèques, et borner les liens
visibles à leur segment. Le lab ne doit pas modifier les titres du document :
restreindre sa règle de h2 aux titres de section directs. Ces corrections
préservent les composants réels au lieu de masquer un défaut dans la fixture.

## Retour — interactions des propriétés d’entrée

FR-017…019, canevas §14 et 029 FR-011/015. Appliquer ui-quality et lessons
L-009/010/013/016/017. Notion observé dans la page fournie : menu contextuel
Renommer/Modifier/Dupliquer/Supprimer, éditeur nom/type/options, sélecteur
avec recherche et création d’option. Pas de nouvelles capacités IA/commentaire.

EntryPanel utilise une file de sauvegarde locale avec debounce, flush au blur,
Entrée et départ ; envoie seulement les propriétés modifiées, avec leur base
pour détecter un conflit réel sans écraser les autres champs. Une nouvelle
saisie pendant une écriture est traitée ensuite ; échec conserve le brouillon.
Réutiliser les mutations de révision/outbox chiffrées et leurs protections.
Configuration partagée par source, édition via patchs de définition sérialisés
qui conservent les présentations. Réutiliser prévisualisation d’impact et
confirmation preserve-incompatible pour suppression/changement de type.
Menus Ariakit, palette/pastilles existantes, poignée AppIcon drag et dnd-kit
avec capteurs pointeur/clavier ; persister positionKey au dépôt uniquement.
Les groupes sémantiques de tâche n’imposent plus un ordre visuel distinct.

États : repos/saisie/enregistrement/erreur-reprise, valeurs vides et choix
multiples, renommage/type/options, confirmation destructive, drag/annulation,
320/1280 clair/sombre/clavier/tactile. Tests ciblés file, fusion, schéma et
interactions ; preuves navigateur sur fixtures mémoire et lecture page réelle.
E2E toujours différés par instruction du propriétaire, pas de reset ni push.

## Retour — icônes des propriétés

FR-020, canevas §14 et 029 : appliquer ui-quality + lessons L-009/010/013/016.
La marque appartient au schéma de la source, pas à la présentation d'une vue.
Ajouter `icon?: string | null` à DatabasePropertyBase et au contrat TypeBox,
avec le même identifiant borné que les icônes de vue. Anciennes définitions
sans champ acceptées ; aucun reset/migration SQL : c'est une extension de la
révision JSON chiffrée déjà exportée/synchronisée. Métadonnée sans impact de
conversion ; le schéma conserve les identités et valeurs.

Extraire le contenu du sélecteur de vues, réutiliser son catalogue et CSS.
Un PropertyIconPicker partagé équipe la configuration compacte des entrées
et les listes de propriétés des réglages de base (panneau de vue et
configuration du schéma déjà accessible). Les mutations de source
existantes enregistrent immédiatement le choix ou null. DatabasePropertyIcon
rend la marque personnalisée ou le symbole de type ; le type ne dépend pas
de la marque. Les labels qui n'avaient pas de symbole n'en ajoutent un que
pour une marque choisie. Conserver la marque dans toute conversion de type.

États : sans marque/personnalisée/inconnue, recherche vide, suppression du
choix, écriture/erreur, menu imbriqué et focus de retour. Vérifier la vraie
composition en mémoire aux deux thèmes/320/1280 et cibles tactiles ; domaine,
contrat et tests d'interaction ciblés. Les E2E restent différés.

## Retour — menu au clic et champ de recherche composé

FR-018/021, canevas §§14/43.4 : le clic normal utilise le même menu d'actions
que le clic droit et Maj+F10 ; la configuration reste accessible par ses actions.
Retour du focus au libellé après Échap. Appliquer ui-quality et lessons L-009/010 :
la recherche avait un outline propre, alors que les jetons vivaient à côté.
Ajouter `InputSurface` autour de `NativeInput` pour les compositions avec icône
ou jetons : une seule bordure/focus discret, contrôle interne sans chrome natif,
densité compacte et cible tactile commune. Réutiliser dans le choix d'entrée,
la recherche d'icônes et la recherche de propriétés ; retirer leurs anciens
styles de champ. Exclure NativeInput de la couche de compatibilité historique.
La croix devient le suffixe de la même OptionPill, sans nouvelle palette.
Retirer une valeur rend le focus à la recherche, sans modifier le schéma.
Pas de nouvelle persistance/migration : files et protections existantes conservées.

États : clic/clic droit/clavier/tactile, vide/rempli/multiple/long/sans résultat,
retrait puis saisie, création et erreur existantes ; thèmes clair/sombre,
320/1280 px. Tests ciblés de parcours et preuves sur fixture mémoire ; page
réelle uniquement en lecture. Aucun E2E, reset ni push à cette étape.

La convergence automatisée révèle aussi que le nouveau panneau de visibilité a perdu les actions de déplacement des colonnes (009 FR-018). T046 les rétablit dans ce panneau avec les boutons/icônes existants et une transformation pure des présentations de la seule vue, sans réordonner les propriétés de la source ni perdre leurs largeurs. Les tests conservent le parcours utilisateur de réordonnancement.

### Régressions découvertes par la validation automatisée

Les contrôles de convergence couvrent également l'identité globale des sources
(029), la conservation par conteneur de l'onglet actif (009/029), les titres longs
qui interceptent l'action d'ouverture, le maintien d'une confirmation de
conversion après fermeture du menu et le contraste en thème clair. Les accents
du propriétaire et la palette des propriétés restent les références ; les
rôles de texte et de remplissage accessible peuvent recevoir une variante
sémantique. Chaque correction d'interface suit ui-quality + lessons avec
preuves dans verification.md. Aucune donnée de l'instance de développement
n'est déplacée ni réinitialisée.

La matrice révèle que DatabaseViewSurface n'utilise plus la requête paginée
après 029. T050 réutilise le moteur local de requête sur l'instantané complet
de la source choisie et les réglages du conteneur, puis le chargement/focus
existant de DatabasePage. Les identités, disponibilité et révisions bornent le
curseur ; changements sans rapport gardent la génération. Couverture partielle
et travaux locaux sont conservés, sans afficher une base complète à tort.

La validation E2E conserve la géométrie de la cible pendant un appui si une
largeur distante change, sans capture forcée ni activation au pointerdown. Le
retour vers une entrée paginée est demandé lors de la fermeture de l’entrée,
afin que l’ancienne vue ne le consomme pas avant la navigation.

T054 distingue les deux usages légitimes d’un fichier : placement et bloc intégré. Le parcours part d’un autre document, inspecte la page sans la sélectionner, puis ouvre chacune des références. T055 observe le scrollport vertical réel sans changer le layout approuvé : workspace-main pour le flux de page, surface du tableau pour le lab borné. Le décalage du tbody dans ce scrollport entre dans les mesures de virtualisation ; les spacers retirent ce décalage. Un tableau intégré qui apparaît ne remet pas la page en haut, les widgets masqués ne pilotent pas le scroll, et les changements de vue conservent leur contexte. Réutiliser ui-quality et lessons ; vérifier 1 001 lignes, DOM borné, ouverture/retour avec focus sur les cinq profils.

T056 corrige une réponse de détails restée en cache pendant que le bloc intégré arrive au serveur. L’ouverture des détails déclenche une lecture fraîche sans retirer la liste locale, sans attendre pour ouvrir le panneau et avec la protection existante contre les réponses anciennes. Le parcours des deux usages part d’une autre page et ne réinitialise pas l’instance du propriétaire.

T055 maintient aussi l’étendue verticale calculée (lignes + en-tête mesuré) sur la surface en flux de page pendant le remplacement des rangées/spacers. Cela évite la remise à zéro transitoire de WebKit lors des retraits DOM ; la surface bornée du lab conserve son plafond et son scroll propre. Les boutons d’entrée gardent 32 px avec l’espace requis pour les demi-bordures fusionnées. Les assertions conservent le clic automatique natif, sans pré-défilement de pagination, la limite de rangées DOM et la visibilité complète du retour.

T057 conserve une seule tentative de retour par demande d’entrée, même si la projection passe temporairement de ready à loading. Cette tentative suit ses remplacements de cible, reconnaît un déplacement volontaire vers un nouveau champ et se termine une seule fois. Une demande explicitement effacée puis réémise pour la même entrée commence un nouveau retour. Réutiliser ui-quality + lessons ; vérifier une saisie commencée avant la première disponibilité ou pendant une actualisation, puis les créations consécutives et le retour paginé sur les cinq profils.

T042/T044 vérifient le dépôt clavier sur sa destination réelle : pendant le défilement progressif, une transformation positive ne suffit pas à établir la cible. Attendre le repère bleu de la deuxième propriété et l’annonce de destination, vérifier annulation/ordre conservé, puis déposer un deuxième geste et contrôler sa persistance sans changer l’ordre des colonnes. Aucun délai arbitraire ni clic forcé ; aucune modification des gestes de production pour contourner le test.

Le même parcours vérifie d’abord l’état interactif du panneau de propriété : focus initial dans le nom, valeur saisie présente avant Entrée, puis nom modifié sur la page. Ces assertions distinguent une saisie non reçue pendant l’ouverture du panneau d’un échec d’enregistrement, sans masquer l’un ou l’autre.

T044 protège aussi le remplacement natif du nom contre un rendu concurrent avant son événement `input`. Comme pour le titre de page, le DOM conserve le brouillon ; React suit validation/sauvegarde et projette explicitement un nom source lorsque le champ est propre. Le même champ sert aux noms des options. Conserver les comportements pause/blur/Entrée, validation vide/longue et autofocus du panneau. La preuve unitaire doit échouer avant la correction puis réussir ; ne pas déclarer la causalité du défaut WebKit établie par une répétition qui n’a pas échoué. Appliquer ui-quality + lessons et examiner les captures du parcours réel.

T058 examine le menu de suggestions BlockNote/Ariakit réellement monté. Le parcours `/tab` depuis une liste dépliable expose trois commandes de base puis « Tableau simple » dans un menu borné par Floating UI. La mesure WebKit mobile observe un défilement à 65 px aussitôt ramené à zéro, avec une taille de menu inchangée ; le clic est intercepté par le contenu sous le menu. Corriger la cause dans l’intégration existante, conserver le propriétaire `editor.css`, les primitives natives et les gestes normaux ; aucune modification de densité ni clic forcé. États à vérifier selon ui-quality + lessons : filtre court/long, options sous la limite du viewport, sélection clavier et Échap, clair/sombre, 320/1280 px. Le diagnostic temporaire reste hors du test final.

Le correctif T058 utilise `floatingUIOptions.useFloatingOptions.strategy = fixed`, API existante de BlockNote. Le portail conserve son contexte d’éditeur ; Floating UI suit toujours le curseur et ses ancêtres. Aucun CSS ni ordre de commandes changé. Les essais retirant `aria-activedescendant` ou le flex de la liste n’ont pas résolu le défaut et ne sont pas retenus. Le nouveau parcours prépare un paragraphe enregistré avant de tester le menu ; il garde un scénario de composition séparé pour le défilement réellement en défaut. Capturer le viewport après la fin de l’ouverture, sans faire défiler la surface pour la capture.
