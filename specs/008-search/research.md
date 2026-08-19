# Research: Recherche initiale du workspace

## Decision 1 — Un moteur embarqué et transitoire commun

**Decision**: Utiliser MiniSearch 7.2.0 dans le serveur et le navigateur,
encapsulé par le domaine. Chaque instance reste uniquement en mémoire et se
reconstruit depuis les sources chiffrées.

**Rationale**: MiniSearch fonctionne dans Node.js et le navigateur, accepte les
ajouts et retraits incrémentaux, le préfixe, le rang, le boost de champs et les
filtres, avec zéro dépendance transitive annoncée. Ce périmètre correspond
exactement à la recherche V1 et son index tient dans le processus, ce qui évite
un service ou une base supplémentaire.

**Alternatives considered**:

- PostgreSQL tsvector/GIN : performant et mature, mais les lexèmes sont stockés
  dans l'index PostgreSQL. Indexer les contenus privés en clair contredirait le
  chiffrement applicatif au repos.
- FlexSearch : très capable, y compris workers et stockage persistant, mais sa
  surface de configuration, d'export/import et de connecteurs est plus large
  que le besoin présent. La persistance intégrée est précisément ce que cette
  feature doit éviter.
- Meilisearch, Elasticsearch ou OpenSearch : ajoutent un service, une copie de
  données et une nouvelle frontière de chiffrement/exploitation.
- Index inversé propriétaire : reproduirait rang, préfixes, incrémentalité et
  optimisation sans avantage produit actuel.

**Sources**:

- MiniSearch, fonctionnalités et usage en mémoire :
  https://github.com/lucaong/minisearch
- FlexSearch, workers, recherche documentaire et persistance :
  https://github.com/nextapps-de/flexsearch
- PostgreSQL, contenu des index GIN/GiST de recherche textuelle :
  https://www.postgresql.org/docs/17/textsearch-indexes.html

## Decision 2 — Aucun index sensible n'est persisté

**Decision**: Ne sérialiser ni MiniSearch, ni lexèmes, ni extraits. Le serveur
reconstruit depuis les enveloppes protégées ; le navigateur depuis les lignes
Dexie ouvertes après déverrouillage. Les données canoniques et locales
existantes restent les seules formes persistantes.

**Rationale**: Cette frontière satisfait le chiffrement au repos sans inventer
de format d'index chiffré, de migration ou de rotation supplémentaire. Une
sauvegarde contient déjà les données nécessaires à une reconstruction exacte.
La mémoire du processus est la même frontière de déchiffrement que celle
requise pour afficher ou éditer le contenu.

**Alternatives considered**:

- Sérialiser puis chiffrer l'index : accélère le redémarrage mais introduit un
  grand artefact à invalider atomiquement après chaque mutation et à migrer avec
  chaque version de moteur.
- Blind index HMAC : masque les mots mais révèle égalités et fréquences, et
  complique fortement préfixes, rang et extraits.
- Laisser un index IndexedDB ou PostgreSQL en clair : interdit par la
  constitution et le canevas.

## Decision 3 — Une extraction visible et une normalisation partagée

**Decision**: Extraire le texte visible des blocs connus dans le domaine :
contenus inline, code et légendes. Exclure URLs, identifiants, métadonnées,
blocs inconnus et corps legacy arbitraires. Segmenter avec Intl.Segmenter,
normaliser en NFKD, retirer les marques diacritiques et appliquer la casse
française. Les blocs non compris restent trouvables par titre.

**Rationale**: Le même document produit les mêmes termes sur serveur et client.
Indexer seulement ce qui est visible évite qu'une propriété technique ou une
valeur inconnue apparaisse dans un extrait. Intl.Segmenter gère les limites de
mots au-delà d'un simple découpage par espaces et est disponible dans les
navigateurs cibles.

**Alternatives considered**:

- Parcourir récursivement tout JSON : pourrait indexer des URLs, IDs, secrets
  techniques ou champs qu'aucune interface n'affiche.
- Dépendre du HTML/Tiptap : lierait la recherche à l'éditeur au lieu du format
  canonique.
- Stemmer français agressif : risque des correspondances surprenantes ; la V1
  demande casse, accents, mots et préfixes, pas une analyse linguistique
  complète.

**Source**:

- Intl.Segmenter et segmentation par mots :
  https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter

## Decision 4 — Reconstruction isolée, échange atomique

**Decision**: Modéliser quatre états : cold, building, ready et degraded. Une
reconstruction bâtit une nouvelle génération hors de l'instance active et ne
la publie qu'après lecture, validation et comptage complets. Sans génération
ready, la route serveur refuse une réponse complète avec un état actionnable.

**Rationale**: Servir un index à moitié reconstruit sous l'étiquette complète
est une perte silencieuse de découvrabilité. L'échange atomique conserve
l'ancienne génération pendant un rebuild de maintenance et ne publie jamais un
mélange.

**Alternatives considered**:

- Muter l'index actif pendant la reconstruction : expose des résultats
  partiels et rend un échec impossible à annuler.
- Bloquer tout le serveur jusqu'à la fin : rend l'édition indisponible pour une
  projection dérivée reconstruisible.
- Continuer à servir après un échec incrémental : présente volontairement un
  index devenu obsolète comme fiable.

## Decision 5 — Mise à jour après commit, versionnée par révision

**Decision**: Mettre à jour le serveur après le commit canonique et le client
après le commit atomique projection/outbox. Chaque document indexé porte sa
révision courante. Un événement rejoué ou plus ancien est ignoré ; un échec
invalide la génération et déclenche un rebuild.

**Rationale**: Une mutation en mémoire avant commit laisserait un résultat
fantôme si la transaction échoue. L'identité et la révision rendent l'upsert
idempotent. Les chemins et descendants sont hydratés depuis la hiérarchie
courante au moment de la requête, donc déplacer une branche n'impose pas de
réindexer tout son sous-arbre.

**Alternatives considered**:

- Indexer à l'intérieur de la transaction : une structure mémoire ne peut pas
  participer au rollback PostgreSQL ou Dexie.
- Stocker le chemin dans l'index : chaque déplacement de branche rendrait tous
  les descendants obsolètes.
- File asynchrone persistante séparée : ajoute un second journal alors que le
  flux de changements et les révisions fournissent déjà la reprise.

## Decision 6 — Résultat local d'abord, serveur fusionné ensuite

**Decision**: Le worker local répond immédiatement. Si le réseau est
disponible, le client appelle ensuite le serveur et fusionne par identité. Une
version locale pending ou conflict prévaut ; une version synchronized peut
être enrichie par le serveur. La couverture affichée passe explicitement de
local-only à complete.

**Rationale**: Le propriétaire voit immédiatement son travail local et ne le
perd pas visuellement au profit d'une réponse distante plus ancienne. Une
simple concaténation produirait des doublons ; remplacer tout le local par le
serveur détruirait la vérité offline.

**Alternatives considered**:

- Serveur uniquement : inutilisable hors ligne et trop lent pour le travail
  déjà local.
- Local uniquement : ne trouve pas le contenu déchargé.
- Dernière réponse arrivée gagnante : le réseau déciderait arbitrairement de
  l'état montré.

## Decision 7 — Requête HTTP dans le corps, curseur opaque

**Decision**: Utiliser POST /v1/search avec un corps validé, même si
l'opération est en lecture. La route exige la session propriétaire, ne requiert
aucune donnée dans l'URL, et renvoie un curseur opaque lié à la requête et à la
génération.

**Rationale**: Les URLs sont couramment présentes dans historiques, proxies et
logs d'accès. Une requête de recherche peut révéler directement le contenu
privé. Le curseur empêche de mélanger deux générations lors du chargement
progressif et ne contient aucun texte brut.

**Alternatives considered**:

- GET avec query-string : simple mais incompatible avec l'interdiction de
  journaliser les requêtes privées.
- Offset seul : une reconstruction ou mutation entre deux pages peut produire
  doublons et omissions sans signal.
- Session de pagination stockée côté serveur : conserve des requêtes et ajoute
  un état à expirer sans nécessité.
