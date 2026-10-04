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

## Maintenance — pièces jointes et fluidité (2026-10-03, FR-009 à FR-011)

Retour du propriétaire : la sidebar reflète les fichiers intégrés au contenu,
avec trombone et retrait léger ; pas d'ajout indépendant ni de compteurs.
Le titre se tronque quand le « + » s'étend. Trombone, « + » et « … » restent
visibles lorsque les pièces jointes sont ouvertes, y compris après interaction
ailleurs. Le panneau se ferme au départ de la page et sa bascule reste locale.
Sources partagées : canevas §§11.2/12/15, specs 005 et 017, ui-quality et leçons.

### Réalisation et données

`pageAttachmentsByPage` parcourt le document V3 avec le lecteur domaine
existant : fichiers et images imbriqués, tableaux, dédoublonnage et ordre des
références. Les placements ne définissent plus cette liste. Aucun fichier
historique n'est supprimé, aucune migration ni remise à zéro. Absence de
document local, liste vide et échec de lecture des usages restent distincts.
Les lignes locales apparaissent immédiatement, avant le complément des usages.
Les réponses tardives ne réintroduisent pas un fichier retiré du document.

L'état d'ouverture vit dans TreeAttachmentDisclosure, sans DOM supplémentaire
ni rendu de tout HierarchyExplorer à chaque clic. Le départ de la sélection
referme cette seule ligne. Les sessions des éditeurs restent montées ; leur
frontière memo et leur contexte reçoivent des références stables. Les contenus
des menus de navigation et le sélecteur emoji fermé sont montés à la demande,
avec les primitives Ariakit existantes ; aucun défaut global de primitive changé.
CollapsibleRegion conserve hauteur/opacité, inert, transitionend et reprise des
coins. La liste neutralise l'indentation héritée de l'arbre ; les actions
participent au layout et n'utilisent plus de réserve de largeur estimée.

### Revue réelle et preuves

- Instance existante sur localhost:8080, source de ce checkout par HMR. Le PDF
  ajouté par le propriétaire est présent dans le contenu et dans la sidebar,
  avec exactement le même nom ; les anciens fichiers sans bloc restent stockés.
- Clic dans le titre après ouverture : les trois contrôles ont opacity 1 et
  visibility visible. Après fermeture puis clic dans le titre : opacity 0,
  panneau démonté. Zéro badge de quantité dans les deux états.
- Navigation par les onglets existants vers Livraison puis retour à Produit :
  le panneau devient fermé/inert, termine sa transition et reste fermé au retour.
  Aucun texte modifié, fichier effacé ni onglet utilisateur fermé pour cette revue.
- Clavier : groupe « + » ouvert par Entrée, quatre commandes contenues, Échap
  le referme. Menu de page ouvert par Entrée, Échap rend le focus au déclencheur.
  Le sélecteur emoji apparaît à la demande ; Échap le démonte et rend le focus,
  sans sélectionner d'emoji ni modifier la page.
- Lab isolé clair/sombre à 1280 et 320 px : noms longs, rempli et vide, pas de
  débordement du document, gap titre/actions de 4 px, retrait trombone de 8 px.
  Rangée 30 px au pointeur, 44 px au tactile ; quatre cibles tactiles de 44 px
  sans chevauchement. Le titre reste accessible en entier par son nom/titre.
  Les états contenu inconnu et échec des usages ont été contrôlés par les tests
  du composant, sans simuler de panne sur les données du propriétaire.

Captures du rendu final, après stabilisation des transitions de thème :

- [Page réelle après interaction ailleurs](assets/app-sidebar-attachments-open-dark-1304.jpg)
- [Page réelle avec création en ligne](assets/app-sidebar-attachments-menu-dark-1304.jpg)
- [Sombre desktop](assets/sidebar-attachments-dark-1280.jpg) et
  [clair desktop](assets/sidebar-attachments-light-1280.jpg)
- [Sombre tactile](assets/sidebar-attachments-dark-320.jpg) et
  [clair tactile](assets/sidebar-attachments-light-320.jpg)
- [Vide tactile](assets/sidebar-attachments-empty-dark-320.jpg)
- [Mesures du navigateur](assets/sidebar-attachments-measurements.json)

### Mesures et contrôles

Observations CDP sur le même onglet de développement, pendant la bascule et une
fenêtre de 350 ms ; elles mesurent le travail de script cumulé, pas la durée
visuelle ni une promesse de performance sur tous les appareils :

| Action | Avant | Après |
| --- | --- | --- |
| Ouverture | 79 ms de script | 34 ms avec état local, puis 26 ms après menus à la demande |
| Fermeture | 169 ms de script | 22 ms avec état local |
| Départ vers une autre page, panneau ouvert | 478 ms avant menus à la demande | 290 ms après |

La navigation comprend l'activation de page et d'autres mises à jour ; son coût
reste supérieur à une simple bascule. Les mesures ne prouvent pas l'absence
universelle de ralentissement. La première stabilisation de l'éditeur seule
laissait 161 ms à la fermeture : elle était insuffisante et a été complétée
par l'état local. Le test de disclosure vérifie que ni parent, autres lignes
ni éditeur ne rerendent à la bascule, et que la session conserve son DOM.

Contrôles après les derniers changements de code :

- 11 suites web ciblées, **56 tests réussis** : projection, panneau, disclosure,
  éditeur, menus, emoji, création en ligne, hiérarchie, transitions et primitives.
- Types web réussis ; Biome ciblé sur 20 fichiers sans erreur ni correction.
- Build web réussi : 30 sorties, 20 assets, 8 250 629 octets, Bun 1.4.2.
- `git diff --check` réussi. La correction HMR est documentée et vérifiée
  séparément dans [019](../019-bun-toolchain/validation.md).

**Aucun E2E**, aucun push ni reset, conformément à la demande du propriétaire.
Les contrôles complets prépublication restent requis avant un push. Les réglages
temporaires de viewport et le toucher ont été restaurés ; seul le tab du lab
créé pour la revue a été fermé. Les onglets utilisateur et le contenu restent
conservés. Aucun ajout de leçon sans validation du propriétaire.

Convergence de maintenance : FR-009/010/011, plan et T015–T019 alignés avec
canevas/005/017 et preuves ci-dessus. L'acceptation perceptuelle finale et les
parcours E2E multi-navigateurs restent à reprendre à la demande du propriétaire.

## Clarification suivante — petits compteurs et preview de bloc

La formulation « le chiffre est trop » signifiait **trop gros**, pas « de
trop ». Cette clarification remplace la suppression décrite dans la section
précédente ; les anciennes captures et mesures restent des preuves historiques.
Le canevas, 017 et FR-011 sont corrigés dans la même passe.

### Compteurs

- Le nombre des fichiers intégrés, dédoublonnés depuis le document local,
  revient sur le trombone : badge de **12 × 12 px**, chiffre de **8 px**, accent
  partagé. Le compteur de l'en-tête est de **10 px**, discret et sans pastille.
- Page réelle du propriétaire : le PDF intégré donne « 1 » aux deux endroits.
  Les trois actions restent visibles après interaction ailleurs. Son contenu
  et ses onglets n'ont pas été modifiés.
- Lab rempli, nom long, clair/sombre à 1280 et 320 px : mêmes dimensions,
  compteurs contenus dans les contrôles, aucun débordement horizontal.
  Vide connu : aucun badge sur le trombone, en-tête « 0 ». Contenu inconnu :
  pas de faux compteur « 0 », vérifié par le test du panneau.

Preuves : [page réelle](assets/app-sidebar-attachments-small-count-dark-1304.jpg),
[sombre desktop](assets/sidebar-small-count-dark-1280.jpg),
[clair desktop](assets/sidebar-small-count-light-1280.jpg),
[sombre étroit](assets/sidebar-small-count-dark-320.jpg),
[clair étroit](assets/sidebar-small-count-light-320.jpg),
[vide étroit](assets/sidebar-small-count-empty-light-320.jpg) et
[mesures](assets/sidebar-small-count-measurements.json).

### Trait de déplacement

- Cause observée : plusieurs sessions d'éditeur restent montées ; la recherche
  globale du premier bloc prenait une colonne masquée de largeur zéro. La
  colonne active mesurée faisait 688 px. Le curseur pouvait aussi être récupéré
  dans un autre éditeur conservé.
- `readingColumnRect` part désormais du DOM de l'éditeur du drag ; le curseur
  est recherché dans son propre `offsetParent`, où BlockNote monte l'overlay.
  Une page composée uniquement d'un tableau utilise le padding de cet éditeur.
  Le trait natif reçoit l'accent partagé bleu et une épaisseur de 2 px.
- Les tests couvrent un premier éditeur masqué avec un curseur résiduel,
  la bonne colonne active et son origine relative, le repli tableau seul,
  le nettoyage, les positions voisines sans effet, le snapping et la conservation
  d'une mention au déplacement. Le mécanisme de dépôt reste celui existant.
- **Limite de revue** : le lab mémoire utilise le vrai PageEditor. Le contrôle
  disponible a démarré le drag par la poignée à six points (état grabbing
  observé), puis l'a annulé sans changement du document ; il ne transmet pas
  correctement le survol du drag natif. Aucun trait bleu en cours de déplacement
  ni dépôt natif réussi n'est donc présenté comme preuve visuelle. T021 reste
  ouvert sur cette vérification. Pas de contournement par accès à l'état privé
  de l'application et pas de changement du contenu utilisateur pour tester.

### Contrôles de cette passe

- 4 suites ciblées, **19 tests** : bloc déplacé, panneau, projection et disclosure.
- Types web, Biome ciblé sur 8 fichiers et build web réussis (8 251 643 octets).
- Instance actuelle mise à jour par HMR depuis ce checkout. Aucun E2E, push,
  reset ni commit supplémentaire. Seuls les onglets de démonstration ont été
  fermés et le viewport temporaire a été restauré.

T020 est vérifié ; l'implémentation de FR-012 est couverte par les tests ciblés,
avec le parcours visuel natif de T021 explicitement restant à confirmer.

## Retour suivant — ouverture des PJ d'une autre page

Le propriétaire constate encore du lag en ouvrant les PJ d'une autre page.
Le scénario précédent ne couvrait que la bascule sur la page déjà active :
les gains de T019 ne prouvaient donc pas la fluidité de ce second parcours.

### Cause et correction

Le clic du trombone appelait aussi `selectItemById`. Depuis Produit, ouvrir
les PJ de Livraison changeait la page principale et déclenchait son activation,
les mises à jour de l'arbre et de ses éditeurs. Le panneau vide reproduit le
problème : 304 ms de script et 393 ms de tâches cumulées observés.

L'inspection est maintenant locale à sa ligne, indépendante de la sélection.
Le contexte de navigation sert uniquement à fermer les panneaux lors d'un
changement réel de vue ; plusieurs inspections peuvent coexister. Les onglets,
contenu actif et sessions d'édition sont conservés. Le canevas et 017 suivent
ce contrat. La jonction/fond de la ligne inspectée fonctionne aussi sans
sélection, avec les trois actions visibles et la transition existante.

Les détails/actions d'un fichier compact utilisent `unmountOnHide` local :
leurs dialogues ne sont plus initialisés lors du simple affichage de la liste.
Le composant de revue utilise le vrai disclosure et CollapsibleRegion ; ses
commandes de consultation montrent la fermeture à une navigation simulée.

### Mesures du parcours réel

Mesures CDP sur le même onglet de développement, clic et fenêtre de 350 ms.
Il s'agit du travail cumulé du navigateur, pas de la durée de l'animation ni
d'une garantie de fréquence d'image sur tous les appareils.

| Action | Script | Tâches cumulées |
| --- | ---: | ---: |
| Produit → PJ de Livraison, avant : active Livraison | 304 ms | 393 ms |
| Produit → PJ de Livraison, après : conserve Produit | 8 ms | 115 ms |
| Livraison → PJ de Produit avec son PDF, après découplage | 26 ms | 95 ms |
| Même liste avec détails montés à la demande | 11 ms | 66 ms |
| Fermeture de cette liste, avant le montage à la demande | 10 ms | 130 ms |

Le nombre des layouts/recalculs reste lié aux transitions de largeur/hauteur.
La durée CSS de 210 ms est conservée. Aucun seuil de benchmark généralisé ni
prétention de couverture E2E n'est ajouté.

### Revue visuelle et interactions

- Page réelle : Produit reste actif lorsque les PJ vides de Livraison s'ouvrent,
  et Livraison reste actif lorsqu'on inspecte le PDF de Produit. URL inchangée
  dans les deux cas. Les trois commandes restent visibles sur la ligne inspectée
  non sélectionnée, dont les coins sont joints au panneau.
- Entrée ferme puis rouvre les PJ d'une autre page sans navigation. Une vraie
  activation de l'onglet Produit ferme les panneaux, puis les démonte sans
  résidu. Les onglets du propriétaire et ses documents restent conservés.
- Popover du PDF réel : absent avant ouverture, détails/actions accessibles par
  « … », Échap le démonte et rend le focus à son déclencheur. Aucun fichier
  ouvert en aperçu, remplacé ou supprimé pour cette vérification.
- Dialogue de suppression **sur fixture mémoire uniquement** : il reste monté
  au-dessus du popover après passage au montage à la demande ; « Conserver le
  fichier » l'annule. Aucune suppression confirmée ni appel au service réel.
- Lab clair/sombre 1280/320 px : ligne non sélectionnée, nom long, jonction,
  actions visibles, aucun débordement horizontal. Navigation simulée : panneau
  fermé puis démonté ; réouverture et vide « 0 / Aucune pièce jointe » corrects.
  À 320 px avec pointeur tactile, les trois cibles font 44 × 44 px et ne se
  chevauchent pas. Vue/toucher temporaires restaurés, onglet de lab fermé.

Preuves : [PJ d'une autre page, vide réel](assets/other-page-attachments-empty-dark-1304.jpg),
[PDF d'une autre page, réel](assets/other-page-attachments-filled-dark-1304.jpg),
[sombre desktop](assets/other-page-attachments-dark-1280.jpg),
[clair desktop](assets/other-page-attachments-light-1280.jpg),
[sombre étroit](assets/other-page-attachments-dark-320.jpg),
[clair étroit](assets/other-page-attachments-light-320.jpg),
[vide étroit](assets/other-page-attachments-empty-light-320.jpg),
[tactile](assets/other-page-attachments-touch-light-320.jpg),
[mesures](assets/other-page-attachments-measurements.json).

### Contrôles et livraison

- 5 suites ciblées, **16 tests réussis** : disclosure non actif/indépendance,
  navigation et retour, panneau/actions à la demande, transition, composition
  d'éditeur préservée et présentation compacte.
- Types web réussis ; Biome ciblé sur 7 fichiers sans erreur ; build web réussi
  (8 262 331 octets). `git diff --check` réussi.
- Source courante exposée par HMR sur l'instance existante. Aucun E2E, reset,
  suppression, push ni commit supplémentaire. La page initiale Produit a été
  réactivée, avec les PJ de Livraison ouvertes pour rendre la correction visible.

T022/T023 sont vérifiés. T021 conserve sa limite indépendante concernant la
preuve d'un glisser natif. Pas de nouvelle leçon sans validation du propriétaire.

## Retour — poignée de bloc rectangulaire (2026-10-03)

ui-quality + lessons.md (L-009/012/013), canevas §13 et 017 FR-012.
Correction locale à editor.css et à la classe de la poignée existante ;
AppIcon, ses six cercles et les gestionnaires de menu/drag restent inchangés.

Sur la page du commentaire, le bouton passe de 32 × 32 à 24,66 × 32 px.
Le dessin conserve sa taille ; le retrait supérieur de 7,82 px devient
aussi celui des trois autres côtés (écart maximal mesuré inférieur à 0,01 px).
Le bord du bouton est séparé du texte d'environ 4 px, contre 0 auparavant.
Les mesures incluent les contours peints des cercles, pas seulement le viewBox.

L'éditeur mémoire confirme le même rendu clair/sombre à 1280/320 px,
sans débordement du document. Au tactile, la hauteur existante de 44 px
est conservée et la largeur devient 36,66 px : les quatre retraits valent
13,82 px. Cette exception rectangulaire suit la demande explicite du
propriétaire ; elle n'introduit pas un nouveau dessin d'icône.
Entrée ouvre le menu avec ses commandes, Échap le ferme, sans modification
de contenu. Le retour de focus n'est pas confirmé : la poignée contextuelle
peut disparaître après fermeture. Aucun changement de ses gestionnaires
n'est inclus dans cette correction de géométrie.
À 320 px, la poignée reste visible ; l'ajout adjacent de la fixture est
partiellement hors viewport, comme avant cette correction. Ce placement
étroit reste une limite distincte de la géométrie des six points.

Preuves : [avant](assets/block-handle-before.jpg),
[page corrigée](assets/block-handle-after.jpg),
[sombre 1280](assets/block-handle-dark-1280.jpg),
[clair 1280](assets/block-handle-light-1280.jpg),
[sombre 320](assets/block-handle-dark-320.jpg),
[clair 320](assets/block-handle-light-320.jpg),
[tactile](assets/block-handle-touch.jpg),
[mesures](assets/block-handle-measurements.json).

Types web et build web réussis. Biome ciblé sans erreur (7 avertissements
préexistants dans editor.css) ; diff sans erreur d'espacement.
Aucun test miroir CSS, E2E, reset de données, commit ou push.
La source est visible par HMR sur l'instance actuelle ; seules les fenêtres
de revue mémoire créées pour cette vérification ont été fermées. T024 vérifié.

## Retour — boutons face au texte des titres (2026-10-03)

ui-quality + lessons.md (L-009/012/013), canevas §13 et 017 FR-012.
La mesure de la page signalée révèle un centre des boutons à y=261,
alors que la première ligne du titre est centrée à y=289 (28 px trop haut).
Le middleware utilise maintenant la première portion de texte rendue et
la hauteur réelle du groupe. Les offsets fixes des titres sont retirés ;
les blocs spécialisés, notamment le tableau ancré sur sa grille, gardent
leur placement. Les mesures sont en lecture seule et ne touchent pas
les nœuds ProseMirror. Les proportions/retraits corrigés par T024 restent.

Sur la page réelle, les deux boutons sont centrés à y=289 face au titre,
et y=334 face au paragraphe. Le menu reste aligné lorsqu'il est ouvert par
Entrée, puis se ferme par Échap sans action de contenu. La page et son texte
sont conservés ; aucune navigation ni modification de données utilisateur.

Sur la fixture mémoire enrichie, niveaux 1–4 et titre vide : écart vertical
entre première ligne et chacun des deux boutons inférieur à 0,5 px,
correspondant à l'arrondi du positionnement. Le titre long à 320 px occupe
81,59 px de hauteur, mais les boutons suivent sa première ligne (20 px),
pas le centre du titre complet. Clair/sombre et 1280/320 px vérifiés,
sans débordement du document. La hauteur tactile de 44 px garde le même
centrage. La limite de l'ajout adjacent partiellement hors viewport de la
fixture à 320 px, déjà consignée par T024, n'est pas modifiée ici.

Preuves : [titre avant](assets/block-handle-heading-before.jpg),
[titre corrigé](assets/block-handle-heading-after.jpg),
[sombre 1280](assets/block-handle-title-dark-1280.jpg),
[clair 1280](assets/block-handle-title-light-1280.jpg),
[sombre 320](assets/block-handle-title-dark-320.jpg),
[clair 320](assets/block-handle-title-light-320.jpg),
[mesures fixture](assets/block-handle-title-measurements.json),
[mesures page réelle](assets/block-handle-title-owner-measurements.json).

29 tests réussis dans 2 suites ciblées : première ligne vs titre multiligne,
hauteur des contrôles, texte formaté/emoji, absence de mutation DOM, vide,
bloc spécialisé/masqué et ancrage des tableaux. Types web, Biome ciblé,
build web (8 263 994 octets) et diff vérifiés.
Aucun E2E, reset, commit ou push. Correction visible par HMR dans l'app
courante ; seul l'onglet mémoire temporaire a été fermé. T025 vérifié.

## Pages d’entrée de base et poignée de largeur — FR-015/016, T026–028

Références du propriétaire conservées : `assets/notion-entry-row.png` et
`assets/notion-entry-page.png`. La page réelle d'entrée utilisait un petit h2
et un formulaire pleine largeur, sans titre éditable ni chemin. Elle reprend
maintenant PageTitleEditor et la colonne du workspace, avec propriétés compactes,
menus d'options partagés, relations nommées, puis document ou enfants du dossier.
Brouillons, conflits de révision et validation explicite conservés. Aucun modèle,
API, migration ou commentaire ajouté.

### Preuves de navigateur

- Page réelle avant/après : `assets/database-entry-{before,after}.jpg`.
  La vérification ne modifie ni titre, icône, document, valeur ni largeur dans
  le jeu du propriétaire. Ses propres ajouts de propriétés pendant la revue
  apparaissent normalement dans la projection ; ils sont conservés.
- Poignée réelle avant/après : `assets/database-resize-{before,after}.jpg`.
  Le fond gris était `rgb(48,48,45)` via compatibility.css. Après correction,
  fond transparent et trait `rgb(68,129,216)`, cible toujours large de 8 px.
- Fixture de tableau : `assets/database-resize-{hover,active,keyboard}-lab.jpg`.
  Drag +60 px : 300→360 ; flèche droite : 360→380 ; fond transparent/trait bleu
  pendant le geste et le focus. Seulement l'état mémoire de la fixture change.
- Page remplie clair/sombre : `assets/database-entry-lab-{dark,light}-{1280,320}.jpg`,
  document étroit : `assets/database-entry-document-{dark,light}-320.jpg`.
  Neuf propriétés en lignes de 40 px à 1280 ; à 320, valeurs sous les labels
  (204 px disponibles) ; aucun débordement du document. Les h2 du contenu sont
  ceux de l'éditeur (32 px), sans override de typographie du lab.
  Mesures dans `assets/database-entry-measurements.json`.
- Dossier entrée clair/sombre : `assets/database-folder-entry-{dark,light}-1280.jpg`.
  Propriétés et liste d'enfants partagent le conteneur de lecture de 768 px.
- Menu : `assets/database-entry-option-dark-1280.jpg` et
  `assets/database-entry-touch-option-light-320.jpg`. Entrée ouvre le menu,
  Échap rend le focus au déclencheur (État/Catégories). Choix courants identifiés
  par rôle/check et mêmes pastilles. Cibles tactiles de menu de 44 px ; checkbox
  dans une cible de 44×44 px sans agrandir son dessin.
- Validation : `assets/database-entry-validation-dark-1280.jpg` : `1,2` reste
  saisi et l'erreur est associée au champ. Chargement/échec/réessai/succès :
  `assets/database-entry-{saving,save-error,save-success}-dark-1280.jpg` ; 43 reste
  dans le brouillon après l'échec simulé, puis confirmation locale après réessai.
- Indisponible/vide : `assets/database-entry-{unavailable,empty}-light-320.jpg`.
  Le document reste disponible ; aucun gros bandeau coloré ni contrôle de valeur
  indisponible. L'état vide ne prétend pas que les valeurs distantes sont vides.

La largeur du navigateur intégré ne se propageait pas toujours à l'onglet de
revue en arrière-plan. Les preuves finales de 320 px utilisent les métriques
CDP du seul onglet mémoire et des captures CDP à l'échelle 1, avec largeur DOM
mesurée. La capture native réduisait le composite, elle n'est pas utilisée comme
preuve étroite. Override tactile/métriques nettoyé, dimensions du navigateur
restaurées et onglets de revue temporaires fermés. Les onglets du propriétaire
restent ouverts, dont sa page d'entrée sur l'instance HMR `http://localhost:8080`.

### Contrôles et limites

- 66 tests ciblés passent (EntryPanel, éditeur de valeurs/rôles, table accessible,
  titre canonique, chemin/mesures et lab). Trois nouveaux tests vérifient le slot
  de titre sans doublon, le brouillon de choix conservé après hydratation et la
  sélection de plusieurs relations avant sauvegarde explicite.
- Types web et Biome TS/TSX ciblé : succès. CSS : aucun échec, 40 avertissements
  historiques déjà présents (spécificité/important), aucun avertissement ajouté.
- Build web final : succès, 30 sorties, 20 assets précachés, 8 274 533 octets,
  Bun 1.4.2. `git diff --check` passe.
- Aucun E2E, checks:local, reset, push ou release. Le glisser natif de bloc T021
  reste en attente de sa preuve propre ; cette passe ne le clôture pas.


## Interactions des propriétés — FR-017–019, T029–032

Cette passe remplace les preuves de sauvegarde explicite précédentes : valeurs
et schéma s’enregistrent automatiquement. File de valeurs indépendante par
entrée, fusion des seuls champs modifiés, détection des divergences, brouillon
conservé après erreur et départ de page. L’acquittement d’une ancienne instance
ne peut pas effacer la saisie d’une page rouverte. Les ensembles de choix/liens
suivent l’ordre canonique sans réordonner le brouillon visuel.

### Revue réelle en mémoire

- Configuration/clic droit : [menu](assets/entry-property-context-dark-1280.jpg),
  [configuration](assets/entry-property-settings-dark-1280.jpg). Clic normal et
  Maj+F10, renommage automatique, duplication avec nouvelle identité, menus de
  type et options. Validation du nom vide :
  [320 clair](assets/entry-property-name-invalid-light-320.jpg).
- Recherche/création, changement de couleur et retrait de choix :
  [sélecteur](assets/entry-choice-dark-1280.jpg),
  [couleurs 1280](assets/entry-option-color-dark-1280.jpg),
  [320 sombre](assets/entry-option-color-dark-320.jpg),
  [320 clair](assets/entry-option-color-light-320.jpg).
  Palette de contenu conservée ; options et menus tactiles ont des cibles
  de 44 px. Le jeton long ne fait plus déborder le panneau de 302 px utiles.
- Réordre de source : [pointeur](assets/entry-property-drag-pointer-dark-1280.jpg),
  [clavier](assets/entry-property-drag-keyboard-dark-1280.jpg).
  Trait de destination bleu `rgb(68,129,216)` de 2 px, une écriture au dépôt.
  Échap annule sans écriture ; annonces nommées et focus conservé.
  Poignées rectangulaires au pointeur, 44 px de large au tactile. Les colonnes
  et rôles de tâches conservent leurs identités et leur ordre indépendant.
- Protection avant suppression/conversion :
  [confirmation](assets/entry-property-impact-dark-1280.jpg).
  Annuler reçoit le focus initial ; annulation sans changement du schéma,
  confirmation avec conservation des valeurs incompatibles.
- Sauvegarde/reprise : [busy](assets/entry-autosave-busy-dark-1280.jpg),
  [erreur](assets/entry-autosave-error-dark-1280.jpg),
  [reprise](assets/entry-autosave-recovered-dark-1280.jpg).
  Le statut réserve 24 px. Coordonnée du début de document identique
  au repos et pendant l’écriture : 962,5 px dans la fixture finale.
- [Page finale](assets/entry-properties-final-dark-1280.jpg),
  [320 sombre](assets/entry-properties-dark-320.jpg).
  La page réelle du propriétaire a été inspectée en lecture, avec ses nouveaux
  noms et valeurs conservés. Aucun bouton Enregistrer sur ces pages.

## Icônes de propriétés — FR-020, T033–036

`icon` facultatif sur la propriété source ; même catalogue/sélecteur que les
vues, recherche et retrait automatiques. Les en-têtes de table, pages d’entrée
et labels de cartes/liste utilisent le même renderer. Sans choix ou avec un
identifiant absent du catalogue local, le symbole du type reste lisible.
Le réglage ne change ni type, valeurs ni options. Anciennes définitions valides ;
aucune migration SQL ni remise à zéro. Révision, stockage local et mutation de
sync restent chiffrés. Le retrait est un null explicite.

### Preuves et contrôles

- Palette partagée : [1280 sombre](assets/property-icon-picker-dark-1280.jpg),
  [1280 clair](assets/property-icon-picker-light-1280.jpg),
  [320 sombre](assets/property-icon-picker-dark-320.jpg),
  [320 clair](assets/property-icon-picker-light-320.jpg).
  La grille avait hérité du padding des boutons historiques : ses 350 px
  débordaient les 270 px utiles. Padding explicite et colonnes minmax corrigent
  le sélecteur partagé (270 px de contenu/scroll désormais), sans nouvelle palette.
- Accès de source vérifiés dans la vraie base, sans choisir d’icône ni modifier
  ses données : [réglages de vue](assets/property-icon-source-settings-light-1280.jpg)
  et [panneau de schéma](assets/property-icon-schema-settings-light-1280.jpg).
  Le sélecteur commun est disponible sur les deux accès, y compris le titre.
- Recherche sans résultat : [état vide](assets/property-icon-empty-dark-1280.jpg).
  Choix « ampoule » par Entrée et par toucher : affichage immédiat dans la
  ligne, sans sauvegarde des valeurs. Retrait : retour à Aa pour le texte.
  Échap ferme la palette et rend le focus à « Changer l’icône de Texte » ;
  la configuration reste ouverte. Échap suivant retourne au libellé de propriété.
- À 320 px : document de 320 px, palette de 296 px, pas de débordement,
  déclencheur 44×44 px, choix 52,4×52,4 px au tactile. Deux thèmes vérifiés.
  [Mesures et focus](assets/property-icon-measurements.json). Les deux onglets
  temporaires de revue sont fermés ; overrides tactiles/métriques nettoyés,
  dimensions du navigateur restaurées et onglets du propriétaire conservés.
- Tests ciblés : 97 tests Web (11 suites), 30 domaine/contrat (3 suites),
  17 client-core (1 suite) réussis : icône facultative, borne/format, schéma
  ancien, choix/retrait, renderer/fallback, conservation après type/duplication,
  fusion avec renommage concurrent et redémarrage du stockage scellé/outbox.
- Types domaine, contrats, web, API et client-core réussis. Biome ciblé :
  28 fichiers TS/TSX sans erreur (deux avertissements historiques de
  types void dans DatabasePage) ; database.css conserve ses avertissements
  historiques, sans erreur. Build web : 30 sorties, 20 assets précachés,
  8 309 275 octets, Bun 1.4.2. `git diff --check` réussi.
- E2E/checks:local et publication restent différés à la demande du propriétaire.
  Ces contrôles ciblés ne constituent pas une validation de release. L’instance
  courante reste celle de ce checkout, avec HMR ; données du propriétaire
  préservées. T021 (glisser natif de bloc) conserve sa limite précédente.

## Retour — clic sur propriété et champ composé (FR-018/021, T037–039)

- La précision du propriétaire remplace l’ancien parcours « clic → configuration » :
  clic normal, clic droit et Maj+F10 ouvrent les mêmes actions. Le menu reçoit
  le focus sur Renommer ; flèches et Échap fonctionnent, avec retour au libellé.
  Renommer/Modifier ouvrent ensuite la configuration et ses sauvegardes automatiques.
  Confirmé aussi sur la page signalée, sans modifier ses valeurs ni son schéma.
- Diagnostic réel avant correction : recherche avec outline propre alors que
  son conteneur ne portait qu’une bordure basse ; croix hors de la pastille.
  `InputSurface` + `NativeInput` possèdent maintenant une seule surface et un
  focus neutre. Les anciens styles locaux des trois recherches ont été retirés ;
  NativeInput est exclu de la compatibilité historique. La palette reste identique.
- Preuves mémoire : [menu](assets/entry-property-click-menu-dark-1280.png),
  [champ sombre](assets/entry-choice-unified-dark-1280.png),
  [détail](assets/entry-choice-unified-detail.png),
  [multiple long tactile](assets/entry-choice-unified-multiple-dark-320.png),
  [clair étroit](assets/entry-choice-unified-light-320.png),
  [vide](assets/entry-choice-unified-empty-light-320.png).
  À 320 px : document de 320 px, popup de 304 px dans les marges, champ de
  286 px ; deux boutons de retrait de 44 px, croix contenues dans leurs pastilles.
  Le libellé long s’abrège sans masquer sa croix. Retirer le premier conserve
  le second et la recherche « zz sans résultat », focus dans la saisie ; retirer
  le dernier laisse un vrai champ vide. Création et enregistrement sont isolés
  dans la fixture mémoire, sans appels de mutation sur les données du propriétaire.
- Deux autres usages : [icônes](assets/shared-input-icon-search-light-1280.png),
  [propriétés de source](assets/shared-input-property-search-light-1280.png),
  [panneau étroit](assets/shared-input-property-search-dark-320.png).
  Recherche réelle des propriétés inspectée sans changement de contenu :
  bordure unique, input sans border/outline ; champ de 267,625 px et hauteur
  tactile de 44 px, document sans débordement à 320 px. Guide UI mis à jour
  avec API, composition et propriétaires CSS ; aucune nouvelle leçon validée
  avant la revue du propriétaire.
- Contrôles ciblés : 50 tests Web, cinq suites (interactions de propriétés,
  autosave d’entrée, page de base, table, lab) réussis ; types Web et build Web
  réussis. Build : 30 sorties, 20 assets précachés, 8 310 606 octets, Bun 1.4.2.
  Biome sur les dix fichiers TS/TSX/CSS communs modifiés : aucune erreur ni
  avertissement. database.css : aucune erreur, 39 avertissements historiques
  de spécificité/important conservés ; diff whitespace sans erreur.
- E2E et checks:local restent différés, aucun push ni commit. La passe ne
  revendique pas une réécriture de tous les champs de l’app ni une validation
  de release. HMR actif sur localhost:8080 ; onglets temporaires et émulations
  nettoyés, données conservées. T021 conserve sa limite documentée.

## Validation automatisée autorisée — 2026-10-03

Le propriétaire valide l'état UI puis demande un commit de sauvegarde, la remise
à niveau de tous les tests unitaires/E2E et le suivi de la PR jusqu'à une CI
réussie. Les reports d'E2E/push consignés plus haut sont historiques.
Sauvegarde : `3ac40b2e`. Les bases, fichiers et clés des suites sont jetables ;
l'instance localhost:8080 et son PostgreSQL sur 5432 ne sont pas réinitialisés.

### Contrôles intermédiaires

- Couverture complète : 479 fichiers réussis, 5 060 tests réussis et deux tests
  réservés à Windows. Budgets absolus inchangés ; les cas ajoutés couvrent
  chiffrement, refus atomiques, sources, export, fusion et stockage hors ligne.
- Intégration serveur : 38 fichiers, 375 tests réussis sur PostgreSQL jetable.
- Types de tous les packages réussis. Ces résultats intermédiaires ne remplacent
  pas `checks:local` sur le commit exact avant chaque push.
- Chromium desktop, premier corpus complet après adaptations : 281 réussis,
  17 échecs à corriger, 12 exclusions de profils explicites. Les échecs ne sont
  pas effacés du bilan : changements de parcours, références visuelles anciennes
  et régression de pagination. Les relances ciblées sont en cours.

### Preuves réelles conservées

- [Preview native de bloc](assets/validation-native-block-drop-preview-chromium.png) :
  trait bleu saturé dans la colonne active, autre éditeur masqué ; dépôt persistant
  et annulation contrôlés par le parcours. La limite historique de T021 est levée.
- [Champ composé](assets/validation-composite-property-input-chromium.png) :
  pastille et croix contenues dans la même saisie, recherche et retrait conservés.
- [Ordre des propriétés](assets/validation-ordered-entry-properties-chromium.png) :
  en-tête canonique, lignes compactes et poignée clavier ; ordre indépendant des
  colonnes. Captures issues de données E2E jetables, inspectées visuellement.

Les variantes de texte/remplissage d'accent corrigent le contraste en clair,
sans modifier les couleurs de contenu. Les images de référence sont comparées
au rendu accepté avant tout remplacement ; aucune mise à jour aveugle ni hausse
de tolérance. La validation complète et les références PR/CI seront ajoutées
après réussite des contrôles, sans déclarer les tâches restantes terminées.

### Références visuelles et derniers écarts E2E

Les anciennes références montraient encore « Ajouter une base », une base en
pied d'éditeur et l'ancien bouton permanent d'ajout d'icône. Ces comportements
ont été remplacés sur demande du propriétaire. Après comparaison des images
attendues/reçues (macOS et Linux séparément), les références de recherche, base
vide, canevas clair/sombre et sécurité mobile Linux sont actualisées. Aucun seuil
de différence n'est relevé. Le rejeu Linux sans retry confirme 8 captures réussies
et 8 exclusions réservées à l'autre viewport (`visual-linux-03.log`).

Les parcours ont aussi révélé un déplacement physique du bouton d'entrée lors
d'une largeur distante et une consommation prématurée de la demande de focus,
avant le départ vers l'entrée. La cible est désormais figée pendant le geste,
jusqu'au clic natif (le relâchement ailleurs annule toujours), et le focus est
demandé au retour. La carte de conflit et sa table défilante ont des noms
accessibles distincts. Le rejeu complet reste requis.

Les captures `assets/validation-column-order-{light,dark}-{1280,320}.png`
montrent les actions partagées de réordonnancement dans les paramètres de vue,
sans débordement du panneau ni modification de l'ordre de la source.

Le rejeu Chromium bureau ciblé (`e2e-chromium-focus-10.log`, projet bureau)
confirme 10 réussites : reprise/reconciliation/résolution hors ligne, propagation
structurée, annulation/activation pendant une largeur distante, retour/focus
après 1 001 entrées, et six références visuelles. La preuve
`assets/validation-large-table-return-chromium.png` montre la dernière entrée
visible, la bonne page source et le total chargé. Ce diagnostic a été arrêté
pendant sa partie mobile après identification d'un blocage du dialogue de
création par le tiroir ouvert ; il ne constitue pas un gate complet.

La création d'une base depuis le tiroir le ferme désormais avant d'ouvrir le
dialogue. Annuler rouvre la navigation ; créer ouvre la page de base. Le parcours
dédié couvre clic réel, Échap et retour au tiroir, sans interaction forcée.

Le diagnostic mobile suivant (`e2e-chromium-mobile-focus-11.log`) confirme
11 parcours réussis et 6 exclusions de captures réservées au bureau. Son seul
échec est la référence macOS de sécurité mobile, encore antérieure au champ
et au bouton partagés. L'image reçue est comparée et adoptée à seuil constant,
avec sa propre adresse de fixture macOS. Le contrôle complet ci-dessous devra
confirmer toutes les références et tous les moteurs sur le commit exact.

### Contrôle complet — première tentative

Commit `537b609a` : contrôles de code et couverture réussis (480 fichiers,
5 065 tests réussis, deux exclusions propres à Windows ; budgets inchangés).
Les requêtes des cinq formats de base respectent leur seuil, ainsi que la
propagation structurée. Le stress de 10 000 opérations échoue sur une assertion
qui compte encore les adhésions dans `databaseEntries`, remplacée par
`databaseEntryPairs`. Le benchmark est adapté au stockage canonique actuel,
vérifie l'ensemble exact des identités survivantes et l'absence de doublon
historique, à volume et seuil identiques. Cette tentative n'autorise aucun push.

### Contrôle complet — deuxième tentative

Commit `4dbe8a59` : code/types/couverture réussis (480 fichiers, 5 065 tests,
deux cas réservés à Windows), neuf budgets de performance réussis, 375 tests
d'intégration, 13 tests de migration et 1 860 tests de contrat réussis.
Chromium bureau termine avec 299 réussites et 12 exclusions de profils ;
Firefox Linux termine avec 285 réussites et 26 exclusions explicites.

Chromium mobile révèle deux échecs : contraste rouge sur le fond de survol
clair du dialogue de conversion et ancien parcours de confidentialité cliquant
derrière un panneau resté ouvert. La tentative est interrompue après ces
diagnostics : 205 réussites mobiles, 16 exclusions et 88 cas non exécutés ;
WebKit bureau est interrompu dans sa troisième tranche, WebKit mobile ne démarre
pas. Cette tentative ne valide pas la matrice ni les gates suivantes.

Les scans indépendants révèlent 15 alertes hautes de dépendances et une erreur
de lecture du lien Git `.codex` (pas un secret détecté). La lecture du lien
porte désormais sur son chemin stocké, sans lire une cible non suivie ; les
fichiers référencés et suivis restent contrôlés. Quatre tests de contrat passent.
Les dépendances sont corrigées dans leurs majeures courantes ; `bun ci` réussit
sur le lock gelé, l'audit ne trouve plus d'alerte haute/critique (cinq alertes
sous le seuil restent rapportées) et le scan des secrets réussit sans exception
de chemin ajoutée. Les analyses statique et de licences précédentes réussissent
également, mais toutes seront rejouées sur le prochain commit exact.

Rejeu ciblé mobile `e2e-mobile-focus-12.log` : deux parcours réussis, dont les
audits du dialogue ouvert et réellement survolé. La capture inspectée
[conversion au survol en clair](assets/validation-conversion-hover-light-mobile.png)
conserve fond neutre, texte/contour rouges et commandes lisibles. Le rouge de
base et la palette des propriétés sont inchangés. Ces résultats ciblés
confirment les corrections ; ils ne remplacent pas le contrôle complet requis.

### Contrôle complet — troisième tentative

Commit `8a9b2722` : 481 fichiers et 5 069 tests de couverture réussis (deux cas
réservés à Windows), neuf budgets de performance, 375 tests d'intégration,
13 tests de migration et 1 864 tests de contrat réussis. Chromium bureau
termine correctement. Firefox révèle un échec intermittent à l'ouverture du
formulaire de propriété ; sa relance réussit mais `--fail-on-flaky-tests` reste
bloquant. La tentative est interrompue pendant Firefox/WebKit bureau ; les
profils mobiles et les gates suivantes ne sont pas validés par cette tentative.

La trace est reconstruite avec ses références de nœuds : le tableau et son
bouton restent présents. Le statut transitoire d'actualisation était toutefois
placé avant les actions. T053 le déplace après la vue et ajoute une observation
de connexion/position pendant le clic réel, tout en conservant le scénario
qui agit avant la fin de création/synchronisation.

Le scan indépendant de l'image API exacte `8a9b2722` avec Trivy 0.70.0 et sa
base du 3 octobre réussit au seuil CI (HIGH/CRITICAL corrigibles, secrets).
Le rapport complet conserve aussi les alertes sans correctif ; il ne constitue
pas une déclaration d'absence de toute vulnérabilité. Les huit tests unitaires
d'interaction des propriétés passent après T053.

Rejeu ciblé `e2e-property-stability-13.log` : 40 parcours Chromium bureau et
40 parcours Firefox Linux réussissent, sans relance autorisée (`--retries=0`).
L'observation du clic vérifie le même bouton connecté et un déplacement d'au
plus un pixel ; les deux variantes conservent validation et annulation du
formulaire. Les captures de la trace au repos gardent la présentation compacte
du tableau. Ce résultat ne remplace pas la prochaine matrice complète.

### Validation complète — tentative 04, commit 95460cd2

Les contrôles précédant les E2E passent : 5 069 tests de couverture (2 exclusions Windows), 9 benchmarks, 375 tests d’intégration, 13 de migrations et 1 864 de contrats. Couverture : statements 91,72 %, branches 86,33 %, functions 94,37 %, lines 92,82 %. Aucun budget modifié. Chromium desktop et mobile, ainsi que les trois shards WebKit desktop passent. Firefox échoue sur un locator supposant une seule référence de fichier, alors que placement et bloc sont deux usages. WebKit mobile échoue deux fois sur la dernière entrée de 1 001 lignes, absente du DOM malgré le compteur chargé ; son troisième shard n’est donc pas exécuté. La matrice complète reste rouge.

Après les navigateurs, les gates suivantes exécutées séparément sur ce même commit passent : desktop, build, images amd64/arm64 et restauration réelle de sauvegarde, audit, secrets, analyse statique, licences et compose. Trivy 0.70.0 sur l’image ARM candidate de ce commit passe le seuil HIGH/CRITICAL corrigibles ; le rapport SARIF complet conserve les vulnérabilités sans correctif. Cela ne remplace pas un checks:local complet réussi après T054/T055. Logs locaux ignorés : checks-local-04.log, post-e2e-gates-04.log et trivy-gate-04.log.

### Corrections T054–T056 et virtualisation

La référence du fichier n’est pas seulement un problème de locator : le panneau PJ peut rester monté pendant que le serveur reçoit le bloc. L’ouverture de ses détails réactualise maintenant les usages, sans retirer sa liste locale. Le test vérifie placement et bloc depuis une autre page, puis la navigation et la fermeture de l’inspection. Six tests du panneau passent, dont le passage réel d’un à deux usages dans le composant.

Le tableau pleine page observait son conteneur horizontal non borné. `useTableViewport` résout le véritable scrollport vertical, mesure l’origine du tbody et l’en-tête, se désabonne au démontage et ignore les surfaces masquées. Cinq tests couvrent pleine page/intégré/borné, défilement, changement de géométrie et lifecycle. La surface de page conserve son étendue calculée pendant les remplacements de rangées, car WebKit peut borner son scroll pendant les retraits DOM intermédiaires. Le parcours conserve le clic automatique natif sur la pagination ; les essais de désactivation des ajustements du moteur et de pré-défilement explicite ne sont pas retenus. Le bouton d’entrée de 32 px est intégralement visible à l’intérieur des bordures fusionnées.

Rejeu ciblé `e2e-viewport-10.log` : Safari Linux desktop et mobile passent sans nouvelle tentative, 1 001 lignes chargées, moins de 100 rangées physiques, dernière entrée ouverte puis retour avec focus et visibilité intégrale. Captures réellement examinées : [desktop clair](assets/validation-large-table-webkit-desktop-light.png), [mobile clair](assets/validation-large-table-webkit-mobile-light.png). Le look reste celui de la table existante ; aucune nouvelle surface colorée. Ces preuves ne remplacent pas la prochaine matrice complète.

Le rejeu final ciblé `e2e-viewport-final-11.log` passe sur les cinq profils en 309 s : 20 parcours, deux répétitions par cas/profil, zéro retry. 33 tests unitaires ciblés et les types passent également. Le contrôle complet suivant inclut aussi une capture sombre de la dernière entrée avec vérification de conservation du focus ; il reste à exécuter avant publication.

### Validation complète — tentative 05, commit 133230f7

Code, types et couverture passent : 482 fichiers, 5 075 tests réussis et deux cas réservés à Windows. Les neuf fichiers de benchmarks, 375 tests d’intégration, 13 de migrations et 1 864 de contrats passent. Chromium révèle deux échecs de créations consécutives : après un retour d’entrée, une actualisation de projection réinitialise la tentative de focus et ferme le nouveau champ par blur. La matrice est interrompue pour corriger ce défaut ; aucun profil complet ni gate ultérieur n’est validé par cette tentative.

T057 conserve le cycle de retour pendant les changements de disponibilité de la projection, y compris la cible précédente et l’intention de focus du propriétaire. Le test unitaire reproduit d’abord l’échec sur l’ancien code (`unit-return-focus-red-01.log`). Les deux variantes, avant première disponibilité et après interruption d’un retour commencé, passent avec la correction ; une demande encore présente ne vole pas de nouveau le focus, et une nouvelle demande pour la même entrée reste possible. Les 29 tests ciblés d’interaction, tableau et géométrie passent (`unit-return-focus-green-02.log`). Le rejeu E2E sur les cinq profils reste à confirmer avant le prochain contrôle complet.

Le rejeu `e2e-return-focus-14.log` passe : six parcours par profil, soit 30 réussites sur les cinq profils en 426 s, deux répétitions, zéro retry. Il conserve créations consécutives, propriétés/colonnes/vues partagées sur deux appareils, board/galerie/calendrier et chargement/retour après 1 001 lignes. Les vérifications de focus/visibilité et les captures sombres passent aussi. Preuves réellement examinées : [Chromium sombre](assets/validation-large-table-chromium-desktop-dark.png), [WebKit bureau sombre](assets/validation-large-table-webkit-desktop-dark.png), [WebKit mobile sombre](assets/validation-large-table-webkit-mobile-dark.png). Les types passent. Ce résultat ciblé confirme la correction ; le prochain checks:local complet reste obligatoire avant le push.

### Validation complète — tentative 06, commit 3f180924

Code, types et couverture passent : 482 fichiers et 5 077 tests réussis, deux cas réservés à Windows. Les neuf fichiers de benchmarks, 375 tests d’intégration, 13 de migrations et 1 864 de contrats passent. Chromium bureau (299 réussites, 12 exclusions), Firefox bureau (285/26), Chromium mobile (287/24) et les trois shards WebKit bureau (285/26) passent sans échec ni réussite obtenue après retry. WebKit mobile révèle un dépôt clavier intermittent dans le parcours des propriétés ; sa relance passe, mais le contrôle reste bloquant. La passe est interrompue : WebKit mobile et les gates suivantes ne sont pas validés.

La trace conservée dans `work/test-readiness/checks-local-06-artifacts/` montre une transformation de 2 px au moment du dépôt, sans repère sur la destination. Le test attendait seulement une transformation positive pendant le défilement clavier progressif ; il déposait donc avant d’atteindre la deuxième ligne. T042/T044 renforcent le parcours : attendre le repère bleu `after` et l’annonce « Après Team. », vérifier Échap et l’ordre conservé, puis effectuer un deuxième déplacement avec sa destination confirmée avant le dépôt. Le geste reste clavier natif, les délais et seuils restent identiques et le comportement de production n’est pas modifié. Le rejeu répété des cinq profils reste requis avant le prochain contrôle complet.

Le scan local indépendant de l’image ARM exacte `3f180924`, avec Trivy 0.70.0 et sa base du 3 octobre, passe au seuil HIGH/CRITICAL corrigibles. Le rapport SARIF complet conserve 46 alertes sans correctif. Ce résultat de sécurité ne remplace pas le contrôle complet après la correction du parcours.

Le rejeu `e2e-property-drop-15.log` passe sur les cinq profils en 316 s : 50 parcours (dix répétitions par profil), zéro retry. Chaque répétition vérifie le repère/annonce de destination, l’annulation sans changement d’ordre, le dépôt persistant après rechargement et l’ordre indépendant des colonnes. Les types de tous les packages, Biome sur le test et le contrôle des espaces passent. Ce résultat ciblé confirme la correction du scénario ; le prochain contrôle complet reste obligatoire.

### Validation complète — tentative 07, commit 4b97dec4

Code/types/couverture passent : 482 fichiers, 5 077 tests réussis, deux cas Windows réservés à la CI native. Couverture : 91,72 % statements, 86,33 % branches, 94,37 % functions, 92,81 % lines ; budgets inchangés. Les neuf suites de performance, 375 tests d’intégration, 13 de migrations et 1 864 de contrats passent. Chromium bureau termine avec 299 réussites et 12 exclusions explicites. La passe est interrompue lorsqu’un autre échec intermittent apparaît sur WebKit bureau ; Firefox est interrompu, les profils mobiles ne démarrent pas. Les gates ultérieures ne sont pas validées par cette passe.

Cet échec précède le glisser : le champ de nom garde « Notes » immédiatement après l’action de remplissage, puis Entrée ne produit aucun renommage. La trace conservée dans `work/test-readiness/checks-local-07-artifacts/` ne montre pas de nouvelle valeur dans le champ. T042/T044 ajoutent donc les assertions de disponibilité réelle : le panneau doit donner le focus au nom, puis la saisie doit apparaître dans le champ avant de contrôler sa sauvegarde automatique. Aucun délai arbitraire, relance interne ou affaiblissement d’assertion. Le rejeu répété est requis pour confirmer cette correction du scénario.

Trivy 0.70.0 sur l’image ARM exacte `4b97dec4` passe le seuil HIGH/CRITICAL corrigibles ; le rapport complet conserve 46 alertes sans correctif. Le scan et les résultats partiels ci-dessus ne remplacent pas le prochain contrôle complet.

### Saisie native et rendu concurrent — T042/T044

Le rejeu `e2e-property-focus-16.log` révèle encore un échec parmi 100 parcours (WebKit mobile) : le focus est confirmé mais la valeur reste « Notes » après le remplissage. Les assertions de focus seules ne constituent donc pas une correction. Le diagnostic temporaire instrumenté (`e2e-property-name-probe-18.log`, 40 parcours WebKit bureau/mobile réussis) n’a pas reproduit l’échec et ne prouve pas sa causalité ; ses listeners/observateurs sont retirés du test maintenu.

Le test unitaire `property-name-draft.spec.tsx` reproduit en revanche une perte déterministe : le navigateur remplace le nom, un rendu concurrent précède l’événement `input`, et le champ contrôlé remet « Notes ». `property-name-draft-red-01.log` échoue sur cet unique cas, les cinq autres passent. Le composant conserve maintenant la valeur native et suit l’événement `input`, en adoptant explicitement les noms source lorsque le champ est propre. `property-name-draft-green-02.log` passe : 18 tests de brouillon, configuration asynchrone et interactions. Les six nouveaux cas couvrent aussi les mises à jour source, pause/Entrée sans double sauvegarde et noms invalides. Aucun style ni seuil de test modifié. Le rejeu navigateur et le prochain contrôle complet restent nécessaires.

Le rejeu `e2e-property-name-final-19.log` passe sur les cinq profils : 50 parcours (dix par profil), zéro retry, 296 s. Il conserve le contrôle de focus/valeur avant Entrée, configuration directe, choix/retrait d’icône et d’option, annulation/dépôt clavier et persistance indépendante des colonnes. Les types et Biome passent. Les captures Chromium bureau et WebKit mobile du champ composé et des contrôles de propriété sont examinées : ces contrôles conservent leur style ; la capture de panneau mobile défilé comprend le chrome sticky et n’est pas une référence de mise en page complète. Le diagnostic temporaire a été retiré. Le prochain checks:local complet reste obligatoire avant publication.

### Contrôles complets 08 et 09 — b671cb0e

La passe 08 échoue sur quatre suites PostgreSQL (timeouts de connexion et hooks) ; `TEST_DATABASE_URL` n’était pas fixé et Vitest utilisait ses conteneurs éphémères. Le rejeu avec le serveur de test dédié 55432 passe les quatre suites, 49 tests (`postgres-connectivity-20.log`), sans modifier assertions ni délais. L’instance du propriétaire sur 5432 reste intacte.

La passe 09 fixe aussi `TEST_DATABASE_URL`. Couverture : 483 fichiers réussis, deux exclus Windows, 5 083 tests réussis et deux exclus ; 91,72/86,33/94,37/92,81 % (statements/branches/functions/lines). Les neuf suites de performance, 375 intégrations, 13 migrations et 1 864 contrats passent. Chromium bureau/mobile, Firefox bureau et les trois parties WebKit bureau passent ; le renommage de propriété passe aussi sur WebKit mobile. Ce dernier profil échoue sur « Tableau simple » du menu de blocs (`rich-page.spec.ts`). La matrice est interrompue après quatre profils réussis ; les contrôles qui suivent les E2E n’ont pas été exécutés. Ce résultat est partiel, sans push.

Convergence ciblée : deux exigences FR-005/006, US2/AC2, deux décisions du plan (contrôles et scroll local) et principes III/V/VI/VII revus ; un écart partial de priorité HIGH, T058. Les diagnostics 21/22 reproduisent le défaut isolé. La mesure 22 conserve 120 frames : menu 246 px de haut, scrollport 244 px, contenu 309 px ; l’option devient visible après scrollTop 65 puis sort du menu quand scrollTop revient à zéro. Les traces sont conservées sous `work/test-readiness/` ; aucune donnée du propriétaire n’est utilisée.

T058 : les diagnostics 23/24 conservent les mêmes nœuds et sélection ; aucun setter JavaScript ni `scrollIntoView` de l’app ne ramène la liste en haut. Les essais 25 (sans annonce de sélection) et 26 (liste en block) échouent encore ; ils sont retirés. Le parcours original passe avec la stratégie fixe de Floating UI (`e2e-rich-menu-fixed-27.log`). Les neuf tests unitaires de commandes/menu et le typage passent.

Le rejeu 28 passe quatre profils et les deux compositions WebKit mobile ; le nouveau parcours supplémentaire échoue sur ce dernier moteur. Sa préparation rapide par plusieurs Entrée produit une projection encore en actualisation et la capture d’élément tente de défiler. Le rejeu 29 confirme que les événements clavier seuls ne suffisent pas à stabiliser ce scénario. Le test maintenu isole donc l’état de menu sur un paragraphe enregistré, conserve le focus courant, puis contrôle filtre, bornes du viewport, sélection révélée au clavier, Échap, réouverture et clic natif sur la dernière option sans pré-défilement. Le parcours original de composition continue de vérifier insertion, ordre et stockage durable. Le rejeu 30 passe cinq parcours WebKit mobile (deux thèmes × 320/1280, plus composition), 42 s, zéro retry. Les quatre captures de viewport stabilisées sont disponibles ; clair 320 et sombre 1280 examinés, surface opaque, texte lisible, menu dans le viewport et contenu de page conservé. Le rejeu final complet ciblé puis checks:local restent requis.

Le rejeu final `e2e-slash-menu-final-31.log` passe les cinq profils : 50 parcours (deux répétitions × cinq scénarios × cinq profils), zéro retry, 175 s. Le scénario original de composition est inclus. Types et Biome passent. Les captures stabilisées Chromium bureau et WebKit mobile sont conservées dans `assets/e2e-slash-menu-<profil>-<thème>-<largeur>.png` pour chaque combinaison clair/sombre, 320/1280 px. Revue : surface opaque et bornée, textes lisibles, choix final visible au clavier, contenu derrière conservé ; aucun changement de CSS, d’ordre ou de densité du menu. Le prochain contrôle complet sur le commit exact reste obligatoire avant push.

### Contrôle complet 10 — 00312375

La couverture échoue sur les deux assertions d’inventaire E2E de `test-impact.spec.ts` : le nouveau fichier n’a pas été déclaré dans `ci/test-impact.json`. Les 482 autres fichiers passent, 5 081 tests réussis et deux exclus Windows ; aucune matrice ni gate ultérieure lancée. T044/T058 ajoutent le parcours et ses propriétaires (éditeur, workspace, système UI et document/page-state), avec quatre contrôles de sélection dans le contrat d’impact. Le test d’inventaire/impact passe après correction ; assertions et sélection des cinq profils sont conservées. Le prochain contrôle complet portera sur le nouveau commit.

### Contrôle complet 11 — réussite sur 69cec828

`checks:local` termine avec code de sortie 0 sur le commit exact
`69cec828eed0eb16a3bff45f4bc7ce35bef289ca`, arbre propre avant publication.
`DATABASE_URL` et `TEST_DATABASE_URL` visent tous deux PostgreSQL de test 55432.
L'instance du propriétaire (proxy, web, API et PostgreSQL 5432) reste en place,
saine et non réinitialisée. La sauvegarde UI acceptée reste `3ac40b2e`.

| Contrôle | Résultat |
| --- | --- |
| Toolchain, shell, format/lint, types | Réussis ; Bun 1.4.2, seuils inchangés |
| Corpus sous couverture, unitaires/propriétés/intégration/contrats | 483 fichiers et 5 087 tests réussis ; deux cas réservés à Windows |
| Couverture du code éligible | 91,72 % statements, 86,33 % branches, 94,37 % functions, 92,81 % lines |
| Budgets de performance, sans instrumentation | Neuf suites, 22 tests réussis |
| Intégration / migrations / contrats, runners séparés | 375 / 13 / 1 868 tests réussis ; ne pas additionner ces rejeux au corpus précédent |
| Desktop natif macOS ARM | Build, package, lancement installé et neuf parcours réussis |
| Production et images | Builds réussis ; API/web construits pour AMD64 et ARM64 |
| Restauration native ARM en image | Historique SQL, séquence, blobs, préfixe d'upload, répétition et activation réussis |
| Audit dépendances | 427 packages contrôlés, aucun problème au seuil HIGH/CRITICAL, cinq alertes sous ce seuil |
| Secrets / analyse statique / licences | 1 830 fichiers sans finding / 1 309 sources sans finding / 431 packages conformes |
| Compose | Services, ports loopback, secrets, images et temps réel validés |

Matrice web complète : cinq profils réussis en 2 696 s, **1 456 réussites**,
119 exclusions conditionnelles de plateforme déjà prévues. Aucun nouveau skip,
clic forcé, budget abaissé ou réussite après retry. Sur macOS, les profils
Firefox/WebKit utilisent le runtime Linux épinglé documenté ; les trois parties
WebKit exécutent ensemble le corpus complet.

| Profil | Réussites | Exclusions conditionnelles |
| --- | ---: | ---: |
| Chromium desktop | 303 | 12 |
| Firefox desktop | 289 | 26 |
| WebKit desktop | 289 | 26 |
| Chromium mobile | 291 | 24 |
| WebKit mobile | 284 | 31 |

Les neuf parcours desktop s'ajoutent à la matrice web ; ils couvrent notamment
onboarding, fichier natif, mise à jour vérifiée et reprise hors ligne après arrêt
du processus. Les deux cas unitaires Windows et les parcours natifs des autres
OS/architectures restent à confirmer par la CI.

Trivy 0.70.0 sur l'image ARM du même commit passe le seuil HIGH/CRITICAL
corrigibles ; son rapport conserve 46 résultats sans correctif. Logs locaux
ignorés : `checks-local-11.log`, `checks-local-11-e2e-logs/`,
`trivy-image-build-09.log`, `trivy-gate-09.log`, `container-scan-09.sarif`.
Limite de l'archive 11 constatée lors de la tentative 14 : son fichier
Chromium a été copié après le parcours desktop et contient ses neuf résultats,
pas les 303 parcours web. Le log complet 11 conserve la réussite 5/5 de la
matrice ; les quatre autres archives web sont intactes. À partir du contrôle
14, chaque log web est copié dès la fin de son profil, avant sa réutilisation.

Les états UI et captures associés à T040–044/T046–058 sont revus dans les
sections précédentes : clair/sombre, largeur étroite, gestes natifs, sauvegarde,
focus/retour, défilement et erreurs. Les tâches d'implémentation correspondantes
sont closes après cette réussite. Publication du commit testé sur la
[PR 180](https://github.com/enzofrnt/MyOwnNotion/pull/180) ;
[CI initiale](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37161560744)
en cours. T045 n'est pas encore clos ; aucune fusion.

### CI initiale — écart natif de contraste, T059

La CI `37161560744` sur `69cec828` échoue sur le même avis conditionnel du
workspace sous Electron Linux AMD64, Linux ARM64, Windows x64 et Windows ARM64. Les audits
rapportent `summary > span`, « 1 alerte », texte `#D56C5E` sur `#FCEBEA`,
2,96:1 pour 15 px, au lieu de 4,5:1. Chaque retry échoue aussi. La capture Linux
ARM est examinée : avis présent, surface de page conservée, texte peu contrasté.
Les traces/logs sont conservés sous `work/test-readiness/ci-180-*-artifacts/`.
T059 est ajouté en convergence pour FR-007 et US1/AC3 ; T045 reste ouvert.
La réussite locale du contrôle 11 ne valide pas cet état natif clair manquant.


### T059/T060 — correction et vérification ciblée

Le parcours de sauvegarde existant produit un vrai avis périmé, puis audite le
résumé fermé et le panneau ouvert au clavier dans les deux thèmes, à 320 et
1 280 px. Avant correction, `e2e-notice-contrast-red-32.log` échoue sur l'audit.
La correction réutilise `--ui-color-danger-text` sur `--ui-color-canvas` : le
rouge de la palette reste inchangé et l'avis reste présent. Un fond danger doux
ne suffit pas dans le thème sombre ; le canvas neutre conserve le contraste du
texte. L'audit Electron existant contrôle maintenant workspace et réglages dans
les deux thèmes, sans retirer son analyse globale.

Le rejeu `e2e-notice-contrast-green-33.log` passe les cinq profils, sans retry,
49 s. Le rejeu natif macOS `e2e-notice-desktop-green-34.log` passe les deux
parcours d'accessibilité, 7 s. La sélection CI du parcours d'avis est contrôlée
pour ses trois propriétaires supplémentaires : 45 tests de politique/impact
réussis (`notice-impact-02.log`).

La revue des premières captures révèle cependant un chevauchement à 320 px :
la cible réelle du bouton de navigation mesure 44 px, alors que le gutter de
l'en-tête compact n'en réservait que 32 et dépendait de l'état desktop. Le test
de géométrie échoue avant correction (`e2e-welcome-overlap-red-35.log`). T060
réserve la cible réelle et son espacement dans tous les en-têtes mobiles,
y compris derrière le tiroir, sans réduire la cible ni modifier le bureau.

Le rejeu final `e2e-notice-welcome-green-36.log` passe les cinq profils en 50 s,
zéro retry : aucun chevauchement du contrôle avec le libellé ou le titre,
ouverture/fermeture native du tiroir et retour du focus, huit états d'avis
par profil sans violation serious/critical. Les références mobiles et le
parcours d'onglets/chemin profond passent aussi sur Chromium/WebKit mobiles
(`e2e-mobile-chrome-green-37.log`, 33 s), sans nouvelle exclusion ni modification
de référence visuelle. Les probes temporaires ne font pas partie des tests.

Les 16 captures après correction sont conservées pour Chromium desktop et
WebKit mobile, chaque thème/largeur/état, sous
`assets/validation-<profil>-notices-<thème>-<largeur>-<open|closed>.png`.
Revue des captures finales : Chromium clair 320 fermé et sombre 320 ouvert,
WebKit clair 320 ouvert et sombre 1 280 ouvert. Le bouton et les titres sont
séparés ; l'avis/panneau restent lisibles, bornés et utilisables ; la surface
principale conserve sa hiérarchie. La preuve avant correction est
[avis natif Linux ARM](assets/ci-180-notice-contrast-before.png).
Les résultats ciblés ne remplacent pas le prochain `checks:local` complet sur
le nouveau commit exact. T059/T060 et T045 restent ouverts à cette étape.


### Contrôle complet 12 — interrompu sur 444c6ef8

Format/lint/types et couverture passent : 483 fichiers, 5 090 tests réussis,
deux cas Windows exclus localement ; 91,72/86,33/94,37/92,82 %. Neuf suites de
performance, 375 intégrations, 13 migrations et 1 871 contrats passent. La
matrice est interrompue pendant ses premiers profils après réception d'un
autre échec réel de CI ; aucun profil complet ni gate ultérieure n'est validé
par cette tentative, aucun push de ce commit. L'instance du propriétaire reste
saine et intacte.

CI initiale : WebKit mobile termine avec 283 réussites, 31 exclusions et un
échec, répété au retry. Le parcours de glisser natif affiche bien la preview
bleue à la largeur de lecture, mais le relâchement ne change pas l'ordre des
blocs. Les deux captures avant relâchement/après échec et la trace sont
examinées ; l'assertion concernée est le déplacement immédiat, avant sauvegarde.
Les quatre autres profils web de cette CI sont verts. T061 est ajouté pour
FR-005/012 et US2/AC2 ; la cause reste à établir. Logs et traces sous
`work/test-readiness/ci-180-webkit-mobile-artifacts/`, sans lecture des réseaux
ni données du propriétaire. Le prochain contrôle complet reste obligatoire.


### T061 — position de caret, géométrie et destination canonique

Les diagnostics 38/39 passent trois répétitions locales chacun, même avec le
titre exact de la CI ; ils ne reproduisent pas son absence de déplacement.
Le diagnostic 40 échoue deux fois à 320 px : dépôt après le premier bloc au
lieu d'avant. Les diagnostics 41/42 relèvent une position de caret à la
frontière du deuxième bloc alors que la géométrie du pointeur désigne le
premier. Leurs traces sont conservées, puis tous les listeners/loggers et le
titre forcé sont retirés des sources et tests maintenus.

Le test unitaire expose également l'absence de destination aux limites
externes du groupe de blocs. `block-drop-geometry-red-03.log` : trois nouveaux
cas échouent, sept précédents passent. Après correction et ajout du cas sans
élément sous le pointeur, `block-drop-geometry-green-05.log` : 22 tests de
réordonnancement/interactions passent. Les limites de groupe, absence de
placement utile, mentions et géométrie de l'éditeur actif restent contrôlées.
Les types de tous les packages passent (`block-drop-types-06.log`).

Le rejeu `e2e-native-drop-final-43.log` passe **30 parcours sur les cinq profils**,
140 s, zéro retry : largeur habituelle de chaque profil et 320 px, trois
répétitions. Une assertion verticale vérifie désormais le trait au-dessus du
premier bloc, en plus de sa couleur/largeur et de l'absence d'écriture avant
dépôt ; ordre immédiat, persistance après rechargement et annulation restent
requis. Le rejeu sombre 44 échoue sur une préparation de test qui vérifiait
le thème avant le chargement de l'app ; il est interrompu. Cette assertion
est déplacée après ouverture. `e2e-native-drop-dark-45.log` passe les **dix
parcours à 320 px sombre**, deux par profil, sans retry, 71 s. Aucun clic forcé,
délai accru, seuil assoupli ou exclusion supplémentaire. Le scénario étroit
sombre reste dans le corpus maintenu, avec le parcours clair habituel.

Preuves finales examinées : WebKit mobile clair 390 px, Chromium et WebKit
sombres 320 px, sous `assets/validation-block-drop-<profil>-<thème>-<largeur>.png`.
Le trait bleu est à la largeur de lecture et au-dessus de la destination ;
contrôles et textes restent lisibles, les onglets masqués ne pilotent pas la
preview. Le bureau conserve son rendu, vérifié par ses parcours à la largeur
habituelle ; seul le calcul de destination change. Les traces CI ne permettent
pas d'affirmer que son échec avait exactement la même origine ; le prochain
run requis reste la confirmation de cette correction sur son runtime.

La CI initiale est terminée en échec : 26 jobs réussis, quatre plateformes
desktop sur le contraste et WebKit mobile sur le dépôt ; `quality-gate`
répercute ces échecs. La PR reste ouverte, sans fusion. T045/T059–061 restent
ouverts jusqu'au prochain contrôle complet et à la CI du nouveau commit.

### Contrôle complet 13 — timeouts non reproduits

Le contrôle 13 sur `d8d537b082cb355f5ae92f06f36f6c7a3cf2925b` s'arrête
à la couverture, après format/lint/types : 481 fichiers passent, deux suites
échouent et deux cas Windows restent exclus localement. 5 093 tests passent ;
le test d'équité des sauvegardes échoue sur le délai de connexion `pg.Client`
de 15 s. Les quatre assertions de synchronisation temps réel passent, mais
le nettoyage de sa suite dépasse les 180 s du hook. Les gates suivantes
ne sont pas exécutées et aucun push n'est fait sur cette preuve.

Les six tests des deux suites passent inchangés au rejeu avec instrumentation
Istanbul (`backup-realtime-timeout-replay-07.log`, 7 s). Ce rejeu ciblé ne
valide pas le seuil global de couverture : il échoue normalement sur la dette
des modules non exercés. Cinq nouveaux processus sans couverture passent
les six tests chacun (`backup-realtime-timeout-replay-08.log`), sans retry
interne. Les connexions du serveur de fixtures sont libérées. Ces rejeux
n'établissent pas la cause des deux timeouts du contrôle complet ; aucun
correctif produit, hausse de délai ou exclusion n'est introduit. Le prochain
contrôle doit réussir intégralement sur son commit exact. Les quatre
conteneurs de l'instance du propriétaire et leurs données restent intacts.


### Contrôle complet 14 — géométrie intermittente, pas de push

Le contrôle sur `ea70b396aa36edeb14beaf167dece9906d975f46` passe
format/lint/types, 5 094 tests dans 483 fichiers, les deux exclusions Windows
locales habituelles, puis couverture 91,72/86,33/94,37/92,82 %, neuf suites de
performance (22 tests), 375 intégrations, 13 migrations et 1 871 contrats.
Les deux suites qui avaient expiré lors du contrôle 13 passent ici, y compris
leur nettoyage. Quatre profils web complets passent : Chromium desktop 304/12,
Firefox desktop 290/26, Chromium mobile 292/24 et WebKit desktop 290/26
(réussites/exclusions existantes). Leurs logs sont archivés immédiatement sous
`work/test-readiness/checks-local-14-e2e-logs/`, avec le commit exact.

WebKit mobile termine son premier shard, puis signale un échec de géométrie
inline au deuxième shard, réussi au retry. Les deux glissers natifs T061
passent également, en clair à largeur habituelle et sombre à 320 px. La
tentative est interrompue après conservation de la capture et de la trace :
un retry réussi ne valide pas le gate. WebKit mobile reste incomplet, son
troisième shard et les contrôles desktop/build/images/sécurité/Compose suivants
ne sont pas exécutés. Aucun push ; les données et quatre conteneurs du
propriétaire restent intacts. T062 suit le diagnostic de ce défaut.


### T062 — masque de sidebar sans défilement invisible

Le diagnostic 46 reproduit trois échecs sur dix essais WebKit mobile. Les
mesures relèvent une translation de tout le panneau par `scrollLeft = 7`
sur `.workspace-sidebar-slot`, avec transformation CSS à zéro ; les autres
ancêtres ne défilent pas. Le repère de la ligne passe de x = −3 à x = 4
lors des gestes de focus. Le problème est donc un vrai déplacement de la
sidebar, pas son animation ni un débordement propre aux boutons. Le test
renforcé 47 échoue deux fois sur cet offset, avant toute modification CSS.

Le seul propriétaire modifié est `navigation.css` : le masque extérieur
utilise `overflow: clip` au lieu de créer un scrollport invisible avec
`hidden`. Le défilement réel reste dans le viewport de l’arbre. Le test
conserve les tolérances de 0,5/1 px et les dimensions/cibles/gouttières, lit
ligne/surface/contrôles dans une seule mesure, exige une origine stable et
l’absence de défilement horizontal des ancêtres. Les transitions restent
actives ; Entrée, Échap, retour du focus et clic natif sont conservés.

L’extension 48 découvre une préparation inadaptée à 320 px : créer un enfant
ferme normalement le tiroir ; son assertion de visibilité devait le rouvrir.
Cette tentative est interrompue, sans valider la matrice. Le parcours corrigé
49 passe **40 tests, cinq profils, 139 s, sans retry** : clair/sombre à
320/1 280 px, deux répétitions de chaque cas. Les enfants sont relus après
synchronisation et rechargement. Aucun délai augmenté, exclusion ajoutée ni
assertion de débordement retirée. Tous les loggers temporaires sont supprimés
des tests maintenus. Logs sous `work/test-readiness/e2e-inline-scroll-*.log`
et `e2e-inline-scroll-green-49-logs/`.

Les huit captures Chromium desktop/WebKit mobile, chaque thème et largeur,
sont examinées et conservées sous
`assets/validation-inline-create-<profil>-<thème>-<largeur>.png`. La ligne
et ses quatre commandes restent contenues et alignées ; le texte long cède
sa place aux actions, les thèmes et le tiroir restent cohérents. Vérification
avec ui-quality, lessons et le guide du système UI. Le contrôle complet sur
le nouveau commit et sa CI restent obligatoires ; T045/T059–062 restent
ouverts à cette étape. Les données de dev sont intactes.


### Contrôle complet 15 — typage du parcours renforcé

Sur `02b93a82ddd82b411acb5f69da9d110eafde5793`, les contrôles de
politique/outillage, shell, format et lint passent. Le typage racine échoue
sur la conversion par spread du `NodeList` de boutons, car sa configuration
DOM ne déclare pas les itérateurs. Les suites suivantes ne sont pas lancées
et aucun push n’est fait. La conversion utilise maintenant `Array.from`
avec le même mapper de géométrie : gestes et assertions sont inchangés.
Le prochain contrôle complet reste requis sur le commit corrigé.

Le typage de tous les packages et du dépôt passe après correction
(`work/test-readiness/inline-scroll-types-50.log`).

### Contrôle complet 16 — dépôt clavier de dossier

Sur `49981e2b36934109c795c22e11d9c6f2c33609e2`, politique, shell,
format/lint/types, couverture et suites précédant les navigateurs passent :
483 fichiers, 5 094 tests réussis et deux exclusions Windows existantes ;
couverture 91,72 % statements / 86,33 % branches / 94,37 % functions /
92,82 % lines. Performance : 22 tests ; intégrations : 375 ; migrations :
13 ; contrats : 1 871 dans 154 fichiers.

Chromium desktop finit avec **306 réussites, 12 exclusions et un échec**
sur le dernier parcours de dossier : le dépôt Espace après Flèche haut
conserve l’ordre précédent. Le contrôle est interrompu pour diagnostiquer
ce défaut. Firefox compte 220 réussites, 17 exclusions et un test interrompu
(saisie d’une page longue), sans échec produit observé avant l’arrêt.
WebKit desktop est partiel ; les deux profils mobiles et les gates suivantes
ne sont pas exécutés. Cette tentative ne constitue pas un contrôle complet
réussi et aucun push n’est fait. Log `work/test-readiness/checks-local-16.log`,
trace/capture Chromium préservées dans `e2e-folder-order-failure-16/`.

### T063 — collision courante au dépôt de dossier

Le diagnostic temporaire 51 reproduit deux échecs sur dix gestes natifs
Chromium. Dans les deux cas, `event.over.id` désigne encore l’enfant déplacé,
alors que `event.collisions[0].id` désigne déjà la bonne destination. Les
huit réussites ne présentent pas cette divergence. L’implémentation locale
dnd-kit calcule les collisions avant d’actualiser `over` par effet passif ;
le dépôt immédiat peut lire les deux états à des instants différents.
Le probe est retiré des sources et du parcours maintenu.

`FolderChildrenList` utilise la collision courante pour son placement
canonique, sans changer le CSS ni la mutation de hiérarchie. Les trois
nouveaux cas unitaires échouent avant le correctif (52), puis les neuf tests
du fichier passent (53) : destination précédente égale au déplacement,
destination précédente différente, refus d’une collision absente/inconnue/
inchangée. La mutation positive est unique et l’ordre optimiste vérifié.
Le typage complet passe (54).

Le parcours 54 passe **25 tests, cinq profils, 222 s, sans retry**. Le dépôt
rapide d’origine reste inchangé ; Échap annule une autre destination réelle
en sombre, rend le focus et conserve les ordres du canevas et de la sidebar.
Le second appareil, le glisser au pointeur et les onglets mobiles restent
vérifiés. Logs unitaires `work/test-readiness/folder-drop-unit-*.log`,
diagnostic `folder-drop-diagnostic-51-full.log`, matrice
`e2e-folder-drop-green-54.log` et `e2e-folder-drop-green-54-logs/`.

Les captures initiales prennent une transition en cours. Le parcours 55
attend uniquement la fin des animations réelles du canevas avant chaque
capture d’annulation ; aucun délai arbitraire ni attente supplémentaire
avant le dépôt rapide. Ce rejeu passe **cinq tests, cinq profils, 78 s, sans
retry** (`e2e-folder-drop-captures-55.log` et son dossier de logs).
Les quatre preuves sombres Chromium desktop à 1 024 px et WebKit mobile à
320 px sont revues selon ui-quality + lessons : preview sur la destination,
ordre initial après Échap, poignée focalisée, titres longs tronqués et
contenu sans débordement. Captures
`assets/validation-folder-keyboard-{preview|cancel}-{profil}-dark-{largeur}.png`.
T063 et T045 restent ouverts jusqu’au contrôle complet et à la CI du nouveau
commit. Les données de dev sont intactes.

### Contrôle complet 17 — sélection de texte avant convergence hors ligne

Sur `7fb03b45f9b229cc1f80c1ad3223dc307a6b191d`, les gates précédant
les navigateurs passent : 483 fichiers / 5 097 tests réussis, deux exclusions
Windows existantes ; couverture 91,72 / 86,33 / 94,37 / 92,82 %
(statements/branches/functions/lines). Les 22 benchmarks, 375 intégrations,
13 migrations et 1 871 contrats passent également.

Chromium desktop finit entièrement vert (**307 réussites / 12 exclusions**),
y compris le dépôt rapide T063. Son rapport est archivé immédiatement dans
`work/test-readiness/checks-local-17-e2e-logs/` avec le commit exact.
WebKit desktop révèle dans sa première tranche une valeur concaténée par
`fill` : `local compatible notelocal divergent note` au lieu du remplacement
attendu, avant le test de synchronisation. Le scénario passe après retry,
ce qui reste interdit comme preuve verte. La tentative est arrêtée : Firefox
compte 267 réussites, 18 exclusions et un test interrompu ; WebKit est partiel,
les profils mobiles et gates suivantes ne sont pas exécutés. Aucun push.

Trace, contexte, deux captures et log WebKit sont conservés sous
`work/test-readiness/e2e-offline-convergence-failure-17/`. Seuls les fichiers
de trace d’appels/snapshots sont lus, sans journal réseau ni données de dev.
L’arrêt utilise uniquement les stacks de tests identifiées ; les cinq
conteneurs de l’instance du propriétaire restent sains et inchangés.

### T064 — le caret initial ne reprend pas une sélection déjà faite

Le champ inline et l’édition de titre rejouent leur focus/caret dans un
`requestAnimationFrame`. Le tableau répète aussi le caret de l’input dans
une microtask. Ces placements peuvent écraser la sélection native réalisée
après ouverture du champ, ce qui permet à une insertion de texte de concaténer
les deux valeurs. Les tests 56 puis 57 reproduisent le mécanisme : six cas
échouent sur la sélection choisie, la saisie native avant événement React,
le focus choisi ailleurs et le champ date natif ; le caret initial reste vert.

Le placement a maintenant lieu une seule fois dans le layout du champ/titre.
Les valeurs natives sans événement React restent protégées par l’adapter
existant, les dates n’utilisent pas l’API de sélection textuelle, et la
microtask du tableau garde uniquement le focus initial des contrôles select.
Aucun style, schéma, sauvegarde ou protocole de convergence ne change.
Le rejeu 58 passe **21 tests dans deux fichiers**, dont les sept nouvelles
garanties. Logs `work/test-readiness/value-caret-unit-{red|green}-*.log`.

Le parcours natif conserve F2 → `fill` immédiat, ajoute le contrôle du brouillon
avant Entrée, et garde redémarrage, fusion compatible, trois versions du conflit,
résolution explicite, deux parents de révision et stockage canonique privé.
La matrice 59 passe **15 tests, cinq profils, 165 s, sans retry** : trois
répétitions complètes de ce scénario, avec toutes ses assertions. Logs sous
`work/test-readiness/e2e-value-caret-green-59.log` et son dossier de rapports.
Captures finales revues selon ui-quality + lessons, en clair à 1 280 px sur
Chromium desktop et 390 px sur WebKit mobile : valeurs de résolution exactes,
propriétés lisibles et actions accessibles sans débordement. Preuves
`assets/validation-offline-entry-converged-{profil}-light-{largeur}.png`.
Le CSS et les rendus sombres précédemment vérifiés restent inchangés.
Le contrôle complet du prochain commit et sa CI restent requis ; T064/T045
ne sont pas encore clos.

Types de tous les packages/dépôt et format/lint des cinq fichiers exécutables
modifiés passent (`work/test-readiness/value-caret-types-60.log`).

### Contrôle complet 18 — réussite sur 21b6652b

`checks:local` termine avec le code **0** sur le commit exact
`21b6652b77d8255daaa7a2d4ec870685e15454d6`, avec un arbre de travail propre.
Log `work/test-readiness/checks-local-18.log`. Bun 1.4.2, règles de lint,
budgets, seuils de couverture et de sécurité restent inchangés.

| Contrôle | Résultat |
| --- | --- |
| Toolchain, shell, format/lint, types | Réussis |
| Corpus sous couverture | 484 fichiers / 5 104 tests réussis ; deux exclusions Windows existantes sur macOS |
| Couverture statements / branches / functions / lines | 91,72 / 86,33 / 94,37 / 92,81 % |
| Performance sans instrumentation | Neuf suites / 22 tests réussis |
| Intégration / migrations / contrats séparés | 375 / 13 / 1 871 tests réussis ; rejeux non additionnés au corpus sous couverture |
| Desktop natif macOS ARM | Build, package, lancement installé et neuf parcours réussis |
| Production et images | Builds réussis ; API/web AMD64 et ARM64 |
| Restauration native ARM en image | Historique SQL, séquence, blobs, préfixe d'upload, répétition et activation réussis |
| Audit dépendances | 427 packages, aucun problème au seuil HIGH/CRITICAL ; cinq alertes sous ce seuil |
| Secrets / analyse statique / licences | 1 831 fichiers sans finding / 1 310 sources sans finding / 431 packages conformes |
| Compose | Services, ports loopback, secrets, images et temps réel validés |

La matrice web complète passe **cinq profils en 2 774 s**, avec **1 476
réussites et 119 exclusions conditionnelles existantes**, aucune réussite après
retry. Les rapports sont archivés immédiatement, avant le rejeu desktop natif,
dans `work/test-readiness/checks-local-18-e2e-logs/`. Son `summary.json` associe
les cinq résultats au commit exact, sans compter deux fois le profil Chromium.

| Profil | Réussites | Exclusions conditionnelles |
| --- | ---: | ---: |
| Chromium desktop | 307 | 12 |
| Firefox desktop | 293 | 26 |
| WebKit desktop | 293 | 26 |
| Chromium mobile | 295 | 24 |
| WebKit mobile | 288 | 31 |

Les parcours T059–T064 passent dans ce corpus, y compris preview/dépôt natifs
avec éditeur masqué, création inline clair/sombre à 320/1280 px, dépôt rapide
de dossier et convergence des entrées hors ligne. Les dernières corrections
n'ajoutent aucune exclusion, aucun clic forcé, délai arbitraire, assouplissement
de géométrie ni attente de synchronisation avant une action utile.

Le scan Trivy 0.70.0 déjà vert sur l'image `69cec828` reste une preuve
d'entrées inchangées selon `docs/development.md` : aucun manifeste, lockfile,
Dockerfile ni digest de base ne change depuis ce scan. La CI doit confirmer
le scan et les cibles natives Windows/Linux ainsi que la restauration AMD64.

Le push de `21b6652b` est effectué seulement après ce résultat complet.
La [PR #180](https://github.com/enzofrnt/MyOwnNotion/pull/180) est déjà attachée
au chat. Le [run CI 37174588251](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37174588251)
vise ce nouveau commit et reste en cours à cet enregistrement ; l'ancien run
en échec sur `69cec828` ne constitue pas une preuve verte. T045/T059–T064
restent ouverts jusqu'au résultat requis de ce run. Aucun merge ni
réinitialisation de l'instance du propriétaire.

### CI sur 21b6652b — ouverture du menu slash, T065

Le run 37174588251 confirme les cinq cibles desktop, les suites unitaires avec
couverture, contrats, performance, sécurité, images et restaurations. Chromium
desktop termine cependant avec **305 réussites, 12 exclusions, un échec et
un cas flaky** : le menu slash ne s'ouvre pas à 1 280 px en clair ; le sombre
échoue puis passe seulement après retry. L'échec concerne la première attente
de l'option Tableau simple, avant les contrôles de défilement. La CI globale
reste en cours et ne constitue donc pas une preuve verte.

Log du job téléchargé par son endpoint dédié :
`work/test-readiness/ci-21b6652b-chromium-desktop-failure.log` ; contexte,
captures et traces sous `ci-21b6652b-chromium-desktop-artifacts/`. Les captures
clair/sombre sont revues : le texte précédent est intact, `/tab` apparaît dans
le paragraphe final, et aucun menu n'est visible. La trace d'appels confirme
Ctrl/Meta+End suivi immédiatement de la saisie native ; les attributs de
settlement ne montrent aucune erreur d'application. Le journal réseau,
cookies et clés ne sont pas lus. Ce constat ne prouve pas encore le mécanisme
qui empêche l'ouverture : T065 le diagnostique dans le runtime Linux avant
correction. Les tâches de publication restent ouvertes.

Le run est désormais **terminé en échec** : 29 jobs réussissent ; Chromium
desktop, WebKit mobile et l'agrégat échouent. Les cinq cibles desktop passent.
WebKit mobile compte 286 réussites, 31 exclusions, un échec et un flaky :
le dépôt natif à 320 px conserve l'ordre initial après une preview correcte
(deux tentatives), et le clic de l'entrée 1000 dépasse sa limite native après
une première visibilité (retry vert). T066/T067 suivent ces écarts ; aucun
seuil, geste, virtualisation ou exclusion n'est affaibli. Log et artefacts
`work/test-readiness/ci-21b6652b-webkit-mobile-{failure.log,artifacts/}`.
Les captures sont revues : blocs toujours dans l'ordre initial, tableau
revenu vers les entrées 0959–0976 après disparition de la dernière ligne.

### T065 — fin du document et saisie slash immédiate

Les probes Linux isolées passent 6 parcours inchangés, puis 20 parcours
instrumentés et 10 sous charge CPU. Elles ne reproduisent pas l'échec CI,
mais montrent le curseur DOM après le paragraphe (`DIV`, offset 2) suite à
Ctrl+Fin, avant restauration par selectionchange. Les snapshots CI montrent
un paragraphe supplémentaire `/tab` sans décorateur de suggestion ; les
keymaps actuels ne possèdent pas ce raccourci. La protection du widget terminal
ne concerne que Flèche droite/bas. Les probes temporaires sont retirées.

Le raccourci Ctrl/Meta+Fin est désormais possédé par un plugin d'éditeur :
sélection ProseMirror à la fin du document, remise à jour DOM synchrone,
prévention du placement natif dans le widget ; lecture seule, composition,
Fin simple, sélection étendue et autres raccourcis sont conservés. Aucun
changement CSS ni ouverture automatique sur un collage/projection distante.

Les tests rouges 69 montrent trois échecs et un cas de refus correct ; les
tests verts 70/72 passent **19 tests dans trois fichiers**, y compris la
sélection déjà en fin de document et une saisie immédiate sans ajout de bloc.
Types de tous les packages verts (71). Le parcours natif conserve Ctrl/Meta+Fin
et `/tab` sans attente intermédiaire ; il contrôle aussi l'absence de paragraphe
parasite. Chromium Linux 71 passe **20 parcours, clair/sombre, 320/1280 px,
sans retry**. Captures revues : menu borné au viewport, option finale visible,
texte intact ; preuves `assets/validation-document-end-slash-chromium-linux-`
`{dark-1280,light-320}.png`. La matrice 72 et le prochain contrôle complet/CI
restent requis ; T065/T045 ne sont pas encore clos.

La matrice 72 termine verte : **60 parcours, cinq profils, 190 s, sans retry**,
trois répétitions des quatre variantes clair/sombre et 320/1280 px. Les gestes
Ctrl/Meta+Fin, saisie rapide, flèches, Échap et clic natif restent inchangés.
Logs archivés sous `work/test-readiness/e2e-slash-all-green-72-logs/` avant
toute autre matrice. Le contrôle complet du prochain commit et sa CI sont
encore requis, ainsi que les diagnostics T066/T067.

### T066/T067 — lifecycle du dépôt et arrêt du défilement

Les probes WebKit 74 passent six parcours natifs (trois glissers à 320 px et
trois grandes bases) ; les probes de pagination 75/79 passent respectivement
trois et deux parcours. Elles ne reproduisent pas les deux échecs CI. La probe
73 est invalide : son sélecteur de diagnostic absent provoque une erreur de
ResizeObserver ; elle est corrigée avant les suivantes et ne compte pas comme
preuve rouge produit. Toutes les probes sont retirées du corpus maintenu.

Le code épinglé BlockNote retire son overlay au dragleave sans relatedTarget.
Le dépôt applicatif exigeait encore cette peinture : le test rouge 76 reproduit
le déplacement perdu. Les trois cas rouges 77 révèlent aussi la réutilisation
d'une preview périmée. La protection initiale par égalité de coordonnées passe
les 16 tests unitaires (78), mais échoue sur le geste Firefox : la matrice 82
est interrompue après ce constat et ne valide aucun profil complet. La probe
84 confirme dragover y=255/258 et drop y=255 pour le même pos=1. Le correctif
retient la destination de l'éditeur actif ; sortie vers un autre élément,
destination invalide et annulation la rendent inutilisable. Il ne dépend plus
de la présence de la peinture ni de coordonnées strictement identiques.

La probe 79 relève un offset virtuel 40 363, 1 380 px de corrections négatives
différées et un scrollport réel déjà en bas à 40 389. L'observateur épinglé
utilise au repos le dernier offset événementiel, qui peut précéder un nouveau
geste ou layout. Les deux tests rouges 80 exécutent cet observateur et le
virtualiseur réels : iOS ramène une intention courante à 1 000 vers 492.
L'adapter de tableau relit uniquement le scrollTop réel au repos, avant la
décision de compensation ; geste, estimation, pagination et DOM borné restent
inchangés. Déconnexion et observation native sont aussi testées.

La suite ciblée 85 passe **24 tests dans trois fichiers** : 17 pour le glisser,
cinq pour la géométrie/lifecycle du viewport et deux pour l'observation.
Types de tous les packages verts (83), contrôles de format/lint ciblés verts.
La matrice native 86, les preuves visuelles, le prochain contrôle complet et
sa CI restent requis. Aucun délai, retry validant, clic forcé, seuil ou exclusion
n'est ajouté aux parcours maintenus. L'instance du propriétaire reste intacte.

Diagnostics et logs isolés sous `work/test-readiness/` :
`unit-drop-{red-76,red-77,green-78}.log`, `unit-scroll-red-80.log`,
`unit-drop-scroll-green-85.log`, `e2e-pagination-{probe-75,idle-probe-79}.log`,
`e2e-drop-firefox-probe-84.log` et `e2e-drop-scroll-all-green-82.log` (interrompu).

La matrice 86 passe les trois profils desktop et les deux grandes bases
Chromium mobile, mais échoue aux glissers mobiles ; elle est arrêtée avant
fin de WebKit mobile. La probe 88 relève au point de dépôt la cible native
`.bn-formatting-toolbar`, tandis que pos=1 reste validé. Cette superposition
explique l'interception et la sortie du DOM texte. Le contrôle 89, qui attendait
la disparition du toolbar, passe et ne constitue pas une preuve rouge :
cette attente est retirée. L'observation immédiate avant relâchement (90)
échoue **trois fois**, avec une barre visible au lieu de zéro, sans retry.

Le propriétaire CSS chargé `editor.css` conserve la géométrie de la barre,
mais la masque et désactive son hit testing uniquement pendant le glisser de
bloc. Le test natif observe cet état sans attendre, puis confirme la fin de
grabbing au dépôt et à Échap. Aucun réglage, style de texte ou interaction
normale de la barre n'est retiré. La matrice 91 rejoue les cinq profils avant
preuve visuelle et contrôle complet ; elle ne constitue pas encore une clôture.

La matrice 91 passe les trois desktop, mais le glisser mobile reste en échec
(matrice interrompue). La probe 92 confirme le DIV positioner encore visible
et interactif alors que son contenu est caché. Le controller reçoit désormais
une classe via `floatingUIOptions.elementProps`, sans modifier le placement
ou les dimensions ; la règle de grabbing masque ce positioner et son contenu.
L'observation immédiate contrôle les deux surfaces. La suite 93 passe
**25 tests dans quatre fichiers**, menus compris ; la matrice 94 reprend les
cinq profils et aucune réussite de la matrice interrompue n'est présentée comme
un contrôle complet.

La matrice 94 est interrompue après les échecs de géométrie desktop : le
positioner n'intercepte plus le geste, mais le trait se trouve encore à
l'ancienne limite, environ 30 px plus bas. La probe native 95 reproduit cet
écart et confirme pos=1 valide, DOM cible correct et barre entièrement cachée.
Le contrôle 96 échoue trois fois : la règle non scopée ne gagne pas la cascade.
La probe 97 relève la transition SDK réelle `top/bottom 0.15s`, le trait à
y=320 et le premier bloc à y=291. La règle chargée dans `editor.css` est
désormais scopée à `.page-editor`, sans `!important`, et retire uniquement
l'animation du trait : la preview doit correspondre immédiatement à la
destination validée, même avant un relâchement rapide. Probes retirées ; le
contrôle natif 98 conserve ses assertions et trois répétitions sans retry.

Le contrôle 98 termine vert : **trois parcours Chromium mobile à 320 px**.
La matrice 99 termine ensuite verte : **30 parcours, cinq profils, 348 s,
sans retry**, soit deux répétitions des deux glissers et du retour après
1 001 entrées (clair/sombre conservés). Logs archivés sous
`work/test-readiness/e2e-drop-scroll-all-green-99-logs/` avant les contrôles
suivants. La suite 100 passe **25 tests dans quatre fichiers** ; tous les
types et le contrôle ciblé de format/lint passent (101).

Captures finales revues : trait immédiatement aligné sur le premier bloc,
colonne de lecture respectée à 320 px, menu absent pendant le geste ; entrée
1000 entière et accessible après retour, tableau borné, thèmes clair/sombre.
Preuves Chromium dark-320/light-1280 et WebKit dark-320/light-390/dark-390 :
`assets/validation-native-block-drop-lifecycle-{chromium,webkit}-dark-320.png`
et `assets/validation-table-idle-scroll-{chromium-light-1280,webkit-light-390,`
`webkit-dark-390}.png`. Ces résultats ne remplacent pas le contrôle complet
du commit à publier ni la CI du dernier head ; T045/T065–T067 restent ouverts.

### Contrôle complet 19 — arrêt aux contrats, T068

Sur le commit propre `060e928d4ae6c63fa2ddf7b300bcd2efd5090267`, outillage,
shell, format/lint, types passent. La couverture passe **486 fichiers,
5 116 tests**, avec les deux exclusions Windows existantes ; couverture
91,72 % statements, 86,33 % branches, 94,37 % functions, 92,82 % lines.
Les neuf groupes de performance passent, puis **375 tests d'intégration**
et **13 tests de migration**. Les contrats s'arrêtent avec **1 869 réussites
et deux échecs** : l'identité folder d'import reçoit un échec pg_dump après
15,5 s ; le cas V1 backup mismatch dépasse 120 s. Ces deux cas passent dans
la couverture précédente du même contrôle (764/446 ms). Le scénario longue
absence de 10 000 changements passe à environ 146 s dans les deux suites.

Ce contrôle est **en échec**, pas une validation de publication. La matrice
complète web, les étapes desktop/build/images/sécurité restantes ne démarrent
pas ; le collecteur de logs web est arrêté. Log ignoré
`work/test-readiness/checks-local-19.log`. T068 suit la cause avant toute
correction : observation PostgreSQL sans SQL privé, codes de sortie classifiés
sans credentials et rejeu des trois fichiers avec la même concurrence.

### T068 — diagnostic des connexions, sans changement des budgets

Le rejeu 102 des trois fichiers concernés passe **51 tests** (143,14 s,
dont 141,89 s pour la longue absence). L'observation PostgreSQL ne voit
ni bloqueur ni requête de plus de cinq secondes. Le rejeu complet 103
reproduit **trois échecs / 1 868 réussites** : deux autres cas d'import
reçoivent `timeout expired` après 15,37/15,58 s, et le refus V1 d'identité
d'installation dépasse 120 s. Aucun bloqueur n'est observé. L'outil pg_dump
ne signale alors qu'une base temporaire absente, sans expiration de connexion ;
cet événement ne démontre pas la cause des trois échecs. Ne pas assimiler
tout code non nul d'un scénario négatif à un défaut de sauvegarde.

Le message `timeout expired` correspond au délai d'ouverture du client pg,
avant la vérification d'import attendue. Le diagnostic 104 observe les étapes
TCP/SASL et la fermeture des clients sans lire les requêtes ou leur contenu.
Il passe **154 fichiers / 1 871 tests** (148,29 s, longue absence 146,95 s) :
aucune connexion pendante de plus de deux secondes et aucune expiration ;
les refus de connexion attendus des tests de restauration restent couverts.
Ce rejeu ne reproduit donc pas la panne et ne prouve aucune correction.
Logs ignorés `work/test-readiness/contract-diagnostic-{102,103,104}.log`.
Les probes externes ne changent ni code produit, ni assertions, ni budgets,
ni chiffrement, et ne constituent pas le contrôle de publication.

Le second rejeu complet instrumenté 105 passe également **154 fichiers /
1 871 tests** (157,64 s, longue absence 156,42 s), sans connexion pendante
de plus de deux secondes ni expiration. La cause initiale n'est pas démontrée :
les probes peuvent changer le timing. Aucune correction produit ou relaxation
du contrôle n'est donc justifiée par ces observations. Le contrôle complet 20
doit utiliser les outils PostgreSQL réels et la configuration maintenue,
sans wrapper ou setup de diagnostic, sur un commit figé. Tout nouvel échec
reste bloquant et sera diagnostiqué ; les échecs 19/103 restent consignés.

### Contrôle complet 20 — réussite sur 782f7618

`checks:local` termine avec le **code 0** sur le commit exact
`782f761837385209040fb2d96e6e4410c10cd586`, sans probe, wrapper PostgreSQL
ou configuration de diagnostic. Le code reste figé pendant toute la chaîne.
Le serveur de tests est sur 55432 ; les deux URLs de base évitent la base
de développement du propriétaire sur 5432.

| Contrôle | Résultat |
| --- | --- |
| Toolchain, shell, format, lint, types | Réussite ; 92 avertissements historiques, non bloquants selon la gate maintenue |
| Couverture | 486 fichiers / 5 116 tests réussis ; deux cas conditionnels réservés à Windows sur cet hôte macOS |
| Couverture statements / branches / functions / lines | 91,72 / 86,33 / 94,37 / 92,81 %, seuils inchangés |
| Performance hors instrumentation | Neuf fichiers / 22 tests réussis |
| Intégration et migrations | 38 fichiers / 375 tests ; 13 tests de migrations réussis |
| Contrats | 154 fichiers / 1 871 tests réussis, configuration normale |
| Web, cinq profils | 1 476 réussites / 119 exclusions de plateforme existantes, 2 857 s ; aucune réussite après retry |
| Desktop macOS ARM | Build, package, lancement installé et neuf parcours natifs réussis, dont arrêt du processus et reprise hors ligne |
| Builds et images | Production web/API, images AMD64/ARM64 et restauration complète dans le runtime ARM natif réussies |
| Sécurité et Compose | 427 dépendances, aucun HIGH/CRITICAL ; cinq alertes sous ce seuil ; 1 835 fichiers et 1 314 sources sans finding, 431 licences conformes ; frontières Compose validées |

Détail web réussites/exclusions : Chromium desktop **307/12**, Firefox desktop
**293/26**, WebKit desktop **293/26**, Chromium mobile **295/24**, WebKit mobile
**288/31**. Le collecteur archive les cinq logs et leur commit exact avant que
le parcours desktop ne remplace le rapport Chromium. Les parcours T065–T067
passent dans la matrice complète, dont les deux previews/dépôts mobiles et
la dernière entrée d'une base de 1 001 lignes.

Logs ignorés : `work/test-readiness/checks-local-20.log`,
`checks-local-20-e2e-logs/summary.json` et les cinq profils correspondants,
`checks-local-20-native-macos-arm.log`. Le code de sortie de la chaîne est
observé ; une collection de succès intermédiaires ne le remplace pas.
Les conteneurs du propriétaire conservent leurs identités Caddy `125a1a04c051`,
web `d21f7c000c58`, API `9805c10c811b`, PostgreSQL `8c1a3325af0b`, tous sains.

Le scan Trivy local de `69cec828` demeure une preuve d'entrées inchangées :
aucun manifeste, lockfile, Dockerfile ou digest de base ne change depuis ce
scan, conformément à `docs/development.md`. La CI du candidat le confirme
par un nouveau scan. Le succès normal des contrats ne démontre pas la cause
des expirations 19/103 ; ces observations et cette limite restent consignées.

### CI sur 782f7618 — démarrage Windows x64

Le [run 37188863857](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37188863857)
correspond au commit exact du contrôle complet 20. Le job Windows x64
`111396606405` s'arrête avant les tests : Bun 1.4.2 et la création de la fixture
PostgreSQL 18 ont réussi, puis le lancement du contrôle de toolchain termine
en 38 ms sans sortie du script avec `-1073741502` (`0xC0000142`).
[Microsoft décrit ce code comme une erreur d'initialisation de DLL](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55).
La DLL et la cause sous-jacente ne sont pas identifiées ; aucun échec de test
produit n'est observé dans ce job. Les actions de rétention et de cleanup
échouent aussi au démarrage sur cette machine. Windows ARM, macOS et les deux
runners Linux réussissent leurs parcours natifs dans le même run.

La relance isolée sur une nouvelle machine doit confirmer le job Windows x64.
GitHub la refuse tant que le workflow initial tourne (HTTP 403). Les contrôles
web et de contrats continuent ; ce run ne constitue pas encore une CI verte,
et T045 reste ouvert. Journal ignoré :
`work/test-readiness/ci-782f7618-windows-x64-failure.log`.

La première tentative termine le 4 octobre : **les cinq profils web sont verts**.
Chromium desktop passe 307 parcours / 12 exclusions, dont les quatre variantes
du menu slash ; WebKit mobile passe 288 / 31, dont preview/dépôt avec éditeur
masqué en 13,0/11,4 s et pagination de 1 001 entrées en 49,7 s. Aucun flaky
n'est rapporté. Les contrats passent 154 fichiers / 1 871 tests ; la couverture
Linux passe 486 fichiers / 5 115 tests, avec trois exclusions de plateforme
existantes, et 91,72 / 86,33 / 94,37 / 92,82 % de couverture. Les corpus sous
couverture et hors couverture se recoupent : ne pas additionner leurs nombres.
Seul Windows x64 échoue, puis l'agrégat le répercute. La publication d'images
sur une branche de PR est conditionnellement exclue, selon le workflow maintenu.

La seconde tentative relance seulement Windows x64 et son agrégat dépendant,
avec diagnostic du runner activé, sans modification de source ni retry des
assertions. Le nouveau job `111402341743` utilise `GitHub Actions 1000008751`,
distinct de la machine initiale `1000008724`. Son résultat est encore attendu.
Logs ignorés : `ci-782f7618-{unit,contract,chromium-desktop,webkit-mobile}.log`
et `ci-782f7618-retry-watch.log` sous `work/test-readiness/`.

### Clôture de validation sur 782f7618

La seconde tentative du [run 37188863857](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37188863857)
termine avec **success** sur `782f761837385209040fb2d96e6e4410c10cd586` :
**32 jobs requis verts**, `quality-gate` compris. Seule la publication d'images
reste conditionnellement exclue pour une PR. La liste de checks de la PR est
également verte. Les succès des autres suites sont conservés ; seuls Windows
x64 et l'agrégat ont été réexécutés.

Le job Windows x64 `111402341743` passe le contrôle de toolchain auparavant
inexécutable, les types, **24 fichiers / 107 tests desktop réussis** et le cas
DMG réservé à macOS exclu, le scan des secrets, les builds, le package et le
lancement installé. Sa matrice native passe **1/1 projet en 37 s**. Le cleanup
passe aussi ; la rétention d'échec est exclue puisque le job a réussi. La cause initiale
reste inconnue : aucun patch produit ni relaxation de test n'a été effectué
pour cet incident. Journal ignoré :
`work/test-readiness/ci-782f7618-windows-x64-success.log`.

Les critères de T045/T059–T068 sont ainsi satisfaits par le contrôle complet
20 et la CI du même commit, avec les diagnostics et limites conservés. La
clôture documentaire garde la PR ouverte, sans fusion. La clarification suivante
du propriétaire remplace la classification de toute la branche pour ce suivi :
les preuves applicatives de `782f7618` restent valides tant que leurs entrées
exécutables ne changent pas. Les contrôles documentaires et les références de
publication sont consignés dans le [corps de la PR 180](https://github.com/enzofrnt/MyOwnNotion/pull/180).
La CI requise du candidat de fusion reste bloquante avant toute fusion.

La convergence finale du 4 octobre examine **21 FR + cinq SC + huit scénarios
d'acceptation = 34 éléments d'intention**, huit choix du plan et les huit
principes de la Constitution. Résultat : **zéro finding** missing / partial /
contradicts / unrequested, aucun écart matériel UI/UX et **68 tâches closes**.
L'inventaire des 20 familles, les 151 observations initiales et les preuves
complémentaires des corrections restent traçables ; les sept composants
historiques non montés gardent leur exclusion explicite. Le hash de `tasks.md`
est identique avant/après cette phase : aucune réécriture ni phase vide de
convergence. Ce compte rendu est ajouté après la revue, dans la mise à jour
de suivi d'implémentation. Les liens locaux de spec/plan/tasks/preuves/guide
ont été vérifiés ; les prérequis Spec Kit et `git diff --check` réussissent.

### Validation proportionnée et publication documentaire — 2026-10-04

Le propriétaire demande explicitement d'arrêter la répétition des suites pour
la clôture documentaire, d'assouplir la règle et de publier après les contrôles
nécessaires. Le contrôle 21 de `6402ed83` est donc **interrompu**, avec code de
sortie 1 après arrêt de son seul conteneur WebKit mobile. Il avait validé la
couverture (5 116 réussites / deux exclusions), 22 benchmarks, 375 intégrations,
13 migrations, 1 871 contrats et quatre profils web (1 188 réussites). Il ne
constitue pas un contrôle complet réussi et ses résultats partiels ne remplacent
pas le contrôle 20 / la CI verte de `782f7618`.

La Constitution 4.0.0, le canevas §§42/44, AGENTS, development et les artefacts
directement concernés de 002/016/019/033 sont alignés : sélectionner les contrôles
sur les changements depuis la dernière publication validée ; documents et
cohérence pour la prose sans impact exécutable, tests pertinents pour les
corrections délimitées, contrôle complet pour les changements transversaux ou
d'impact incertain. Les documents utilisés comme schémas, fixtures ou entrées
exécutables nécessitent leurs contrôles consommateurs ; les vérifications de
liens et d'hygiène documentaire restent des contrôles de documents. Les gates
requis avant fusion, `main` et release conservent leur contrat.

Les changements depuis `782f7618` se limitent à **15 fichiers Markdown**. Aucun
code, test, workflow, manifeste, lockfile, migration, configuration ou entrée de
build ne change ; la validation applicative complète et les 32 jobs verts de ce
commit sont réutilisés. Vérifications documentaires : **175 liens locaux valides**,
absence de commandes retirées dans le guide de développement, metadata/version
et absence de placeholders de Constitution, prérequis Spec Kit 033 et diff sans
erreur. La revue de cohérence confirme FR-018/020 de 016 et FR-008 de 033 face aux
principes III/VII et à la sélection documentée. T035 (016) et T069 (033) sont clos.

L'instance du propriétaire conserve Caddy `125a1a04c051`, web `d21f7c000c58`, API
`9805c10c811b` et PostgreSQL `8c1a3325af0b`, tous sains. Les références du commit
publié sont ajoutées au corps de la PR 180 ; aucune fusion et aucune nouvelle
suite applicative lancée pour cette mise à jour documentaire.

## Sidebar et accès Source après fusion — 2026-10-04

Base : `main` fusionné `01a0560b51cecc461135fb26b49e7ceff9105f6a`, CI
37196888713 verte. Correctifs locaux sur `codex/033-sidebar-source-controls`,
selon FR-022/023, T070/071 et ui-quality + lessons L-009/010/018.

### Diagnostic et résultat réel

À 1059×843, une longue branche fait grandir la rangée implicite de la grille :
sidebar de 1236,45 px, pied à 1183,45 px, hors de la fenêtre. La rangée explicite
`minmax(0, 1fr)`, la taille minimale nulle du rail et le pied non rétrécissable
conservent le défilement dans OverlayScrollArea. Après correction : shell et
rail de 843 px, pied à 790–835 px. Après défilement de la navigation (1273 px
observés), le pied garde le même emplacement. Le tiroir mobile à 320×843 garde
son pied à 770–815 px, sans débordement horizontal ; Échap le ferme et rend le
focus au déclencheur.

Le refus de choisir « bob » provenait du verrou existant de vue unique.
Un même booléen est maintenant utilisé par l'écriture, le menu Ariakit et
la ligne des paramètres. Les deux commandes sont grisées/inactives avec
description accessible et titre natif « Ajoutez une deuxième vue pour changer
sa source. ». Ajouter une deuxième vue réactive les accès ; la gestion des
sources et l'exception des vues liées restent inchangées.

Preuves de l'instance réelle, examinées dans le navigateur intégré :

- [Sidebar et paramètres sombres à 1059](assets/sidebar-source-dark-1059.jpg).
- [Menu Source désactivé](assets/source-menu-dark-1059.jpg).
- [Sidebar et paramètres sombres à 1280](assets/sidebar-source-dark-1280.jpg).
- [Sidebar défilée et paramètres clairs à 1280](assets/sidebar-source-light-1280.jpg).
- [Tiroir clair à 320](assets/sidebar-light-320.jpg),
  [tiroir sombre défilé à 320](assets/sidebar-dark-320.jpg).
- [Paramètres clairs à 320](assets/source-settings-light-320.jpg),
  [paramètres sombres à 320](assets/source-settings-dark-320.jpg).

Les dimensions et le thème système ont été temporairement émulés pour la
revue, puis restaurés ; aucune préférence de thème ni donnée métier changée.
Pas de nouvelle leçon dans le journal avant validation explicite du propriétaire.

### Validation proportionnée

- Vitest web : **33/33** tests, quatre fichiers (nouveau verrou du panneau,
  shell, sidebar, compositions partagées). Le bouton natif refuse le clic puis
  accepte l'action après déverrouillage, sans garder la raison obsolète.
- Types web et TypeScript racine : **réussis**.
- Biome sur les neuf fichiers exécutables modifiés : **code 0**, zéro erreur,
  63 avertissements de spécificité CSS ; aucune règle désactivée. Diff vérifié.
- Deux parcours sélectionnés, Chromium desktop et WebKit mobile Linux :
  **4/4 réussites, sans retry**, 35 s pour la matrice ciblée. Géométrie bureau
  et 320 px, défilement natif déclenché par focus, Échap/retour du focus ; menu
  au clic droit puis Shift+F10, raison accessible et déverrouillage des deux
  accès. Source et création de pages/dossiers restent opérationnelles.
- Le premier essai du nouveau test utilisait une molette non supportée par
  Playwright WebKit mobile ; le parcours utilise maintenant le défilement natif
  au focus, avec les mêmes assertions. Ce premier essai n'est pas une preuve
  réussie et aucune assertion produit n'a été retirée.
- Spécifications/plan/tâches cohérents avec le canevas §§12/14 et 029 ; preuves
  locales présentes, titres/liens et diff vérifiés. Aucune suite complète, aucun
  reset du workspace du propriétaire, aucune migration ni dépendance changée.

L'instance HTTP 8080 reste en dev sur ce checkout. Docker Desktop avait conservé
une taille de fichier obsolète sur les sources modifiées, provoquant des lectures
tronquées : le web a été recréé et ces six fichiers ont été actualisés dans le
montage. Les données et services API/PostgreSQL/Caddy sont conservés. Les sources
lues dans le conteneur correspondent aux fichiers locaux corrigés. La vérification
applicative de la CI précédente n'est pas annoncée comme une CI de ces correctifs.

## Stabilisation de la navigation pendant le dépliement — 2026-10-04

### Échec reproduit et correction

La [CI initiale de PR 181](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37213675030)
sur `abf78d5e` termine avec 30 contrôles réussis ; Chromium mobile est refusé
pour un parcours flaky, puis quality-gate refuse sa conclusion. Les autres
profils Playwright réussissent. Le parcours concerné est
`linked-databases.spec.ts`, « loads beyond 1000 canonical entries using a
visible cursor action ». Il échoue avant le chargement de la première page :
`Large reusable source` conserve `aria-selected=false` après le clic.

La trace CI montre le clic pendant l'animation du groupe de navigation. La
ligne et son texte sont montés et possèdent une boîte stable, mais leur parent
`collapsible-region__inner` masque encore cette boîte avec `overflow: clip`.
`toBeVisible` ne vérifie pas ce masque. La même erreur est reproduite en local
sur Chromium mobile : **deux réussites et un échec sur trois**, sans retry.
Les traces et logs restent dans les sorties locales ignorées (`work/ci-181`,
`test-results` et `.e2e-logs`) et dans le rapport de la CI initiale.

`ensureNavigationRowVisible` effectue maintenant le défilement natif nécessaire
puis attend une intersection complète de la ligne (`toBeInViewport`, ratio 1).
L'attente observe la géométrie réellement exposée au pointeur, sans durée fixe,
nouveau retry, clic forcé, budget augmenté ou assertion de sélection supprimée.
Le code produit, les données et les animations restent ceux de `abf78d5e`.

### Validation locale avant publication

Changement exécutable délimité à cinq lignes de `tests/e2e/helpers.ts`.
Les types TypeScript racine et Biome sur ce fichier réussissent ; le build E2E
est effectué par le runner. La preuve antérieure de 33 tests composants et
des types web reste applicable aux sources produit inchangées.

Matrice isolée : trois parcours (pagination de 1001 entrées, sidebar longue,
accès Source verrouillé/déverrouillé), **trois répétitions chacun sur les cinq
profils**, **45/45 réussites**, **zéro retry**, 532 s. Chromium desktop/mobile
s'exécutent sur l'hôte ; Firefox et WebKit desktop/mobile dans le runtime Linux
documenté. Les assertions de pagination, virtualisation, ouverture/retour,
focus, source et géométrie sont conservées.

Commande reproductible avec PostgreSQL de test sur 55432 et deux stacks :

```bash
DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55432/myownnotion \
MYOWNNOTION_E2E_JOBS=2 bun scripts/e2e/run-local-matrix.ts \
tests/e2e/linked-databases.spec.ts tests/e2e/workspace-shell.spec.ts \
tests/e2e/databases-pages-views.spec.ts \
--grep 'loads beyond 1000|keeps settings visible|a database is a navigable owner' \
--retries=0 --repeat-each=3
```

Prérequis Spec Kit 033, cohérence FR-008/022–plan–T072, liens locaux des documents
modifiés et diff contrôlés. Aucune donnée du workspace du propriétaire utilisée
pour les fixtures. La publication doit encore recevoir la confirmation de tous
les contrôles GitHub ; cette preuve locale ne constitue pas une CI verte. La
révision publiée, son run et sa conclusion sont suivis dans la
[PR 181](https://github.com/enzofrnt/MyOwnNotion/pull/181).

## Collecte du test de routage sous couverture — 2026-10-04

Le [run de `46427ada`](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37216046150)
révèle un autre échec, dans `Unit, property & coverage` : le `beforeAll` de
`app-routing.spec.tsx` expire à **10 000 ms** en chargeant le graphe complet de
modules de `App`. Les 18 tests de routage sont alors non exécutés ; les 5098
autres assertions réussissent. Le test ciblé sur l'hôte passe avant correction
(18/18, 7,10 s pour le fichier) : ce dépassement du délai de préparation n'est
pas reproduit dans cet essai isolé.

Le test importe maintenant `App` statiquement lors de la collecte de Vitest,
comme ses autres composants. Il ne mesure plus la transformation/chargement
du code dans un hook de préparation fonctionnelle. Les 18 assertions, les
délais des tests, les hooks de montage/nettoyage, l'isolation, les quatre
workers et les seuils de couverture restent inchangés. Aucun code produit ni
configuration de test n'est modifié.

Validation du même code avant publication :

- **Couverture complète réussie** : 487 fichiers, **5117 assertions réussies**,
  deux exclusions existantes, 210,81 s. Les 18 tests de routage passent en
  5,32 s, y compris authentification, retour protégé, réglages, graphe et reprise
  hors ligne. Le fournisseur Istanbul et tous les seuils sont conservés.
- Couverture globale observée : statements 91,72 %, branches 86,33 %, fonctions
  94,37 %, lignes 92,82 % ; le gate des nombres absolus non couverts réussit.
- Types web, types racine, Biome ciblé, prérequis Spec Kit, cohérence
  FR-008–plan–T073, liens des trois documents modifiés et diff vérifiés.
- Les 45 parcours ciblés sans retry de `46427ada` restent une preuve applicable
  aux entrées E2E et aux sources produit inchangées. Le test unitaire de routage
  n'est pas une entrée du bundle produit ni de ces parcours.

Le premier lancement local de la couverture a été interrompu (sortie 130)
après des refus de sauvegarde : les clients PG18 n'étaient pas sur PATH.
Il n'est pas compté comme une réussite. La commande suivante utilise le chemin
Homebrew documenté et le PostgreSQL jetable du runner ; aucun reset de la base
ou des données du propriétaire :

```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" bun run test:coverage
```

Logs locaux ignorés : `work/ci-181/local-coverage-routing-pg18.log` ; diagnostic
CI dans `work/ci-181/unit-46427ada.log`. La confirmation CI du correctif de
collecte reste à obtenir sur sa révision publiée et est suivie dans la PR 181.

## Attente du dépliement et zoom — 2026-10-04

Le [run de `e7e69ad7`](https://github.com/enzofrnt/MyOwnNotion/actions/runs/37217351997)
passe tous les contrôles hors E2E, dont la couverture. Les cinq profils E2E
échouent au zoom à 200 % sur l'attente introduite par T072 ; WebKit bureau
échoue aussi sur une ligne de fichier enfant. Le ratio horizontal de la ligne
reste environ 0,99, même après défilement et retry : l'exigence d'une ligne
décorative intégralement dans le viewport n'observe pas seulement le dépliement.
Le screenshot CI du zoom montre bien le libellé exposé et les réglages visibles.
Le même échec est reproduit localement sur Chromium et Firefox, sans retry.

`ensureNavigationRowVisible` attend maintenant que chaque région ancêtre soit
ouverte et que ses animations natives soient terminées, puis fait défiler la
ligne et vérifie sa présence dans le viewport. Il ne désactive ni n'accélère
l'animation produit. Le clic réel et sa sélection restent contrôlés ; le
parcours zoom conserve son assertion de débordement horizontal. Aucun budget,
retry, skip, code produit, dépendance ou configuration n'est modifié.

Validation locale avant publication :

- **60/60 parcours** : zoom, pagination après 1000 entrées, sidebar bornée et
  propriétaire de base/Source, trois répétitions sur chacun des cinq profils,
  sans retry ; matrice réussie en 590 s.
- **15/15 parcours supplémentaires** : fichier hiérarchique distinct des PJ de
  sa page, trois répétitions sur les cinq profils, sans retry ; 69 s.
- Biome ciblé et types racine réussis. Prérequis Spec Kit, liens locaux, diff
  et cohérence FR-008/022–plan–T074 vérifiés.
- La couverture complète de T073 reste applicable aux sources produit et
  unitaires inchangées. Le helper Playwright n'est pas une entrée Vitest.

Commandes avec PostgreSQL jetable sur 55432, distinct de l'instance propriétaire :

```bash
DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55432/myownnotion \
MYOWNNOTION_E2E_JOBS=2 bun scripts/e2e/run-local-matrix.ts \
tests/e2e/narrow-viewport.spec.ts tests/e2e/linked-databases.spec.ts \
tests/e2e/workspace-shell.spec.ts tests/e2e/databases-pages-views.spec.ts \
--grep 'core writing surface|loads beyond 1000|keeps settings visible|a database is a navigable owner' \
--retries=0 --repeat-each=3

DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55432/myownnotion \
MYOWNNOTION_E2E_JOBS=2 bun scripts/e2e/run-local-matrix.ts \
tests/e2e/files.spec.ts --grep 'keeps a hierarchy file under a page distinct' \
--retries=0 --repeat-each=3
```

Logs ignorés : `work/ci-181/local-zoom-before.log`,
`local-navigation-zoom-after.log`, `local-navigation-files-after.log` et les
rapports CI `*-e7e69ad7.log`. La CI doit encore confirmer la dernière révision
publiée ; les références et sa conclusion restent dans la PR 181. Le suivi
automatique consulte son état toutes les cinq minutes, selon la demande du
propriétaire, et traite un nouvel échec avant de déclarer la livraison terminée.
