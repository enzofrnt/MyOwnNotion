# Vérification

## Point de départ

- 032 enregistré : `f7b167a8` ; état Git propre au début.
- Branche `codex/033-app-ui-review`, même checkout ; données de dev conservées.
- Instance `myownnotion-ui-dev`, http://localhost:8080, sources HMR.
- Skill UI + leçons et guide chargés, Spec Kit specify/plan/tasks/analyze suivis.

## Analyse avant implémentation

8 FR/5 SC couverts par T001…014. Aucune ambiguïté matérielle, duplication ou
contradiction avec le canevas. Constitution III : exception explicite Enzo,
E2E différés et aucun push/release ; suivi avant publication. Pas de conflit
de données/architecture. Tous les rôles communs conservent leurs interfaces.

## Inventaire et méthode — 3 octobre 2026

[Inventaire source](assets/source-inventory.json) : 120 fichiers TSX de feature,
20 familles, 113 atteignables depuis `main.tsx`, 7 historiques non montés.
Le graphe d’imports est conservateur, inclut imports dynamiques et barrels ;
il prouve la présence du code, pas son exécution dans chaque scénario.
Chaque famille ci-dessous possède un résultat. Les composants ordinaires sont
observés dans l’application ; les décisions sensibles et états rares utilisent
leurs vrais composants avec callbacks/API/autorité de document en mémoire.
La revue de source complète ces rendus pour les contrôleurs, wrappers et guards.

Les capacités et états distincts implémentés sont le périmètre de cette passe,
sans promesse de couvrir toutes les combinaisons de données. Un tableau de
lecture, une grille éditable et un tableau éditorial ont des contrats différents.
Les différences intentionnelles de densité et de géométrie sont conservées.

| Famille (fichiers TSX) | Surfaces et états examinés | Accès / résultat / preuve représentative |
| --- | --- | --- |
| Attachments (2) | Liste compacte de navigation, détails/usages, remplacement et transferts | Listes réelles dans le lab, source/contrats du remplacement contrôlés ; aucune pièce propriétaire remplacée. [Liste et attente](assets/files-loading-dark-320.jpg), [détails](assets/attachment-details-dark-320.jpg). |
| Auth (3) | Connexion, installation initiale, adresse du serveur et indications desktop | Composants réels sur adapters locaux ; aucune passkey créée. [Connexion](assets/auth-login-light-1280.jpg), [installation](assets/auth-setup-dark-320.jpg), [serveur](assets/auth-connection-dark-320.jpg). |
| Backup (3) | Copie complète, distante, exports portables, absence/stale/échec, essai de restauration | Réglages réels + lab callbacks locaux ; aucune restauration réelle. [Réglages](assets/app-backups-light-1280.jpg), [états](assets/backup-dark-320.jpg). |
| Connection (2) | Adresse et état du serveur, profil desktop | Lab et rubrique Sécurité ; diagnostic de disponibilité sobre. [Adresse](assets/auth-connection-light-1280.jpg), [renderer desktop](assets/desktop-dark-320.jpg). |
| Databases (22) | Page base et source, cinq formats, vide, propriétés typées, options longues, filtres/tri/regroupement, entrée/erreur, conflits | Base réelle + lab mémoire. Sélections natifs communs, liste/galerie et panneau de propriétés corrigés. [Base](assets/app-database-dark-1280.jpg), [table](assets/table-dark-320.jpg), [Kanban](assets/board-light-1280.jpg), [galerie](assets/gallery-dark-320.jpg), [liste](assets/list-light-1280.jpg), [calendrier](assets/calendar-dark-320.jpg), [vide](assets/database-empty-dark-320.jpg), [règles](assets/database-rules-dark-320.jpg), [propriétés](assets/properties-light-1280.jpg), [validation](assets/entry-validation-dark-320.jpg). |
| Diagnostics (1) | Diagnostic du renderer/connexion native | Contrat/source contrôlés ; composition desktop observée. [Renderer](assets/desktop-light-1280.jpg). Processus natif OS non exécuté. |
| Editor (27) | Document V3, titres, tâche, citation/code, encadré, toggle, tableau, lien, bloc opaque, slash menu, enregistrement interrompu | Vraie page + moteur V3 mémoire. Encadré étroit corrigé ; bloc inconnu neutre. [Page](assets/app-page-light-1280.jpg), [blocs](assets/editor-rich-dark-320.jpg), [commandes](assets/editor-slash-menu-dark-320.jpg), [lien invalide](assets/bookmark-validation-dark-320.jpg), [interruption](assets/states-dark-320.jpg). Contrôleurs média et guards examinés en source ; décodage de tous les médias et fournisseur tiers hors revue visuelle. |
| Files (6) | Chargement, aperçu, erreur/téléchargement, type non supporté, offloaded, envoi/vérification/blocage, usages/suppression | Surface réelle extraite sans fetch, contrôleur/blob URL conservés. Cadre stable 60vh/minimum 240 px. [Attente](assets/files-loading-light-1280.jpg), [aperçu](assets/files-ready-dark-320.jpg), [erreur](assets/files-error-dark-320.jpg), [suppression](assets/delete-file-dialog-dark-320.jpg). |
| Hierarchy (4) | Pages/dossiers/enfants, détails/relations, mutations locales acceptées/en attente/conflit/refusées | Instance réelle et diagnostic mémoire ; mutations aplaties, texte français et classes propres. [Dossier](assets/app-folder-dark-1280.jpg), [détails](assets/app-page-details-light-1280.jpg), [mutations](assets/states-dark-320.jpg). |
| History (1) | Identifiant, prévisualisation et reprise après échec | Page actuelle réelle + API mémoire injectée pour révision ; aucune restauration propriétaire. [Aperçu](assets/history-dark-320.jpg). |
| Knowledge graph (5) | Canvas, filtres, contrôles et panneau d’information | Graphe réel, clair/sombre aux deux largeurs ; champs natifs communs. [Canvas](assets/app-graph-light-1280.jpg), [filtres](assets/app-graph-filters-dark-320.jpg). |
| Navigation (9) | Sidebar/tiroir, création, outils, actions de ligne/menu, branch/toggle, conversion/drag | Instance réelle et contrats existants ; densité/pointer protocols conservés. [Création](assets/app-create-menu-dark-320.jpg), [menu au clavier](assets/app-item-menu-dark-1280.jpg), [dossier](assets/app-folder-light-320.jpg). Conversion et drag contrôlés en source/tests, sans convertir/déplacer les données de dev. |
| Routing (1) | Route inexistante et retour | Écran réel. [Introuvable](assets/app-not-found-dark-320.jpg). |
| Save state (3) | Anciennes notices/enregistrement | Aucun import depuis le renderer actuel : exclusion explicite. Les états actifs vivent dans `editor`/`sync` et sont rendus dans le lab. |
| Search (3) | Dialogue, filtres, résultats/chemins longs, navigation clavier | Recherche réelle déclenchée par Entrée : 20 résultats, déplacement clavier observé. [Résultats](assets/app-search-light-1280.jpg), [mobile](assets/app-search-dark-320.jpg). |
| Security (10) | Mot de passe/passkeys, sessions/appareils, MCP, récupération/kit/remplacement/rotation, coffre desktop | Réglages réels + états mémoire ; checkbox de confirmation mobile corrigée. [Sécurité](assets/app-security-dark-320.jpg), [récupération](assets/recovery-light-1280.jpg), [coffre](assets/desktop-dark-320.jpg). Aucune révocation/rotation/export sensible exécuté. |
| Settings (4) | Shell, sécurité, sauvegarde, stockage/diagnostics, corbeille, page actuelle | Instance réelle ; libellés stockage français. [Stockage](assets/app-storage-dark-320.jpg), [corbeille vide](assets/app-trash-light-1280.jpg), [page actuelle](assets/app-page-details-dark-320.jpg). Ancien réglage de navigation non monté exclu. |
| Sync (5) | État connexion, conflit, ambiguïté, anciennes récupérations, statut workspace | Vrais composants mémoire et statut réel de page ; comparaisons/sections communes, boutons cohérents. [Conflits](assets/conflicts-dark-320.jpg), [connexion](assets/states-light-1280.jpg), [stockage](assets/app-storage-light-1280.jpg). |
| Update (1) | Disponible, erreur, protections modifications locales/migration | Surface réelle injectée, guards conservés et testés ; aucun installeur lancé. [Mise à jour](assets/desktop-light-1280.jpg). |
| Workspace (8) | Shell, onglets, titre/chemin, enfants, placeholder, vide/hors ligne/erreur | Pages et dossiers réels + états mémoire. [Page](assets/app-page-dark-320.jpg), [dossier](assets/app-folder-light-1280.jpg), [états](assets/states-dark-320.jpg). |

Les sept fichiers non montés : `databases/create-database-form.tsx`,
`editor/block-controls.tsx`, `editor/slash-menu.tsx`, les trois `save-state/*.tsx`,
`settings/workspace-navigation-settings.tsx`. Ils ne sont ni supprimés ni
annoncés comme de nouveaux écrans vérifiés. Les routes/protocoles non visuels et
fonctions futures ne créent pas de surfaces supplémentaires dans cette feature.

## Corrections et bibliothèque réutilisable

| Commun | Consommateurs réels / contrat conservé |
| --- | --- |
| `Section` | Conflits page/base, récupération historique, mutations, mise à jour : section sobre ; titre/actions appartiennent au consommateur. `minmax(0,1fr)` empêche un placeholder fixe d’élargir le document. |
| `ReadTable` | Comparaisons page et base ; caption/th/td et scroll clavier. Aucun remplacement des grilles éditables. |
| `CodePreview` | Comparaisons page/base et historique ; texte conservé, wrap prose ou scroll local. |
| `NativeSelect` | Bases, filtres, tri, tâches, graphe, recherche et stockage ; ref, multiple, size, defaultValue, FormData inchangés. |
| `NativeInput` / classe native | Noms/options de propriétés et éditeurs de valeurs ; brouillons non contrôlés et refs métier conservés. |
| `Skeleton media` | Aperçu média de fichiers ; même cadre en attente/erreur/prêt. Besoin partagé avec futurs aperçus, sans promesse de hauteur universelle. |
| `.ui-actions` | Résolution de conflit et mise à jour desktop ; gap et retour à la ligne communs. |
| `Button`, `Dialog`, `Drawer`, `Menu` existants | Réemployés pour les actions de liste/galerie, ambiguïté, bloc inconnu, propriétés et règles de vue ; aucun second système d’overlays. |

Défauts observés corrigés : comparaisons illisibles sur mobile, listes trop
encadrées, options de galerie qui débordaient, champs de brouillon sans cadre,
valeur de type existant `status`/`multi-select` absente du select (risque de
conversion silencieuse), checkbox de récupération mal alignée, placeholder qui
élargissait le document, contrôles d’encadré qui étouffaient le texte, propriétés
en carte dans un tiroir déjà encadré et anciennes règles/boutons de filtres.
Les choix de types du propriétaire restent conservés ; seul le type courant
manquant est ajouté à l’édition, marqué « actuel ».

Propriétaires CSS identifiés dans le [guide](../../docs/design/ui-system.md).
`global.css` reste un manifeste ; les mutations possèdent désormais leur feuille
diagnostic, sans réemployer les classes d’arborescence. Géométries spécialisées,
hairlines, palette de contenu et sélections de cellule sont conservées.
Accents `#4481D8`/`#D56C5E`, focus neutre, états système transparents/sobres,
suppression à texte/contour rouges issus de 031 restent en place.

## Vérifications visuelles et interactions

- **151 observations finales** surface/thème/largeur dans
  [viewport-measurements.json](assets/viewport-measurements.json) : document
  de 320 ou 1280 px, aucun débordement global mesuré. Captures `*-before-*` et
  anciennes fixtures d’éditeur restent des traces intermédiaires, exclues du
  bilan final. Les overlays sont cadrés sur le viewport visible après scroll.
- [Reflow à 640 px CSS](assets/history-reflow-200-dark-640.jpg) : équivalent
  de la largeur disponible à 200 % sur un écran de 1280 px, contenu et action
  lisibles, scroll local. Cette mesure ne simule pas les contrôles natifs du
  zoom navigateur ; ils ne sont pas annoncés comme vérifiés.
- Clair/sombre et 320/1280 sur familles et corrections ; contenu long dans
  propriétés, options, pages, fichiers, comparaisons et chemins. Tables/code
  larges gardent leur propre scrollport ; le calendrier garde sa grille locale.
- [Cibles tactiles](assets/touch-controls.json) : pointer coarse, mouvement
  réduit, contrôle des champs natifs/labels de booléens/boutons communs à 44 px.
  Les dessins d’icône/checkbox restent compacts. Les protocoles spécialisés de
  drag/resize restent couverts par leurs tests, sans nouvelle certification tactile.
- Tiroir : ouverture d’entrée, saisie `4,2`, validation visible conservant le
  brouillon, Échap puis focus rendu au titre de l’entrée. [Erreur](assets/entry-validation-dark-320.jpg).
- Lien : `pas-un-lien` conservé avec erreur locale ; Échap rend le focus à
  « Contenu de la page ». Slash depuis un paragraphe vide ouvre les commandes
  françaises ; fermeture sans mutation de l’espace propriétaire.
- Suppression de fichier : exemple isolé avec usage, focus initial sur
  « Conserver », Échap rend le focus au déclencheur ; aucune suppression réelle.
- Filtres/tri : ajout de règles dans l’exemple, sélections natives et boutons
  d’enregistrement accessibles ; figures finales aux deux largeurs/thèmes.
- Recherche réelle : saisie puis Entrée, résultats, ArrowDown, fermeture ;
  retour au déclencheur disponible ou au bouton de navigation après changement
  de largeur. Menu de dossier ouvert par ArrowDown et fermé par Échap.

Les dix modes de revue sont accessibles depuis `/__ui-lab`. Le moteur éditeur
V3, undo et les états conditionnels sont en mémoire. Dépôt/collage de fichier
désactivés dans l’éditeur de revue ; contrôleurs de production gardés par défaut.
Les callbacks sensibles de sauvegarde/récupération/fichiers échouent localement
ou sont sans effet ; ils n’atteignent pas les services du propriétaire.

## Contrôles locaux

| Contrôle | Résultat |
| --- | --- |
| `bun run --filter @myownnotion/web typecheck` | Réussi après les derniers changements. |
| `bunx vitest run --project web` | 119 fichiers, 780 tests réussis. |
| Suites bases/éditeur/propriétés/contrats après dernière correction des règles | 4 fichiers, 29 tests réussis. |
| Biome ciblé `check --diagnostic-level=error` | 52 fichiers TS/TSX/CSS/config modifiés, aucune erreur ni correction demandée ; warnings historiques de spécificité/`!important` conservés. |
| `bun run --filter @myownnotion/web build` | Réussi : 30 sorties, 20 assets précachés, 8 249 085 octets, Bun 1.4.2. |
| `git diff --check` | Réussi. |
| `bun run toolchain:check` | Réussi ; aucun changement de runtime/dépendance/lock. |
| Compose / navigateur réel | Quatre services healthy, app et lab servis depuis ce checkout via HMR. |

Sept tests de contrat ajoutés : natifs non contrôlés/multiple/FormData,
préservation de deux types de propriétés, sandbox opaque/no-referrer et fallback
fichier sans fetch, protections d’installation, table sémantique à scroll clavier,
document riche V3 et état undo/redo vivant sans réseau. Les suites existantes
vérifient aussi les tableaux spécialisés, éditeur, onglets, liens et sécurité.

## Instance et limites

Instance `myownnotion-ui-dev` sur [localhost:8080/notes](http://localhost:8080/notes),
[laboratoire](http://localhost:8080/__ui-lab). Le mot de passe de fixture locale
est `knowledge-graph-demo`. Les volumes et la CA existants restent conservés.
`bob` et sa sous-page `hu ui u,ii`, ajoutés par le propriétaire, sont toujours
visibles ; aucun reset, reseed ou effacement de ses changements.

Exception approuvée par Enzo : **aucun E2E maintenant**, aucun push/release.
`checks:local` n’est pas exécuté puisqu’il inclut cette suite. Avant publication,
reprendre les gates complets de `docs/development.md`, notamment navigateurs
Chromium/Firefox/WebKit, intégrations et packaging desktop. La revue native OS,
passkeys réelles, restauration/révocation/rotation effectives, transfert réel de
tous les types média et tous les croisements de données restent hors preuve
de cette passe UI. Les protections n’ont pas été supprimées pour obtenir un rendu.
La validation esthétique finale appartient au propriétaire ; aucune leçon ajoutée
au journal sans son accord.

## Traçabilité de clôture

FR-001/SC-005 : référence, volumes et instance. FR-002/SC-001 : inventaire des
20 familles et exclusions explicites. FR-003/SC-004 : corrections/rendus/tests.
FR-004/SC-003 : cinq nouvelles primitives, communs existants et guide/recettes.
FR-005 : callbacks isolés, protections et tests. FR-006/SC-002 : mesures,
thèmes, largeurs, clavier/tactile/scroll local. FR-007 : tokens et variantes
conservés. FR-008 : instance, lab, guide, tâches et exception E2E documentés.

Convergence après implémentation : 21 FR/SC/critères d’acceptation, huit décisions
techniques et huit principes constitutionnels contrôlés. Aucun écart manquant,
partiel, contradictoire ou travail non demandé identifié dans ce périmètre.
Aucune tâche ajoutée par la convergence ; T014 clôturée ensuite dans le suivi
d’implémentation. La validation visuelle du propriétaire reste attendue.
