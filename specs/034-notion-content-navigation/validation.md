# Validation 034 — 2026-10-04

Livraison locale sur codex/notion-api-import, base 01a0560b, changements non
publiés. Constitution/canevas lus avant design, Spec Kit specify/plan/tasks/
analyze/implement suivis ; ui-quality, lessons et guide UI appliqués.

## Données réelles et isolation

Projet myownnotion-notion-api, HTTP 8082/HTTPS 8445/PostgreSQL 55433 ; cinq
volumes et clé propres. Images privées notion-api-isolated et
notion-api-runtime, bundle API immuable et source Web sans bind mount. Les
conteneurs UI myownnotion-ui-dev n'ont pas été redémarrés ni reconstruits.
Le runner navigateur a créé des bases/ports/blob roots/clés jetables sur le
serveur 55433 ; invocation directe du runner car le wrapper prépare un projet
PostgreSQL par défaut. Firefox/WebKit passent dans le runtime Linux documenté.

Sauvegarde complète vérifiée avant réparation canonique, contrôle des fallbacks
contre le snapshot et zéro remplacement de contenu modifié localement. 41 blocs
mis à niveau sur cinq pages : 10 équations de bloc, 31 formules inline dans 29 blocs,
deux sommaires. Relecture protégée : types, sources exactes et identités inline
vérifiés. Deux parents réparés via placement.move, dont Archive > Lycée > Simple
Note. People et ses deux membres sont dans la corbeille, sa source hors de
l'arbre actif. Neuf bases et 57 médias restent actifs. Snapshot initial et nom de
racine choisi par le propriétaire conservés. Reprise du job historique avec la
CLI finale, sans jeton Notion : already complete, aucune réimportation.

Le navigateur a ouvert les cinq pages mathématiques réelles et la page signalée
par le propriétaire : 10 équations de bloc, 31 inline et 2 sommaires rendus dans les
éditeurs actifs ; zéro expression en erreur, erreur de page ou HTTP 5xx. Les
pages de 0/1 titre n'ont pas d'outline ; celles de 2/3 titres ont un seul outline.
Simple Note affiche ses dix notes : ouverture par Entrée, fermeture du panneau
et retour du focus vérifiés. Les statuts complets et les dates sont visibles,
alignés à droite ; capture réelle inspectée uniquement dans le dossier privé.

Les scripts/cookies, identités source, captures réelles et secrets sont ignorés,
les contenus de récupération restent chiffrés. Seules les preuves synthétiques
ci-dessous appartiennent à la feature. Les pages QA temporaires ont été mises
à la corbeille canoniquement.

## UI et comportement

Trois parcours maintenus dans tests/e2e/editor-math-contents.spec.ts :

- Math : édition de bloc et inline, formule invalide enregistrée, Échap,
  annulation/rétablissement, rechargement, /latex, /sommaire vide et navigation
  hors ligne après chargement ; contrôles de source au clavier.
- Sommaires : liens dans le contenu et outline, dépliage d'un titre imbriqué,
  repère après retour en haut, modification de titre reflétée dans les deux,
  vingt changements de page avec un seul outline courant, navigation à 320px.
- Liste : clair/sombre, 1440/320px, icônes, noms de propriétés masqués mais
  association conservée, métadonnées alignées, titres longs consultables,
  clavier et absence de débordement. Une colonne de lecture bornée à 688px
  contrôle les labels complets des pills sur ordinateur.

La matrice finale des trois parcours passe : 15 tests, 5/5 profils, sans retry
nécessaire. Les essais préalables ont corrigé la collision Tiptap entre bloc et
inline equation (inlineEquation dans la projection), la propagation de souris
vers ProseMirror, et le seuil de repère trop serré après activation. Les fixtures
ont été corrigées pour laisser une vraie marge après un titre, employer une
saisie indépendante du comportement de Home sur macOS, et attendre la fin de
navigation avant le défilement suivant. Aucun seuil de données/sécurité n'est
abaissé. La dernière retouche de largeurs de liste est revérifiée par son
parcours seul sur les cinq profils.

ListView utilise un subgrid commun, titre flexible et métadonnées bornées selon
leur largeur intrinsèque ; les gaps du parent et des rangées sont identiques.
Cela évite de couper les statuts alors que la colonne de titre a encore de la
place. À 320px, les métadonnées reviennent à la ligne ; le document ne déborde pas.

Captures synthétiques rendues et inspectées à échelle réelle :

| Surface | Clair 1440 | Sombre 1440 | Clair 320 | Sombre 320 |
| --- | --- | --- | --- | --- |
| Formules et sommaire | [capture](evidence/content-light-1440.png) | [capture](evidence/content-dark-1440.png) | [capture](evidence/content-light-320.png) | [capture](evidence/content-dark-320.png) |
| Liste renseignée | [capture](evidence/list-light-1440.png) | [capture](evidence/list-dark-1440.png) | [capture](evidence/list-light-320.png) | [capture](evidence/list-dark-320.png) |

État invalide avec source conservée : [capture](evidence/equation-invalid-light-1440.png).
Saisie mathématique et sommaire vides à 320px : [capture](evidence/empty-dark-320.png).
Liste vide à 320px : [capture](evidence/list-empty-dark-320.png).
Chargement/échec/offline de la liste conservent les composants existants ; cette
retouche ne remplace pas leur validation antérieure. Pas de chargement artificiel
pour une projection mathématique ou un sommaire dérivé.

## Contrôles sélectionnés

Impact transversal domaine/page-state/client-core/Web/API, nouvelle dépendance
locale et build : inventaire de docs/development.md appliqué. Livraison de dev
avec contrôles pertinents ; checks:local reste requis avant tout push futur.
Aucun push, PR, migration SQL ou validation de release n'est annoncé.

- Domaine/page-state complets : 1 232 tests dans 81 fichiers, y compris sources avec
  LF/tab, frontières inline, erreurs de validation, checkpoint et export exact.
- Contrôles ciblés finaux domaine/page-state/client-core/Web : 136 tests dans 12
  fichiers ; en particulier compatibilité historique, chiffrement/atomicité,
  conversion, slash, sommaires et composants réutilisés.
- API Notion/CLI : 22 tests dans 3 fichiers ; hiérarchie de colonne, appartenance
  de source, exclusion entière, refus d'ID, annotations code/équation et source.
- Intégration d'import et contrats d'opérations : 15 tests déjà réussis contre
  des bases jetables sur 55433 ; inputs exécutables de ces parcours conservés.
- Matrice Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile :
  trois parcours verts sur chaque profil ; révision de liste ciblée séparément.
- Types stricts du workspace et tests ; toolchain Bun 1.4.2 ; format et lint CI
  réussis. Le lint garde les avertissements existants non bloquants.
- Builds API/Web Bun réussis ; images indépendantes reconstruites, migrations
  de démarrage sans modification de SQL et services sains sur 8082.
- Audit des dépendances de production : aucune vulnérabilité au niveau high
  ou critical. Prérequis Spec Kit, liens/documents, absence de secrets suivis et
  git diff --check vérifiés.

Le dernier déploiement reconstruit uniquement le Web de ce projet ; le contrôle
navigateur des dix entrées réelles passe après ce redémarrage. Format, types et
build Web sont confirmés sur les sources finales. Le scanner de secrets passe
sur 1 861 fichiers avec un index Git temporaire reflétant ajouts et suppressions,
sans modifier l'index du propriétaire. L'index initial contenait encore les cinq
anciens fichiers supprimés ; son premier scan échouait sur ces fichiers absents,
sans détection de secret.

## Limites et convergence

Le moteur est KaTeX local, pas un moteur LaTeX complet : commande inconnue ou
source invalide reste visible et modifiable. Trust=false, macros isolées,
expansion/taille bornées, pas de CDN ni source HTML stockée. Les équations
réelles de ce jeu de test se rendent toutes. L'ajout de math en ligne depuis
zéro n'a pas de nouvelle commande dédiée ; les formules importées en ligne
sont éditables, la commande /équation ajoute un bloc comme demandé.

Sommaire dérivé sans copie de titres ; l'export JSON conserve le bloc et
l'export Markdown marque son emplacement par un commentaire. L'outline est
un repère de lecture à 96px du début du scrollport ; les liens alignent le titre
à 48px, avec ouverture des ancêtres repliés et respect de reduced motion.

Restent les différences d'import documentées dans [le guide](../../docs/notion-import.md) :
valeurs figées des types de propriété sans équivalent, plages/fuseaux de dates,
filtres/vues non compatibles, colonnes linéarisées, synchro/modèles matérialisés,
permissions/commentaires/historique non importés. 35 blocs unsupported et deux
originaux synchronisés inaccessibles sont des limites de ce que l'API transmet.
Couvertures et Personne sont exclues ; People est une exclusion explicite de ce
jeu de test, sans filtre universel sur le nom d'une base.

La livraison initiale a convergé sur FR-001–010, SC-001–004 et les états UI du
plan. Les notes historiques 028/029/033 ont été reliées à 034 sans déclarer
leurs anciennes phases comme revalidées. Le suivi responsive du sommaire est
consigné séparément ci-dessous ; sa revue visuelle reste à faire.
## Maintenance 2026-10-04 — couleurs des liens

Revue directe de la page signalée sur 8082, après reconstruction et remplacement
du seul conteneur Web isolé. Le titre « CAN / CNA (Video) : » rend son texte,
son fragment lié et les trois segments soulignés en rgb(224, 62, 62), au lieu
d'un lien bleu et d'un soulignement blanc. Le lien cyan de la ligne suivante
conserve un soulignement cyan. Capture sombre à 1280 × 900 inspectée directement.
L'ordre DOM devient couleur > lien > soulignement ; tous restent inline et les
URL sont identiques. Aucun document n'a été édité pendant cette revue.

Preuves privées ignorées : work/notion-api/034-link-color-before.json,
034-link-color-after.json, 034-link-color-after.png, 034-link-color-image.log
et 034-link-color-deploy.log. Conteneur Web sain ; images et dates de démarrage
de l'instance principale comparées à la livraison précédente, inchangées.
Les suites automatisées n'ont pas été relancées, conformément à la demande
du propriétaire. Cette preuve porte sur la correction visuelle signalée.
Contrôle statique et format Biome limité à blocknote-schema.ts et editor.css :
réussi sous Bun 1.4.2.

Leçon candidate, à capitaliser après retour propriétaire : une décoration
propagée depuis un ancêtre ne prend pas les couleurs des descendants ; placer
le soulignement dans les marques qui définissent couleur et lien, en conservant
les fragments inline pour les retours à la ligne.

## Maintenance 2026-10-06 — espace du sommaire latéral

`PageOutline` observe la largeur du scrollport `.workspace-main` ; quand la
fenêtre ou la zone de contenu passe sous 960 px, seul le sommaire latéral est
masqué. L'observation réagit aussi au redimensionnement de la barre latérale.
Le bloc Sommaire inséré dans la page n'est pas concerné. Le code passe le
typecheck Web ; les tests automatisés n'ont pas été exécutés à la demande du
propriétaire. L'instance isolée 8082 a reçu une nouvelle image Web et répond
HTTP 200. La page authentifiée n'était pas disponible dans le navigateur
headless utilisé pour la capture, donc la revue visuelle reste à faire (T018).
