# Validation — 2026-10-04

Implémentation locale sur codex/notion-api-import, base 01a0560b ; aucune publication distante demandée. Les sources exécutables sont celles des images isolées construites et des tests ci-dessous. Les retouches suivantes ne concernent que tests/preuves et documentation.

## Cause et comportement livré

Le stockage multi-select existait ; query et Board supposaient une appartenance unique. Le domaine regroupe maintenant chaque option active sélectionnée sans dupliquer rows/totalCount/cursors ; les groupes restent ordonnés et filtrés. L'axe effectif d'un board vient de options.axisPropertyId, y compris pour group:null historique. La projection partagée conserve sa valeur même masquée (la visibilité est un réglage d'affichage, pas une permission), résout les labels et garde groupId:null pour plusieurs appartenances.

Les mouvements portent l'origine et se résolvent sur les valeurs complètes relues : A+B→C depuis A donne B+C, vers B donne B, vers Sans efface explicitement tout. Options historiques incompatibles : refus sans suppression. Même colonne et origine indisponible : aucune écriture. Toutes les occurrences d'une entrée sont désactivées pendant l'envoi ; erreur visible et contrôle réessayable. Focus conservé à la colonne d'ouverture dans le contexte de session puis à la cible après mouvement clavier. Création et réglages acceptent multi-select et alignent group/axis.

## Tests et contrôles

- Rouge initial : six échecs utiles sur quatre fichiers reproduisent memberships, projection masquée et perte de tags ; sept cas préexistants passent.
- Sélection de régression : 1 215 tests passent dans 158 fichiers (tout Web, domain/databases, query/mutation/reconciliation client-core, presenter contracts, query API et import/CLI). Une preuve supplémentaire d'axe invalide est exécutée ensuite avec Board/interaction/query API.
- Intégration PostgreSQL isolé : 17 tests passent dans trois fichiers API contract/security et import canonique ; backup, restart, protection des éditions et application réelle.
- Types stricts de tout le workspace et racine passent. Format/static des 22 fichiers affectés passent ; deux warnings de types void préexistants, aucune erreur. git diff --check passe.
- Builds : API (11 sorties) et image Web immutable réussis ; image API à partir de la même image source. Images notion-api-isolated/runtime seulement.
- Performance sans instrumentation : première page de 100 entrées parmi 100 000 sous le budget 1 s p95 pour les cinq formats ; board 113,8 ms. Les trois autres tests de ce fichier n'ont pas été sélectionnés et ne sont pas revendiqués.
- Matrice navigateur principale : cinq profils passent en 135 s, parcours nouveau multi-select et visual-views existants (statut, galerie, calendrier, projection distante). La passe finale du nouveau parcours ajoute annulation native et capture des deux appartenances initiales : cinq profils passent en 59 s. Les derniers tests Board/interaction/query API passent également (18 tests, trois fichiers).

## Preuves UI / ui-quality

[Skill](../../.agents/skills/ui-quality/SKILL.md), [lessons](../../.agents/skills/ui-quality/lessons.md) et [guide](../../docs/design/ui-system.md) appliqués. Pas de nouveau propriétaire CSS. Captures synthétiques depuis les vrais composants en clair/sombre, 1440/320 px : memberships multiples, propriété masquée, état vide des colonnes et contrôle de déplacement. Défilement horizontal interne ; aucun débordement de page. Le test de refus couvre actions bloquées pendant chargement, erreur visible et reprise ; le test d'axe invalide couvre l'absence de substitution silencieuse et le choix de reprise. Les contrôles reposent sur les primitives existantes, focus visible et libellés. Les parcours des cinq profils couvrent sélecteur/pointeur/tactile, Entrée, retour d'ouverture, deux mouvements consécutifs, reload, offline et resynchronisation ; drag natif et annulation sur profils desktop.

Revue visuelle : titres et couleurs d'options lisibles, controls réguliers, colonne bornée ; à 320 px l'axe et l'indication Sans valeur reviennent à la ligne, les colonnes défilent dans leur surface. Preuves publiques synthétiques dans evidence/. Les quatre captures réelles et données source restent privées sous work/notion-api/ (ignoré).

## Restauration sur 8082

Prévisualisation : deux vues, deux conteneurs, zéro édition ignorée. Après sauvegarde complète vérifiée, commandes database.definition.replace avec révision source attendue et autorisation vérifiant aussi la révision de présentation ; exactement deux vues restaurées. Comparaison à l'état connu de l'ancien fallback ; propriétés visibles actuelles conservées. Présentation et definition.views relues exactement, source/schema/entrées non remplacés. Six autres onglets conservés, dont Calendrier ajouté par le propriétaire. Plan et reçu protégés chiffrés ; seconde preview : zéro modification, deux vues déjà natives.

Navigateur réel : quatre captures clair/sombre × 1440/320 ; Matière affiche huit colonnes et quinze cartes ; reload, Par état↔Matière hors ligne, Calendrier présent ; zéro pageerror/5xx. HTTP8082/HTTPS8445/PG55433 et volumes propres. Après les écritures canoniques effectuées par le processus de réparation, redémarrage de la seule API isolée pour recharger sa projection en mémoire. Requête API protégée vérifiée : HTTP200, cinq onglets, quinze rows uniques, huit groupes avec labels résolus ; le DTO et la copie de vues sont natifs. Images et horaires de démarrage API/Web de myownnotion-ui-dev comparés avant/après, identiques ; aucune opération sur son checkout, ports ou volumes.

## Portée de la validation

La validation ci-dessus couvre la livraison locale demandée. Le gate complet checks:local n'a pas été exécuté pour une publication ; aucune branche n'est poussée, aucune PR ni release créée. Il demeure requis avant publication de ces changements de fondations communes. Les images officielles multi-architecture, suites complètes de couverture et Electron ne sont pas revendiquées.

Scans sur index Git temporaire incluant les nouveaux fichiers : secrets 1 886 fichiers / zéro finding, static security 1 333 sources / zéro finding ; index réel inchangé. Liens documentaires locaux et prérequis Spec Kit vérifiés.

Captures : [appartenances multiples](evidence/memberships.png), [clair desktop](evidence/board-light-1440.png), [sombre desktop](evidence/board-dark-1440.png), [clair 320](evidence/board-light-320.png), [sombre 320](evidence/board-dark-320.png).


## Finition visuelle US4 — livraison locale du 2026-10-04

Périmètre de cette maintenance : BoardView, database.css, copie française et lab synthétique, tests et guide UI ; aucun domaine, protocole, import, migration ou API modifié. Les preuves des sections précédentes décrivent le regroupement initial ; les nouvelles captures refined-* décrivent son rendu actuel.

Colonnes arrondies teintées avec les tokens d'options, en-têtes badge/compte/repli iconique, cartes titre et identité canonique. Plus de formulaire permanent sur chaque carte : le menu Ariakit portal conserve destinations et origine, indique la suppression de toutes les sélections, se ferme avec Échap et restaure le focus. Actions révélées au survol/focus, toujours disponibles au toucher ; dimensions réservées. Regroupement dans un popover compact, état vide léger, largeur des colonnes bornée par le conteneur réel à 320 px. Réglage et refus restent alignés à la zone visible pendant le défilement horizontal ; un refus est ramené dans la fenêtre sans prendre le focus.

Checks sélectionnés selon docs/development.md pour cette passe Web bornée : format/static des neuf fichiers, types Web et racine, tests Web (912 passent avant les callbacks QA), puis 21 tests ciblés Board/lab contre le rendu final. Build Web Bun et image isolée réussis. Le lab permet des mutations synthétiques pending/refused pour vérifier les vrais contrôles : destination désactivée pendant l'attente, carte conservée, aucune fausse annonce, retry disponible. Aucun consommateur SQL/API justifiant une nouvelle suite serveur ; smoke API réel HTTP200, quinze rows uniques et huit groupes, cinq onglets conservés.

Preuves selon ui-quality et lessons : trente captures synthétiques du vrai lab (rempli/titre long/identité dossier/enregistrement local, vide, repli, destinations, regroupement, attente et refus), clair/sombre à 1440/320 px. Revue à l'écran : actions stables, textes longs reviennent à la ligne, pas de débordement de page, menus dans la fenêtre et erreur lisible même sur une colonne éloignée. Les huit captures réelles de Matière restent privées sous work/notion-api ; huit colonnes/quinze cartes, menus/Échap/regroupement/reload, Calendrier conservé, zéro pageerror/5xx. Seul Web redéployé sur 8082 ; API et données réelles non réécrites. Images et horaires de démarrage de l'autre instance identiques avant/après.

Un premier parcours mobile forçait le focus d'une destination pendant l'autofocus d'ouverture : remplacé par l'attente du focus initial et la navigation réelle aux flèches. La revue d'erreur a ensuite identifié un message hors de la fenêtre étroite : positionnement horizontal et révélation verticale corrigés. Les captures pleine page mobiles sont prises après le retry, car leur changement temporaire du viewport ne doit pas guider un clic ultérieur. Les succès définitifs des profils sont enregistrés ci-dessous après exécution.

Captures actuelles : [sombre desktop](evidence/refined-board-dark-1440.png), [sombre 320](evidence/refined-board-dark-320.png), [destinations](evidence/refined-menu-dark-320.png), [regroupement](evidence/refined-grouping-light-1440.png), [vide](evidence/refined-empty-light-320.png), [repli](evidence/refined-collapsed-dark-1440.png), [attente](evidence/refined-pending-light-1440.png), [refus visible](evidence/refined-error-visible-dark-320.png).

## Retour couleurs — 2026-10-06

Après retour du propriétaire avec une référence Notion, la carte utilise le
token de surface douce complet transmis par sa colonne au lieu d'un mélange
atténuant avec la surface. Le contour reprend discrètement le ton du groupe ;
Sans valeur reste neutre. Le build Web, le format CSS et le contrôle de diff
passent ; l'image est redéployée en recréant uniquement le Web isolé, sain.
8082 et 8080 répondent HTTP 200 ; l'API/la base isolées et les conteneurs de
l'instance principale restent inchangés. Aucune suite applicative n'est
relancée selon la demande du propriétaire ; la revue authentifiée en
clair/sombre reste à confirmer.

## Maintenance des couleurs de cartes — 2026-10-06

La carte mélange sa surface de thème au ton doux transmis par la colonne ;
Sans valeur reste gris neutre. Aucun test applicatif n'est relancé selon la
demande du propriétaire. La revue visuelle réelle des thèmes et états reste
ouverte dans T018. Le build Web passe et la version est déployée sur le Web
isolé 8082 uniquement, sans redémarrer API, base ou instance principale ;
8082 et 8080 répondent HTTP 200. La vérification visuelle authentifiée et
les états clair/sombre restent à confirmer par revue du propriétaire.

### Vérification finale US4

La matrice isolée finale du 4 octobre 2026 passe 5/5 profils (deux parcours par profil, 59 s), sans build concurrent : Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile. Log privé `work/notion-api/036-style-e2e-accepted.log`. T015/T016 terminées ; preuves UI, refus/reprise, pending, build, déploiement et invariance de l'autre instance décrits plus haut. Les quatre nouvelles remarques du propriétaire sont suivies dans la feature 037, qui étend le flux de page et la création par colonne.

## Correction de la calibration trop pâle — 2026-10-06

Le mélange global 88 % surface / 12 % accent a rendu les teintes trop ternes,
comme l'a signalé le propriétaire. Il est remplacé par une palette centrale
spécifique à chaque thème : pastels en clair et tons profonds mais saturés en
sombre. Les cartes reprennent leur teinte complète ; les colonnes la mélangent
au fond de page pour rester plus discrètes. Les contours mélangent le ton doux
à la bordure du thème. Le padding vertical des cartes reste réduit d'un pixel
en haut et en bas.

Les captures du vrai `BoardView` dans l'UI Lab vérifient la hiérarchie des
surfaces en clair et en sombre, un titre long, les groupes gris/bleu/vert et
« Sans état » : [sombre](evidence/surface-overlay-dark-1454.png),
[clair](evidence/surface-overlay-light-1454.png). Elles ne couvrent pas les
états de survol/focus ni la page Matière authentifiée ; T018 reste ouvert pour
ces vérifications.

Le build Web, le format CSS et `git diff --check` passent. Aucun test applicatif
n'a été lancé, conformément à la demande. Seul le Web isolé 8082 a été
reconstruit et recréé ; 8082 et 8080 répondent HTTP 200. L'API isolée, la base
isolée et les conteneurs de l'instance principale n'ont pas redémarré.
