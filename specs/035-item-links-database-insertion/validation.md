# Validation 035 — 2026-10-04

Livraison locale sur codex/notion-api-import, sans commit/push/PR demandé.
Constitution, canevas et design de 028/029/033 lus ; séquence Spec Kit suivie,
recherche déléguée en lecture seule et implémentation par un seul propriétaire.
ui-quality, lessons et guide UI appliqués. Aucun type canonique, SQL ou paquet
supplémentaire ; les identités et marques pageLink restent compatibles.

## Résultat et données réelles

- Lien d'élément : pages, dossiers, bases propriétaires et bases liées actives,
  titre/icône/chemin courants, recherche et choix clavier. Action « Lien vers un
  autre élément » et icône reference cohérentes dans slash et toolbar ; menu
  contextuel et dialogue emploient le même vocabulaire.
- Créations : Page imbriquée, Dossier imbriqué, Base de données imbriquée ;
  alias existants conservés. Le lien d'enfant et sa navigation ne changent pas.
- Une seule commande Base de données intégrée. DatabaseCreateChoiceDialog est
  réutilisé ; nouvelle base/source ou affichage lié d'une source existante.
  Chargement, absence, erreur et réessai sont visibles ; annulation n'écrit rien.
  Une garde synchrone empêche les doubles confirmations. Le résultat durable
  reste disponible pour une insertion interrompue ; la source n'est pas recréée.
  Le retry d'un enfant existant utilise sa vue stockée, avec contrôle de parent
  et lifecycle. Une insertion tardive ne prend pas le focus d'une autre page.
- Import : is_inline true garde un affichage natif ; false donne un lien de
  base. Sans indicateur ou vue disponible, lien conservateur ; absence signalée.

L'audit du snapshot protégé a identifié huit anciennes projections full-page
sur six pages. Elles étaient toutes inchangées. Sauvegarde complète vérifiée,
puis opérations canoniques set-block-type/replace-text/set-mark ; revalidation
du checkpoint et ses updates avant chaque transaction. Huit liens relus et
vérifiés, zéro bloc modifié localement remplacé. Une seconde prévisualisation
renvoie zéro réparation et huit éléments déjà corrigés. Aucune base, source,
entrée, vue, icône ou placement n'est recréé ou déplacé. La base réellement
inline reste intégrée ; People reste exclue. Le snapshot initial est immuable.

Le navigateur ouvre CNAM, constate le lien Suivi des tâches et aucune base
intégrée dans son corps, puis ouvre sa base native. Aucune erreur JS ou HTTP 5xx.
Les cinq pages mathématiques et la page signalée s'ouvrent toujours : dix
équations de bloc, trente et une inline, deux sommaires, zéro rendu invalide.
Rapport détaillé, cookies, config et captures réelles restent privés et ignorés.
Les pages/dossiers/bases synthétiques de QA ont été mis à la corbeille.

## Tests et contrôles

- Corpus Web initial : 906 tests dans 138 fichiers, tous verts. Le cas de
  chargement ajouté ensuite passe dans les contrôles ciblés finaux. La revue
  synthétique a sa preuve navigateur ; elle ne lit aucun service réel.
- Contrôles finaux ciblés Web/import/CLI : 44 tests dans six fichiers, incluant
  neuf cas du dialogue et distinction de présentation, lien sans vue, exclusion.
  Les sept fichiers ciblés initiaux passaient également, dont sept cas de rendu
  de lien dynamique. Les tests établissent annulation, double activation, retry
  d'insertion et mutation, source vide/échec/chargement, identité de source et
  refus d'écraser une modification concurrente.
- Intégration import/API opérationnelle : 11 tests dans deux fichiers contre
  des bases jetables sur PostgreSQL 55433. Le premier essai manquait les outils
  PG 18 sur PATH ; la relance avec le libpq documenté passe, sans abaisser le gate.
- Matrice Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile :
  quatre parcours de bases verts sur chaque profil (20 tests), puis trois
  parcours de liens/création/page et Web (15 tests). Le parcours de source liée
  a ensuite été renforcé avec création hors ligne et repasse sur les cinq
  profils. Les reprises, reload, focus après annulation et partage des données
  sont vérifiés. Aucune reprise automatique nécessaire sur les runs finaux.
- Types stricts du workspace, format, lint CI et builds API/Web réussis. Les
  93 avertissements lint existants restent non bloquants. Les défauts initiaux
  d'imports et de dépendance explicite du retry ont été corrigés/documentés.
- Scanner de secrets : 1 871 fichiers, zéro détection, index temporaire avec
  ajouts/suppressions ; l'index du propriétaire reste inchangé. Diff et liens
  locaux vérifiés. Le gate transversal checks:local reste requis avant push.

Les échecs de matrice initiale provenaient d'une assertion sur le conteneur
entier du titre (il comprend icône et type) et d'un délai de synchronisation
mobile lors de ce run. Les runs finaux corrigent l'assertion, sans changement de
seuil ni suppression de scénario. Les erreurs de fixture et de runtime ne sont
pas présentées comme des validations réussies.

## Preuves UI synthétiques

Le vrai dialogue partagé est rendu dans /__ui-lab?review=database&insertion=…,
sans service/stockage du propriétaire. Vingt captures couvrent choose, existing,
empty, error, loading × clair/sombre × 1440/320 ; busy et retry ont aussi une
capture sombre à 320px. Huit captures de menu/sélecteur utilisent le vrai
éditeur sur des objets synthétiques. Zéro débordement horizontal ou erreur.

| Parcours | Clair 1440 | Sombre 1440 | Clair 320 | Sombre 320 |
| --- | --- | --- | --- | --- |
| Choix intégré | [capture](evidence/insertion-choose-light-1440.png) | [capture](evidence/insertion-choose-dark-1440.png) | [capture](evidence/insertion-choose-light-320.png) | [capture](evidence/insertion-choose-dark-320.png) |
| Source existante | [capture](evidence/insertion-existing-light-1440.png) | [capture](evidence/insertion-existing-dark-1440.png) | [capture](evidence/insertion-existing-light-320.png) | [capture](evidence/insertion-existing-dark-320.png) |
| Créations imbriquées | [capture](evidence/commands-light-1440.png) | [capture](evidence/commands-dark-1440.png) | [capture](evidence/commands-light-320.png) | [capture](evidence/commands-dark-320.png) |
| Liens d'éléments | [capture](evidence/link-picker-light-1440.png) | [capture](evidence/link-picker-dark-1440.png) | [capture](evidence/link-picker-light-320.png) | [capture](evidence/link-picker-dark-320.png) |

À 320px : [vide](evidence/insertion-empty-dark-320.png),
[chargement](evidence/insertion-loading-light-320.png),
[erreur/reprise](evidence/insertion-error-dark-320.png),
[création](evidence/insertion-busy-dark-320.png),
[insertion à reprendre](evidence/insertion-retry-dark-320.png).
Captures inspectées : hiérarchie, lignes complètes, focus visible, espaces,
actions de reprise et sélection. Les états restent composés avec les primitives
existantes ; le dialogue est entièrement utilisable à 320px.

## Isolation et convergence

Projet myownnotion-notion-api : HTTP 8082, HTTPS 8445, PostgreSQL 55433, volumes et
clé propres. Images notion-api-isolated/notion-api-runtime ; bundle API immuable
et source Web sans bind mount. Le dernier restart met à jour seulement ce Web.
L'autre instance myownnotion-ui-dev conserve ses heures de démarrage API/Web
12:06:24/15:18:07 UTC, ses ports et ses volumes. Aucun restart API pendant QA.

La convergence porte sur les huit FR, quatre SC, neuf scénarios, les décisions
de plan, les états UI et les huit principes constitutionnels. Pas de travail
buildable restant dans 035. Les phases historiques de 029/033 ne sont pas
déclarées revalidées ; leurs artefacts renvoient cette évolution vers 035.
Ce changement conserve les autres limites du [guide d'import](../../docs/notion-import.md).
