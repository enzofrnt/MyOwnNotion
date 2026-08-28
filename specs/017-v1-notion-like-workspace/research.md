# Research: Éditeur Notion-like et synchronisation convergente

Recherche effectuée le 20 août 2026 sur les versions et documentations
officielles disponibles à cette date. Les prototypes sont jetables et ne font
pas partie du dépôt ; leurs scénarios et résultats deviennent des tests
d'acceptation dans cette feature.

## Decision 1 — BlockNote Community pour l'éditeur, derrière un adaptateur

**Decision**: Remplacer la surface Tiptap assemblée dans le projet par
BlockNote Core/React/Ariakit Community 0.54.x. Interdire les packages
`@blocknote/xl-*`. Garder un adaptateur MyOwnNotion entre BlockNote et les
données, plutôt que laisser l'éditeur posséder la persistance ou le format
canonique.

**Rationale**: BlockNote Community fournit déjà le modèle d'interaction visé :
blocs imbriqués, IDs de blocs, drag-and-drop, slash menu, barre de formatage,
side menu, composants React, localisation et schémas personnalisés. Son API
`onChange(... getChanges())` distingue insertions, suppressions, mises à jour et
moves avec bloc précédent et parent ; ses commandes ciblent un `block.id`. Ce
sont les primitives nécessaires pour traduire une transaction visible en
opérations MyOwnNotion par identité.

La majorité du projet est MPL-2.0 et le cœur Community est utilisable sans
abonnement. Les fonctions XL — IA, colonnes et certains exports — sont
GPL-3.0/commerciales et ne sont pas nécessaires à la V1. Les exports restent
ceux du modèle canonique MyOwnNotion.

BlockNote est encore en version pré-1.0. Les packages sont donc verrouillés sur
la même version exacte, mis à jour ensemble et isolés par des tests d'adaptateur.

**Alternatives considered**:

- **Tiptap actuel** : moteur solide et flexible, mais la poignée, le DnD, les
  menus, les blocs riches, la sélection multiple et toute la finition restent à
  maintenir dans le projet. Le template Notion-like officiel Tiptap est un
  produit commercial distinct et ne constitue pas une fondation libre
  redistribuable suffisante.
- **Plate OSS** : moteur et plugins puissants, mais davantage de composants et
  assemblages de finition sont à construire ou proviennent de Plate Plus. Il ne
  réduit pas autant le travail UI V1.
- **Yoopta** : MIT et proche de Notion, mais moins de recul, de garanties de
  conversion serveur et d'intégration prouvée avec le modèle retenu.
- **BlockSuite PageEditor** : très complet et déjà collaboratif, mais son propre
  store, runtime web-components et modèle multi-document remplaceraient
  plusieurs frontières du produit. Son README le qualifie encore d'early stage.
- **Éditeur maison sur ProseMirror** : contrôle maximal, coût maximal, et
  reproduit la situation actuelle.

**Sources**:

- BlockNote, dépôt, capacités et licences :
  https://github.com/TypeCellOS/BlockNote
- BlockNote, Community et XL : https://www.blocknotejs.org/pricing
- BlockNote avec Ariakit :
  https://www.blocknotejs.org/docs/getting-started/ariakit
- Structure et IDs de blocs :
  https://www.blocknotejs.org/docs/foundations/document-structure
- Événements et `getChanges()` :
  https://www.blocknotejs.org/docs/reference/editor/events
- Manipulation ciblée de contenu :
  https://www.blocknotejs.org/docs/reference/editor/manipulating-content
- Schémas personnalisés :
  https://www.blocknotejs.org/docs/features/custom-schemas
- BlockSuite, état et architecture :
  https://github.com/toeverything/blocksuite

## Decision 2 — Loro comme moteur opérationnel du corps des pages

**Decision**: Utiliser Loro CRDT 1.14.x dans un package partagé
`@myownnotion/page-state`. Représenter la hiérarchie et l'ordre par un
`LoroTree` mobile et le texte riche de chaque bloc par un `LoroText`. Ne pas
utiliser le document ProseMirror/Yjs de BlockNote comme autorité.

**Rationale**: L'exigence n'est pas seulement « fusionner du texte ». Un bloc
doit rester le même objet quand un appareil le déplace et qu'un autre l'édite.
Loro fournit ensemble : texte riche, arbre avec move de nœud, ordre fractionnel,
version vectors, updates incrémentales, historique, time travel et snapshots
compacts. Sa licence est MIT et le package JavaScript/WASM fonctionne dans
Node et les navigateurs.

Cette combinaison correspond au modèle canonique existant : UUID stables,
blocs imbriqués, ordre, texte et marques. Elle ne dépend pas de BlockNote ; un
autre éditeur peut produire les mêmes opérations.

**Prototype comparison**:

| Scénario hors ligne | BlockNote + Yjs natif | Modèle Loro `Tree` + `Text` |
| --- | --- | --- |
| Deux éditions à des positions différentes du même paragraphe | Convergence correcte vers `Hello brave world!` | Convergence correcte vers `Hello brave world!` |
| Deux insertions au même emplacement | Ordre déterministe | Ordre déterministe |
| Déplacer `p1` sur A, éditer `p1` sur B | L'édition a pu apparaître dans `p2` après fusion | `p1` est déplacé et porte l'édition |
| Deux moves concurrents du même bloc | Dépend de la structure ProseMirror suppression/insertion | Un nœud unique, position convergente, aucun doublon |
| Supprimer `p1` sur A, éditer `p1` sur B | L'édition devient invisible dans le document final | Le nœud est supprimé mais son texte édité reste récupérable dans l'historique |

La limite Yjs observée concerne le binding « un document ProseMirror complet » :
le move visible est représenté par suppression/insertion et n'exprime pas
l'identité sémantique MyOwnNotion. Ce n'est pas une condamnation générale de
Yjs. Il resterait possible de construire un arbre stable au-dessus de Yjs, mais
cela revient à concevoir le modèle que Loro fournit déjà et abandonne
l'intégration native qui faisait son principal avantage ici.

**Prototype de faisabilité 500 blocs**:

- 500 blocs, texte et marques : construction du modèle en 18,22 ms ;
- snapshot : 65 775 octets ; historique complet d'updates : 118 822 octets ;
- chargement du snapshot : 1,03 ms ;
- édition textuelle incrémentale : 96 octets ;
- version vector : 5 octets dans ce scénario à un pair.

Ces chiffres proviennent d'un micro-benchmark local et ne sont pas une promesse
de production. Ils montrent seulement que le modèle mérite l'implémentation et
les vrais tests de performance du dépôt.

**Alternatives considered**:

- **Yjs 13.6.x** : excellente maturité, updates commutatifs/idempotents et
  intégration BlockNote prête. Retenu comme référence, rejeté comme document
  autoritaire après le scénario move+edit. Un modèle Yjs custom par bloc serait
  possible mais plus de travail que LoroTree.
- **Automerge 3** : cœur MIT stable, protocole de sync et rich text sérieux.
  Le binding ProseMirror officiel se présente encore comme beta et contraint le
  schéma ; aucun arbre mobile de premier rang ne répond directement au move
  sémantique des blocs.
- **BlockSuite store/Yjs** : possède des blocs stables et un store complet, mais
  impose une migration vers son infrastructure entière et reste annoncé early
  stage.
- **Opérations métier maison** : `insertBlock`, `moveBlock`, `updateText`
  semblent simples, mais ordre concurrent, texte riche et historique
  reconstruiraient progressivement un CRDT non éprouvé.
- **Fusion JSON actuelle améliorée** : une fusion récursive réduirait certains
  conflits, mais pas deux éditions du même paragraphe ni les moves concurrents
  généraux.
- **ElectricSQL, PowerSync ou réplication de lignes** : excellents pour faire
  voyager des lignes locales, mais ne définissent pas la fusion riche d'une
  même valeur textuelle ou d'un arbre concurrent.

**Sources**:

- Loro, dépôt MIT et capacités : https://github.com/loro-dev/loro
- Loro, synchronisation et version vectors :
  https://www.loro.dev/docs/tutorial/sync
- Loro, arbre mobile et ordre : https://www.loro.dev/docs/tutorial/tree
- Loro, texte riche et curseurs stables :
  https://www.loro.dev/docs/tutorial/text
- Loro, gestion critique des Peer IDs :
  https://www.loro.dev/docs/concepts/peerid_management
- Yjs, updates : https://docs.yjs.dev/api/document-updates
- BlockNote, intégration Yjs :
  https://www.blocknotejs.org/docs/features/collaboration
- Automerge, cœur et statut : https://github.com/automerge/automerge
- Automerge ProseMirror, statut beta :
  https://github.com/automerge/automerge-prosemirror

## Decision 3 — Pair aléatoire par session, frontière par appareil

**Decision**: Laisser Loro générer un Peer ID aléatoire pour chaque instance
d'éditeur. Ne jamais utiliser l'UUID du propriétaire, de l'appareil ou de la
page comme Peer ID. Persister les opérations et le checkpoint contenant ce pair
avant tout échange ; un rechargement peut ouvrir une nouvelle session avec un
nouveau pair. Suivre séparément, côté produit, la version vector complète connue
par chaque appareil et chaque page.

**Rationale**: L'identité d'une opération Loro est `(peerId, counter)`. Réutiliser
un pair après perte de son compteur ou l'utiliser dans deux onglets peut créer
deux opérations différentes sous le même ID et une divergence irrécupérable.
Les IDs aléatoires par session évitent coordination et verrou global entre
onglets. L'attribution utilisateur reste portée par `deviceId` dans l'enveloppe
serveur, pas par le Peer ID interne.

La frontière d'appareil répond à une autre question : quelles opérations ce
device a-t-il déjà intégrées ? Elle sert au catch-up et à la compaction, sans
imposer qu'un appareil n'ait qu'un pair historique.

**Alternatives considered**:

- Pair stable par appareil : collision immédiate entre onglets et risque de
  compteur réinitialisé après effacement local.
- Pair stable par page/appareil : même défaut, avec une table supplémentaire.
- Verrou Web Locks pour réutiliser un pair : possible mais inutile ; un crash,
  un navigateur sans verrou partagé ou une restauration de profil agrandit la
  surface de corruption.

**Source**: https://www.loro.dev/docs/concepts/peerid_management

## Decision 4 — Une autorité opérationnelle et une projection canonique

**Decision**: Pour une page migrée, l'état Loro est l'autorité causale de
l'édition. `myownnotion.document+json` reste le contrat canonique sémantique,
mais devient une projection déterministe à une frontière donnée. Enregistrer
frontière et digests des deux représentations ; bloquer toute promotion,
indexation ou compaction en cas de désaccord.

**Rationale**: Abandonner le document canonique couplerait exports, recherche,
backlinks, sauvegardes et futurs clients à un moteur binaire. Garder le JSON et
Loro comme deux sources modifiables créerait au contraire deux gagnants
possibles. Une direction unique résout le problème : opérations → projection.

Le serveur sait déchiffrer les données selon le canevas ; il peut donc appliquer
les updates, valider la projection, reconstruire liens/usages et produire un
checkpoint cohérent dans une même transaction.

**Alternatives considered**:

- Loro comme simple cache dérivé du JSON : chaque sauvegarde complète
  réinitialiserait l'historique causal et réintroduirait les conflits.
- JSON et Loro tous deux autoritaires : aucun moyen sûr de choisir en cas de
  divergence.
- Format BlockNote/Yjs comme canon : verrouillage éditeur et perte de la
  compatibilité durable existante.

## Decision 5 — Réutiliser transport/outbox/SSE, ajouter un canal d'updates

**Decision**: Conserver l'authentification, les appareils, les clés, Dexie, la
file durable, les retries idempotents, le curseur de changements et SSE. Ajouter
des lots de mises à jour de page et un échange de version vectors par HTTP. SSE
continue d'annoncer une nouvelle position ; il ne transporte pas le contenu.

**Rationale**: Le problème actuel n'est pas l'absence d'une file robuste. Il est
la mutation `page.document.replace` et la fusion par états complets. Réutiliser
les fondations réduit le changement aux données éditoriales et garde les mêmes
contrôles de protocole, rotation, révocation et reprise.

Les lots locaux sont durables individuellement puis peuvent être fusionnés pour
le transport. Une identité de lot stable rend la requête idempotente. La réponse
indique ce qui a été accepté, les updates manquantes, la nouvelle frontière, la
révision consolidée éventuelle et les ambiguïtés.

**Alternatives considered**:

- WebSocket : aucun besoin de second chemin d'écriture ; HTTP groupé satisfait
  l'objectif sous deux secondes et réutilise toutes les protections.
- Provider Yjs/Loro hébergé : dépendance externe contraire à l'auto-hébergement,
  au chiffrement et à la maîtrise du modèle.
- WebRTC : complexité réseau et identité sans bénéfice pour un serveur canonique
  mono-utilisateur.

## Decision 6 — Persistance chiffrée custom, pas les providers par défaut

**Decision**: Écrire checkpoints, updates, conflits et projection dans les
tables Dexie chiffrées de MyOwnNotion. Côté serveur, conserver routage et
identités en colonnes, et les octets privés dans les enveloppes applicatives
existantes. Ne pas utiliser `y-indexeddb`, un provider Loro générique ou une
base locale en clair.

**Rationale**: La constitution exige le chiffrement applicatif des contenus et
files locales. Les providers génériques optimisent la persistance CRDT, mais ne
connaissent ni la clé d'appareil, ni les AAD MyOwnNotion, ni la rotation, ni la
suppression sécurisée. La frontière de sécurité existante doit rester unique.

Le commit local regroupe mise à jour scellée, frontier, projection et statut.
Si quota ou chiffrement échoue, la transaction entière échoue et l'éditeur
affiche que la saisie n'est pas confirmée localement.

## Decision 7 — Conflits sémantiques au-dessus de la convergence mécanique

**Decision**: Laisser le CRDT converger mécaniquement, puis détecter les
intentions concurrentes incompatibles à partir des deltas et bases causales :
suppression contre édition/move d'un même nœud ou descendant, transformations
différentes d'un même type, propriété non fusionnable différente. Conserver un
`PageAmbiguity` durable avec frontières, updates et contenu récupérable.

**Rationale**: « Conflict-free » signifie que les réplicas obtiennent le même
état, pas que cet état respecte toujours les deux intentions humaines. Une map
peut choisir déterministement une valeur et masquer l'autre. Le produit doit
être plus conservateur : convergence pour le texte/moves compatibles, décision
pour la suppression ou transformation incompatible.

Les tombstones et l'historique Loro permettent de récupérer le texte d'un nœud
supprimé. La compaction reste bloquée tant que l'ambiguïté ou sa période de
rétention en dépend.

## Decision 8 — Compaction bornée par les appareils autorisés

**Decision**: Conserver un checkpoint et un update log ; suivre une frontier par
page/appareil. Compacter seulement avant une frontière dominée par tous les
appareils encore autorisés et non requise par conflits, historique ou
sauvegardes. La révocation explicite retire la frontier de l'appareil.

**Rationale**: Une rétention « 90 jours » contredit l'exigence d'un appareil
autorisé déconnecté sans limite arbitraire. À l'inverse, ne jamais compacter
rend l'historique infini. L'appareil autorisé devient la borne produit visible :
le propriétaire choisit quand cesser d'attendre son retour.

Un nouvel appareil part du checkpoint actuel. Un appareil révoqué ne peut pas
revenir avec des opérations anciennes, même si elles sont valides au sens CRDT,
car l'autorisation est vérifiée avant import.

Les [API JavaScript Loro](https://www.loro.dev/docs/api/js) et leur
[guide d'encodage](https://loro.dev/docs/tutorial/encoding) distinguent la
snapshot complète, qui conserve l'historique, de la shallow snapshot, qui
supprime l'histoire antérieure à sa frontière et ne peut donc pas importer une
update concurrente ou antérieure à ce départ shallow. En conséquence :

- le serveur crée périodiquement une snapshot complète vérifiée pour borner le
  coût de replay, sans supprimer les updates ;
- seule une snapshot shallow créée après convergence de tous les appareils
  autorisés peut couvrir une compaction ;
- un appareil absent ne perd jamais sa base causale à cause du seul âge de sa
  dernière connexion.

Le test 90 jours/10 000 updates a également invalidé deux raccourcis : une
fenêtre d'ambiguïté limitée à exactement 10 000 lignes omettait la première
update de retour, et rescanner depuis la séquence zéro à chaque page de 64
updates rendait le rattrapage quadratique. La décision est donc de paginer toute
la fenêtre retenue, de faire avancer la frontier confirmée depuis son préfixe
monotone et de comparer la frontier d'auteur d'une update avant de la renvoyer.

**Alternatives considered**:

- TTL fixe : peut rendre impossible la fusion de travail encore légitime.
- Garder tout indéfiniment : coût illimité sans contrôle du propriétaire.
- Snapshot shallow sans suivi des devices : peut supprimer une dépendance
  causale requise par le retour d'un appareil.
- Uniquement des snapshots shallow périodiques : Loro refuse légitimement la
  branche ancienne dont les dépendances ont été retirées.
- Rejouer depuis le genesis à chaque requête : correct mais quadratique pendant
  un long rattrapage et incompatible avec un petit serveur auto-hébergé.

## Decision 9 — Migration paresseuse et protocole éditorial v3

**Decision**: Introduire le protocole 3 pour les updates de page. Lire les
documents v2 sans mutation. Amorcer leur état opérationnel atomiquement à la
première écriture v3. Refuser `page.document.replace` sur une page active v3.
Conserver les clients v2 en lecture seule pour ces pages et traiter explicitement
toute mutation v2 locale en attente avant la bascule.

**Rationale**: Une migration au déploiement devrait ouvrir, convertir, chiffrer
et réécrire jusqu'à 100 000 pages, allonger le downtime, gonfler les sauvegardes
et compliquer le rollback. La migration paresseuse ne touche que ce qui est
édité et garde une projection lisible par la version précédente.

Le rollback applicatif est sûr en lecture via le JSON canonique. Il n'est pas
sûr en écriture après opérations v3, car un client v2 écraserait leur causalité ;
la procédure impose alors la version v3 ou la restauration de la sauvegarde
pré-migration.

Un deuxième prototype de raisonnement a exposé un cas qui interdit un bootstrap
naïf : deux clients hors ligne ne peuvent pas transformer chacun le même JSON
v2 en un genesis Loro puis fusionner leurs octets, car leurs nœuds internes ont
des identités différentes. Le client garde donc une `LegacyOfflineBranch`
sémantique. À la reconnexion, le serveur active sa tête courante et convertit
une fois le delta `base/local/head` vers l'état opérationnel actif par UUID,
diff caractère/marque, hiérarchie et ordre. La branche finale complète sert de
preuve de non-perte ; les transactions enregistrées conservent l'intention. Ce
pont est réservé à la migration et ne devient pas un second algorithme de sync
normal.

La négociation réutilise les en-têtes existants. Le protocole général annoncé
devient 3, mais la capacité d'écriture éditoriale est vérifiée par route/page :
un client v2 peut encore exécuter une commande inchangée et écrire une page
legacy, tandis qu'il ne peut ni appeler `page-operations`, ni remplacer une
page déjà active.

## Decision 10 — Historique consolidé, restauration par nouvelles opérations

**Decision**: Ne pas créer une révision utilisateur par caractère. Conserver
une fenêtre globale de consolidation par page : la fermer après 30 secondes
sans update, au plus tard après 5 minutes d'édition continue, à une demande de
fin de session propre ou avant une borne sémantique (import, restauration,
résolution d'ambiguïté ou changement de schéma). Conserver l'oplog technique et
restaurer une ancienne version en calculant de nouvelles opérations à l'état
courant ; ne pas remplacer directement le document.

**Rationale**: L'oplog sert à converger et voyager dans le temps ; l'historique
visible sert à comprendre. Les confondre produit des milliers de versions
illisibles. Une restauration par opérations peut ensuite se fusionner avec un
appareil hors ligne, alors qu'un remplacement rejoue le défaut actuel.

La projection canonique courante peut avancer pendant qu'une fenêtre est
ouverte. L'API distingue donc son digest de l'identifiant de la dernière
révision consolidée et indique si des changements plus récents existent. Le
serveur finalise toute fenêtre arrivée à échéance au prochain traitement et un
ordonnanceur le fait également sans dépendre de la fermeture du navigateur.

## Decision 11 — Tailwind, tokens et Ariakit comme système d'interface

**Decision**: Ajouter Tailwind CSS 4.3 via le plugin Vite, avec des variables CSS
sémantiques et des primitives React Ariakit internes. Utiliser dnd-kit pour
l'arbre et Lucide pour les icônes. BlockNote utilise sa vue Ariakit restylée par
les mêmes tokens.

**Rationale**: Tailwind ne rend pas automatiquement une interface qualitative,
mais fournit une grammaire statique et responsive commune, sans runtime, là où
le fichier CSS global actuel accumule les variantes. Les tokens gardent thèmes
et décisions visuelles centralisés ; Ariakit apporte les comportements de
focus et motifs accessibles sans imposer une apparence ; BlockNote Ariakit
évite une deuxième bibliothèque visuelle comme Mantine.

Le système commence par les primitives et états, puis migre chaque surface. Les
classes utilitaires ad hoc qui contournent les tokens sont interdites pour les
couleurs, ombres et z-index du produit.

**Alternatives considered**:

- Continuer uniquement le CSS global : possible, mais ne fournit aucune
  frontière de composant ni inventaire de variantes.
- SCSS : meilleure organisation syntaxique, mais pas de composants accessibles
  ni de contraintes de tokens par lui-même.
- Mantine/Material UI : système complet mais apparence, runtime et modèle de
  thème supplémentaires, alors que BlockNote et l'app doivent partager une
  identité propre.
- shadcn/ui copié : bons composants, mais une seconde collection à maintenir et
  recouper avec BlockNote ; Ariakit suffit comme fondation headless.

**Sources**:

- Tailwind avec Vite :
  https://tailwindcss.com/docs/installation/using-vite
- Ariakit, styles et attributs publics : https://ariakit.com/guide/styling
- WCAG 2.2 : https://www.w3.org/TR/WCAG22/
- Playwright, comparaisons visuelles :
  https://playwright.dev/docs/test-snapshots

## Decision 12 — Validation par matrice multi-contexte, pas seulement unit tests

**Decision**: Ajouter une matrice déterministe et property-based du modèle,
puis des scénarios Playwright avec deux contextes navigateur réellement
isolés. Couper le réseau, modifier, fermer, restaurer, reconnecter dans les deux
ordres et comparer projection, hiérarchie, historique et statuts.

**Rationale**: Une fonction CRDT pure peut converger tout en étant mal reliée à
l'éditeur, au chiffrement, à l'outbox ou à la restauration. Le bug Yjs
move+edit n'apparaît qu'à la frontière éditeur/modèle. Les gates doivent couvrir
chaque couche et leur composition.

La matrice minimale couvre : même paragraphe, même position, marques, blocs
différents, nested, moves distincts, move du même bloc, move+edit, delete+edit,
delete+move, crash après chaque transaction, 10 000 updates, longue absence,
fichier hors ligne, sauvegarde/restauration et client v2 en attente.

## Decision 13 — Interactions de workspace explicites sans nouveau framework

**Decision**: Étendre l'état de présentation IndexedDB existant pour les
préférences locales de `Favoris` et `Récents`; modéliser chaque cible dnd-kit
par une identité `before|inside|after`; conserver la toolbar BlockNote
Community pour les liens Web et ajouter un contrôleur équivalent pour le nœud
canonique `pageLink`. Les menus contextuels réutilisent les primitives Ariakit
et les commandes métier existantes.

**Rationale**: Les défauts observés viennent d'états et de cibles implicites,
pas d'une capacité manquante des bibliothèques. Déduire avant/après depuis
l'ancien index échoue dès qu'un élément change de parent. Une zone explicite
décrit directement l'intention et peut être montrée avant la mutation. De même,
BlockNote sait déjà éditer les liens Web, mais son contrôleur standard ne peut
pas deviner qu'un nœud inline MyOwnNotion contient l'identité stable d'une
page. Un petit contrôleur d'adaptation conserve cette identité sans doubler le
système visuel.

Les quatre préférences de raccourcis sont des choix de présentation par
appareil. Elles reçoivent des valeurs par défaut lors de la normalisation d'une
ancienne ligne locale et n'exigent ni migration serveur, ni outbox, ni CRDT.

**Alternatives considered**:

- synchroniser les préférences de sidebar : bruit opérationnel sans valeur
  éditoriale et comportement mobile/desktop potentiellement contradictoire ;
- conserver une seule zone de drop : impossible de distinguer fiablement
  insertion voisine et imbrication ;
- convertir `pageLink` en URL : perd l'identité après renommage ou déplacement ;
- ajouter une autre bibliothèque de menus ou de tree : dépendance et apparence
  supplémentaires pour des primitives déjà présentes.

## Decision 14 — Une interaction de lien, deux représentations canoniques

**Decision**: Remplacer les deux points d'entrée visibles de la décision 13 par
un contrôleur MyOwnNotion unique. Son champ cible recherche les pages actives
par nom ou chemin et accepte aussi `http:`, `https:` ou `mailto:`. Il crée ou
convertit ensuite la représentation canonique appropriée : marque `link` pour
le Web, nœud `pageLink` avec UUID pour une page. `/lien`, la toolbar et la
modification contextuelle ouvrent ce contrôleur ; les embeds restent une
commande explicite séparée.

La navigation conserve des chevrons compacts avant le libellé, élimine une
page de l'ensemble local des branches ouvertes dès qu'elle perd son dernier
enfant et privilégie une cible `before|after` lorsqu'elle recouvre la cible
`inside`. La sélection utilise un fond neutre de ligne complète, sans rail
accentué. Les liens non inclusifs retirent enfin toute marque ProseMirror
stockée à leur borne avant une nouvelle saisie.

**Rationale**: Les aides officielles de Notion distinguent bien trois objets
sous-jacents — mention/lien de page, lien Web et embed — mais l'utilisateur
cherche une cible ou colle une adresse sans avoir à comprendre le schéma de
l'éditeur. Le défaut courant associait même l'alias « lien » à un bookmark : il
ouvrait donc le mauvais objet et pouvait disparaître après validation. Un flux
commun résout l'ambiguïté d'usage tout en conservant l'UUID stable nécessaire
aux renommages et backlinks. Le nettoyage de marque applique la politique
canonique déjà décidée : un lien ne s'étend pas après sa borne droite.

**Sources**:

- Notion, liens et backlinks : https://www.notion.com/help/create-links-and-backlinks
- Notion, sous-pages et navigation : https://www.notion.com/help/create-a-subpage

**Alternatives considered**:

- conserver deux boutons « lien Web » et « page » : expose une distinction de
  stockage qui n'aide pas à choisir la cible ;
- traiter toute URL comme embed : charge du contenu tiers et change la mise en
  page alors qu'un lien simple était demandé ;
- stocker les pages comme URL : casse l'identité après renommage ou déplacement ;
- laisser ProseMirror étendre une ancienne marque après suppression : recrée
  silencieusement un lien que le propriétaire vient d'enlever.

## Resolved unknowns

| Question | Réponse |
| --- | --- |
| Éditeur visible | BlockNote Community Ariakit 0.54.x, sans XL |
| Autorité éditoriale | Modèle MyOwnNotion Loro indépendant de BlockNote |
| Structure concurrente | `LoroTree` mobile par blocs UUID |
| Texte riche concurrent | un `LoroText` fusionnable par bloc |
| Transport | HTTP/outbox/SSE existants, lots d'updates et version vectors |
| Persistance locale | Dexie chiffré custom, commit avant état localement enregistré |
| Conflits | Seulement intentions incompatibles, conservées au-dessus du CRDT |
| Longue absence | Compaction bornée par chaque appareil autorisé ; révocation explicite |
| Projection | JSON canonique déterministe, validé, dérivé de l'état opérationnel |
| Migration | Paresseuse au premier edit, protocole v3, ancien client read-only |
| Historique | Oplog technique + révisions visibles consolidées |
| Système visuel | Tailwind 4, tokens CSS, Ariakit, dnd-kit, Lucide |
| Préférences de raccourcis | état de présentation IndexedDB local à l'appareil |
| Cible de déplacement | zones dnd-kit explicites `before`, `inside`, `after` |
| Liens | deux contrôleurs compacts : identité canonique de page ou bookmark Web pleine largeur |
| Icône d'item | un grapheme emoji canonique nullable sur page/dossier, réutilisé par toutes ses représentations |

## Decision 15 — Icône portée par l'item et deux outils de référence explicites

**Decision**: Superséder la décision 14 pour l'interface visible. Une page ou
un dossier porte une propriété `icon` nullable, validée comme un grapheme emoji
Unicode. L'API canonique, la projection locale chiffrée, les snapshots, exports
et sauvegardes transportent cette propriété une seule fois. Le shell résout
ensuite l'icône de l'identité cible pour l'arbre, l'en-tête, la recherche et les
références internes.

Le lien interne reste un `pageLink` identifié par UUID. Son texte canonique
reste un fallback portable, mais le node view visible résout toujours le titre
et l'icône de la cible courante et empêche leur édition indépendante. Le
contexte de rendu compare la cible à la parenté hiérarchique de la page source
pour distinguer une sous-page directe d'une référence explicite.

Le Web n'utilise plus le même dialogue. Une action dédiée valide l'URL puis
insère un bloc `embed` de fournisseur `bookmark` sur une ligne entière. Son
rendu statique et sûr montre au minimum origine et URL ; les fournisseurs
interactifs restent dans `/embed` et gardent leur consentement/sandbox.

Le choix d'emoji réutilise les données Emoji Mart déjà nécessaires à
BlockNote, mais les déclare comme dépendances directes du client Web. Les
données sont embarquées afin que le sélecteur reste disponible hors ligne ; le
composant est placé dans un popover MyOwnNotion et n'introduit pas une seconde
bibliothèque générale d'interface.

**Rationale**: L'ancienne décision mélangeait une adresse et une identité de
page dans un champ lourd, autorisait un libellé interne divergent et rendait
l'emoji impossible à partager correctement entre l'arbre et le document. Les
deux intentions sont différentes pour le propriétaire et produisent déjà deux
représentations canoniques différentes. Les exposer séparément supprime
l'ambiguïté, réduit chaque outil et permet un parcours clavier prévisible.

**Evidence**: L'application Notion desktop observée le 2026-08-28 place
l'emoji sur l'identité de page, le réutilise dans la barre latérale et
l'en-tête, puis remplace l'emplacement de l'icône par le contrôle de branche au
survol. Les captures produit fournies montrent séparément la recherche de page
et la création d'un bookmark Web pleine largeur.

**Alternatives considered**:

- conserver le contrôleur unique de la décision 14 : reproduit l'ambiguïté
  constatée et maintient un dialogue plus lourd que chaque besoin ;
- stocker emoji et titre dans chaque `pageLink` : duplique des données et les
  rend obsolètes après renommage ;
- utiliser le sélecteur emoji distant : casse le parcours hors ligne ;
- transformer tout lien Web en iframe : augmente les risques de confidentialité
  et d'exécution tierce alors qu'un bookmark statique suffit.
