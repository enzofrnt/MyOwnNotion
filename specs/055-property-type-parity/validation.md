# Validation — parité des types de propriété

**Feature**: 055-property-type-parity
**État**: implémentation à démarrer (spec/plan/tâches validées le 2026-11-06)

## Preuves Notion (référence)
- `.notion-lab/parity/property-types/` : panneau d'ajout, Nombre, Date, État,
  Formule, Relation, Agrégation.
- `.notion-lab/parity/property-types/README.md` : relevé détaillé + sources.

## Décisions du propriétaire
- Google Places + vue Carte ; Formule interface Notion sans IA ; Fichiers
  limites Notion ; pas de notifications de date ; État à groupes fixes ;
  Nombre tous affichages ; Identifiant comme Notion ; exclusion Relation,
  Bouton, Personne, Créée par, Dernière modification par.

## À compléter
Captures candidat, tests, clair/sombre, 320/390 px, migration, comparaison.

## Phase 0 — panneau de configuration (2026-11-06)
- « Modifier la propriété » ajouté au menu de colonne, panneau latéral via le
  composant de configuration existant (`mode="type"`), options de choix,
  formule, date, relation et agrégation branchées.
- Preuves : `evidence/config-panel-selection.png`, `evidence/config-panel-formula.png`.
- Vérifié : menu et panneau ouverts ensemble ; Échap ferme le panneau puis le
  menu ; clic extérieur ferme les deux ; aucune erreur console.
- Restant : thème sombre, 320 px, capture Notion du panneau latéral pour
  comparaison, Numéro et les autres types.

## Phase 1 — Nombre (2026-11-06)
- Config `format`/`decimals`/`display` dans le domaine, défauts pour les anciennes propriétés (`{}`), validation de schéma.
- Panneau : format Notion (nombre, séparateurs, %, devises), décimales 0–5, affichage Nombre/Barre/Anneau ; note « s’applique à toutes les vues ».
- Rendu : formatage dans `displayDatabaseValue` (table/liste), cellules Barre/Anneau dans la table.
- Preuves : `evidence/number-settings.png`, `evidence/number-settings-configured.png` ; tests `number-format.spec.ts`, `schema.spec.ts`.
- Vérifié en réel : format percent + décimales 1 + Barre persistent dans le panneau.
- Reste : preuve visuelle bar/anneau avec une valeur (la saisie de la valeur de test n’a pas été confirmée), formats dans les propriétés de page, libellés devises alignés à Notion, états sombre/320.

## Phase 2 — Dates (2026-11-06)
- Config date : mode date/instant + format de date (6 options Notion) + format d’heure (Masqué/12/24), défauts pour les anciennes propriétés.
- Panneau : formats de date/heure, « Inclure l’heure », note toutes les vues.
- Rendu : dates civiles et instants via `formatDatabaseDate` (table/liste), sans dérive de fuseau sur les dates civiles.
- Preuve : `evidence/date-settings.png` ; tests `date-format.spec.ts`, `schema.spec.ts`.
- Limites : plages de dates non implémentées ; dates de création/dernière modification encore au format existant ; propriétés de page encore en saisie brute ; libellés relatifs au-delà de 7 jours = date complète.

## Dates automatiques
- Date de création / dernière modification : formats de date et d’heure configurables (sans notifications), lecture seule, rendu table/liste/propriétés de page.
- Preuve : `evidence/auto-date-settings.png`.
- Plages de dates toujours non implémentées.

## État — groupes fixes
- Domain : options avec groupe (`todo`, `in-progress`, `complete`), groupe inféré pour les anciennes options, option par défaut, validation.
- UI : panneau en trois groupes, ajout d’option par groupe, changement de groupe, « PAR DÉFAUT », option par défaut ; cellule vide affiche l’option par défaut.
- Preuve : `evidence/status-settings.png` ; tests `schema.spec.ts`, `status-default.spec.ts`.
- Limites : groupe non déplaçable par glisser-déposer (menu), regroupement de vues non retravaillé.

## Plages de dates
- Valeurs date/instant avec `endDate`/`endInstant` optionnels, validation domaine et contrats.
- Éditeur : deux champs date/heure + « + Fin »/retrait ; rendu « début → fin » dans la table/liste.
- Preuve : `evidence/date-range-editor.png` ; tests `date-format.spec.ts`, `database-editor.spec.tsx`.
- Limite de vérification : la stack Docker 8080 semble encore servir l’ancien schéma API ; l’enregistrement d’une valeur de test a échoué (« La valeur n’a pas pu être enregistrée »). À revalider après rebuild/restart de l’API.

## Identifiant — préfixe
- Config `{ prefix }` optionnelle, validation 32 caractères, helper `uniqueIdPrefixOf`.
- Panneau : préfixe (TASK) + aperçu « TASK-42 », note toutes les vues ; affichage table/liste/propriétés de page/formule avec préfixe.
- Preuve : `evidence/unique-id-settings.png` ; tests `database-unique-id.spec.ts`, `schema.spec.ts`.
- Limites : URL `PREFIX-123` non implémentée ; pas de génération automatique du préfixe ; un seul identifiant par base non imposé.

## Formule — éditeur (sans IA)
- Dialogue « Modifier la formule » avec expression, puces de propriétés, palette de fonctions supportées, aperçu sur la première ligne et type du résultat.
- Aucun assistant IA, conformément à la décision.
- Preuve : `evidence/formula-editor.png`.
- Limites : langue encore limitée aux fonctions existantes (if, round, abs, concat, length, lower, upper, number, text) ; prévisualisation avec sélection de page et mode débogage non faits.

## Fichiers et médias
- Limites Notion appliquées avant upload : images 5 Mo, PDF 20 Mo, autres 5 Mo ; message d’erreur local.
- Aperçu image via `/v1/files/{id}/content`, nom cliquable/téléchargeable, multi-fichiers et suppression déjà en place.
- Tests : `database-file-limits.spec.ts`.
- Limites : ajout par lien externe non implémenté ; édition des fichiers depuis une cellule de table non faite ; pas de preuve visuelle (la base de test n’a pas de propriété Fichiers et l’API runtime est en retard).

## Formule — fonctions palier 1
- Ajout de `and`, `or`, `not`, `empty`, `equal`, `unequal`, `contains`, `substring`, `replace`, `replaceAll`, `trim`, `repeat`, `padStart`, `padEnd`, `min`, `max`, `sum`, `ceil`, `floor`, `now`, `dateAdd`, `dateBetween`.
- Palette regroupée en Général / Texte / Numéro / Date ; tests `formula.spec.ts`.
- Limite : couverture Notion complète toujours partielle.

## Agrégation
- Domaine : `targetPropertyId` optionnel, 24 fonctions Notion, validation.
- API : calcul des valeurs par relation/propriété cible à partir de toutes les sources de projection ; métadonnées `rollupProperties` dans la réponse ; `rollupValues` par ligne.
- UI : relation, propriété cible, calcul parmi les 24 fonctions ; affichage via la valeur calculée.
- Preuve : `evidence/rollup-settings.png` ; tests `database-rollup.spec.ts`, `schema.spec.ts`.
- Limites : options de propriété cible et valeurs calculées non revalidées dans le stack Docker (API runtime ancienne) ; pas de test d’intégration du service de requête ; formats d’affichage des agrégats simples.

## Incident — la base ne chargeait plus (2026-11-06)
- Cause : les contrats de définition acceptaient encore les anciennes configs. La définition contenait les nouvelles configs (nombre, formats de date, groupes d’état, préfixe d’identifiant, agrégation), donc `GET /v1/databases/:id` et `GET /v1/changes` renvoyaient 500 et le client ne pouvait plus synchroniser/charger depuis le serveur.
- Correctif : mise à jour de `DatabasePropertySchema` (number, date/date range, status groups/default, unique-id prefix, rollup target/functions) et des valeurs de date avec fin.
- Vérifié : la page charge, 13 colonnes, 17 lignes, aucune réponse 4xx/5xx ; changes feed 200.
- Preuve : `evidence/database-load-fixed.png`.

## Lieu et vue Carte
- Type de propriété `place` : valeur typée (identifiant Google, nom, adresse, latitude, longitude), validation domaine/contrats, affichage table/page, recherche via `/v1/places/search` (clé serveur) et sélecteur Google Places.
- Vue Carte : type de vue `map`, propriété Lieu choisie, marqueurs Google Maps, clic vers la page, état vide ; clé navigateur servie par `/v1/maps/config`.
- Configuration : clés transmises aux conteneurs API via Compose ; Places testé HTTP 200 et Maps JS chargée.
- Preuves : `evidence/map-view.png`, `evidence/place-field.png`.
- Limites : édition du lieu en cellule de table en lecture seule (édition via la page), pas de mode sombre/320 pour la carte, clés sans restriction comme demandé.
- Correctif incident : les valeurs des propriétés retirées sont désormais acceptées lors d’un remplacement d’entrée ; sans cela toute sauvegarde échouait. Migration canonique : fichiers et plages de dates acceptés.

### Finitions Lieu/Carte
- La cellule Lieu de la table ouvre la page où le lieu est éditable (édition inline directe non faite).
- Le panneau de paramètres de vue propose aussi le format Carte, désactivé sans propriété Lieu.

### Agrégation locale
- Les propriétés cibles sont maintenant chargées depuis toutes les bases locales (la liste n’expose plus seulement « Aucune »).
- Les 24 calculs sont exécutés localement via la même fonction de domaine que l’API ; tests `rollup.spec.ts`.
- La page `PageViewQuery` et la surface intégrée partagent le contexte de rollup local.

### Fichiers — liens externes
- Les valeurs `files` acceptent maintenant `externalUrls` (http/https, 20 éléments au total), affichés dans le champ et comptés dans la table/formule/agrégation.
- Ajout d’un lien testé dans l’interface, conservé après rechargement (preuve `evidence/file-links.png`).

### Dernières finitions
- Lieu éditable directement dans une cellule de table via un popover (preuve `evidence/place-inline.png`).
- Carte en mode sombre avec styles Google Maps dédiés (preuve `evidence/map-dark.png`) et mise en page responsive.
- Formule : sélecteur d’aperçu par page.

### Menu de colonne — icônes
- « Modifier la propriété » utilise l’icône réglages (sliders) ; « Modifier le type » utilise l’icône d’échange. Les deux chevrons sont alignés à droite.
- Preuve : `evidence/property-menu-icons.png`.
- Itération icône « Modifier le type » : `Repeat2` appliqué, avec chevron à droite ; `Replace` reste l’alternative.

## Menu de colonne — parité mesurée (2026-11-07)
- Référence Notion capturée par recette (`scripts/notion-parity/recipes/notion-property-menu.json`), candidate par `myownnotion-property-menu.json`.
- Gate : `bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-menu.json` → structure et géométrie alignées pour les 9 items in-scope.
- Mesures : items 28 px, largeur 236 px, icônes 20 px à x=8/y=4, texte à x=36 en 14 px/400, chevrons à 8 px du bord, sections espacées de 9 px.
- Hors périmètre déclaré : Accès à la propriété, Grouper, Calculer, Figer, Renvoyer le contenu à la ligne (fonctions non implémentées, listées par le gate).
- Preuves : `evidence/property-menu-reference-clip.png`, `evidence/property-menu-candidate-clip.png`, `evidence/property-menu-comparison.md`.

### Menu de colonne — hover, échelle et sous-menus
- Voile de survol aligné sur Notion : `rgba(33,27,23,0.051)` clair, `rgba(255,255,255,0.06)` sombre ; le gate compare le fond de survol de chaque item.
- Échelle mesurée : conteneur 244 px, items 236×28, icônes 20 px à (8,4), texte 14 px/400 à x=36, chevrons à 8 px du bord, sections 9 px.
- Sous-menus : « Trier » et « Modifier le type » s’ouvrent en **flyout latéral** (200 px, items 28 px), plus de sous-menu inline. Gate dédié `property-sort-submenu` : structure et géométrie ✅.
- Le gate échoue désormais sur un écart de structure, de géométrie ou de voile de survol.
- Preuves : `evidence/property-sort-submenu.png`, `evidence/property-type-submenu.png`, `evidence/property-menu-comparison.md`, `evidence/property-sort-submenu-comparison.md`.

### Analyse CSS approfondie du menu
- La famille de police du menu est alignée sur la pile Notion (`ui-sans-serif`, system-ui, SF Pro/Segoe) au lieu d’Inter.
- Interligne des libellés : 16,8 px (Notion) au lieu de 20 px ; graisse 400.
- Le gate compare maintenant famille de police, interligne, fond de survol, texte brut, icônes et chevrons.
- Si un onglet était resté ouvert sans HMR, un rechargement forcé est nécessaire pour voir cette version ; les captures du gate partent toujours d’un chargement propre.


## Correction propriétaire — forme uniquement, 2026-11-07

Cette entrée remplace les précédentes affirmations de parité visuelle fondées
sur le gate seul. Le propriétaire demande uniquement la forme ; aucune action
n’est ajoutée ou retirée.

- Suppression/narrowing de 93 règles historiques concurrentes de `database.css` ;
  propriétaire unique : `column-property-menu.css`, chargé par `global.css`.
- Échelle optique adaptée à l’app : texte système 13 px / 400, lignes 28 px,
  icônes 20 px à trait allégé, texte à x=36 ; en-tête 13 px / 500. Ce n’est pas déclaré
  pixel-identique à Notion.
- Même échelle sur les flyouts, le panneau de configuration et ses menus
  d’options portalisés, via contexte React explicitement reporté dans les classes.
- Flyouts au survol avec délai court, placement par hauteur réelle et retournement
  gauche/droite. Échap ferme seulement le flyout et rend le focus au déclencheur.
- Vérification navigateur : deux thèmes, menu Statut, tri/type/configuration/options ;
  aucune erreur JS ; tous les textes d’action mesurés à 13 px / 400.
- À 390 px : flyout contenu dans le viewport (x=8, largeur=224).
- Flyout de tri : 200 × 65 px, sans bordure, items 28 px ; le gate de référence
  garde une différence assumée de 1 px de police (13 au lieu de 14).
- Base du travail précédent (GPT) conservée : un seul propriétaire CSS, contexte
  de portail, positionnement selon la hauteur réelle, tests de non-régression du
  comparateur. Extension de cette passe : icônes 20 px, flyout 65 px, captures
  clair/sombre et largeur 390 px.
- Captures natives : `evidence/menu-form-v2/light-context.png`,
  `dark-context.png`, `dark-types.png`, `dark-configuration.png`,
  `dark-option.png`, `dark-390.png`.
- Tests : 1 093 web, tsc web, 5 tests du comparateur ; Biome ciblé sans erreur.
- Les anciens faux positifs du comparateur sont couverts : famille manquante,
  graisse inattendue, icône surdimensionnée, géométrie non numérique.
- Revue propriétaire du nouveau rendu encore attendue ; aucune prétention de
  parité parfaite ou de validation esthétique utilisateur.


## Sélecteur d’icônes de propriété, 2026-11-08

Le catalogue curaté contenait 235 icônes, alors que `lucide-react` en fournit
environ 3 000. Le sélecteur les présentait dans **296 px de large, 8 colonnes,
16 rem de haut**, soit environ 56 icônes visibles, sans indice de défilement
suffisant.

Correction : panneau **360 px**, **9 colonnes**, **21 rem de haut**, icônes
**22 px**, compteur et ligne « Faites défiler… ». Le catalogue curaté reste en
tête (libellés français), puis **toutes les icônes Lucide** disponibles suivent,
soit **2 039 choix** au total. Les icônes hors sélection curatée sont chargées à
la demande via un observateur d’intersection : seules les cellules proches du
viewport demandent leur module. Preuves : `evidence/icon-picker-dark.png` et
`evidence/icon-picker-dark-context.png`.
