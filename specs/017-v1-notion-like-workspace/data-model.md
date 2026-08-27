# Data Model: Expérience V1 et synchronisation convergente

## 1. Autorité et projections

Une page active sous le protocole éditorial v3 possède une relation à sens
unique :

~~~text
État opérationnel de page (autorité causale)
        │
        ├── matérialisation déterministe
        ▼
Document canonique myownnotion.document+json v3
        │
        ├── liens internes / usages de fichiers
        ├── recherche
        ├── export
        ├── révision visible consolidée
        └── sauvegarde compatible
~~~

Le document canonique n'accepte plus d'écriture ordinaire directe une fois la
page active. Une divergence de digest entre état opérationnel et projection est
une erreur d'intégrité ; elle ne produit pas un choix last-write-wins.

Les items, placements, relations, fichiers et bases conservent leurs autorités
existantes. Le nouveau modèle couvre uniquement le corps éditorial d'une page.

## 2. État opérationnel en mémoire

### `OperationalPageDocument`

Enveloppe autour d'un `LoroDoc`.

| Champ logique | Représentation | Règle |
| --- | --- | --- |
| `schema` | root map ou constante d'enveloppe | `myownnotion.page-operations` |
| `schemaVersion` | entier | commence à `1`, migration explicite |
| `blocks` | root `LoroTree` | ordre fractionnel activé, aucune boucle |
| `documentMeta` | root `LoroMap` | valeurs non localisées et versionnées |
| `versionVector` | `VersionVector` encodée | résume tous les pairs connus |
| `frontiers` | frontiers Loro | borne exacte de l'état visible |

Le `PeerID` Loro est généré aléatoirement par instance d'éditeur. Il n'est ni
un `deviceId`, ni un `ownerId`. L'enveloppe réseau associe séparément les octets
à l'appareil authentifié.

### `OperationalBlockNode`

Un nœud du `LoroTree` correspond à un bloc persistant.

| Clé du `node.data` | Type | Règle |
| --- | --- | --- |
| `blockId` | UUID canonique | unique parmi les nœuds vivants ; stable à travers move, conversion et restauration |
| `type` | identifiant de type | valeur canonique, jamais un libellé traduit |
| `schemaVersion` | entier | version du payload de ce type |
| `props` | `LoroMap` fusionnable | propriétés connues, validées par type |
| `content` | `LoroText` fusionnable ou structure typée | texte et marques du bloc |
| `rawUnknown` | JSON opaque | présent pour un bloc/propriété inconnu, non normalisé |
| `fileRefs` | liste d'UUID | références logiques ; les octets restent dans la feature 005 |

La parenté et l'ordre ne sont jamais dupliqués dans `props` : le `LoroTree` est
l'unique autorité opérationnelle de placement des blocs.

### Texte riche

Chaque bloc textuel possède son propre `LoroText`, créé ou retrouvé par une clé
fusionnable déterministe du nœud. Les positions utilisent les indices UTF-16
attendus par le Web ; les conversions UTF-8 restent explicites aux frontières.

Les attributs v3 sont :

- `bold: true` ;
- `italic: true` ;
- `underline: true` ;
- `strike: true` ;
- `code: true` ;
- `link: { href }` ;
- `pageLink: { itemId }` ;
- `textColor: <token canonique ou couleur validée>` ;
- `backgroundColor: <token canonique ou couleur validée>` ;
- attribut inconnu conservé sous forme opaque.

Les politiques d'expansion des marques sont configurées de façon identique
dans le client, le serveur et les tests. Les liens ne s'étendent pas au texte
tapé après leur borne ; les styles typographiques suivent le comportement
documenté dans le contrat de format.

### Types de blocs v3

Le format canonique v3 conserve les noms déjà écrits en v2 afin qu'une
migration ne renomme pas artificiellement le contenu. L'adaptateur BlockNote
traduit ses noms natifs (`checkListItem`, `codeBlock`, etc.) à cette frontière.
Le format canonique couvre :

- `paragraph` ;
- `heading` niveaux 1 à 3 ;
- `bulletedListItem` ;
- `numberedListItem` ;
- `checkbox` ;
- `quote` ;
- `code` avec langage optionnel ;
- `divider` ;
- `toggle` ;
- `callout` ;
- `table`, `tableRow`, `tableCell` ;
- `image` ;
- `fileEmbed` ;
- `embed` avec fournisseur explicitement autorisé ;
- `unknown`.

Les listes, toggles, callouts et cellules utilisent les enfants du tree lorsque
leur contenu est hiérarchique. Les lignes/cellules d'une table portent des IDs
stables afin que deux appareils puissent éditer des cellules distinctes.

## 3. Projection canonique

### `CanonicalProjectionResult`

~~~ts
interface CanonicalProjectionResult {
  pageId: Uuid;
  operationalFrontier: Uint8Array;
  operationalDigest: string;
  document: PageDocumentV3;
  canonicalDigest: string;
  pageLinkTargets: Uuid[];
  fileUsageIds: Uuid[];
  warnings: ProjectionWarning[];
}
~~~

`operationalDigest` identifie l'ensemble causal des opérations de la page : il
est calculé à partir de l'identité de page et de la version vector canonisée.
Deux rejeux contenant exactement les mêmes opérations produisent donc le même
digest, même si Loro sérialise leurs snapshots dans un ordre d'octets différent.
Ce digest logique ne remplace jamais le `snapshot_digest`, qui contrôle
l'intégrité des octets précis d'un checkpoint.

Invariants :

1. parcours depth-first suivant l'ordre du `LoroTree` ;
2. un seul nœud vivant par `blockId` ;
3. aucun cycle ;
4. UUID et types validés ;
5. marques triées/canoniques indépendamment de l'ordre d'import ;
6. blocs inconnus reproduits sans réduction ;
7. liens et usages dérivés uniquement du document projeté ;
8. même état opérationnel logique → mêmes octets JSON canoniques et digest.

Le résultat n'inclut pas les tombstones dans le corps visible. Les tombstones
requis par une ambiguïté restent dans l'état opérationnel et sont référencés par
`PageAmbiguity`.

## 4. Enveloppes de mise à jour

### `PageUpdateEnvelope`

| Champ | Type | Sensibilité / règle |
| --- | --- | --- |
| `updateId` | UUID v7 | identité idempotente, visible |
| `workspaceId` | UUID | routage, injecté/vérifié par le serveur |
| `pageId` | UUID | routage |
| `authoredByDeviceId` | UUID | vient de la session, jamais du body client |
| `protocolVersion` | `3` | refuse toute autre écriture |
| `operationalFormatVersion` | entier | version de l'encodage MyOwnNotion/Loro |
| `baseVersionVector` | octets | chiffrés au repos ; état connu avant transaction |
| `updateBytes` | octets | chiffrés au repos ; update Loro validée |
| `updateDigest` | SHA-256 | lié aux octets et au contexte AAD |
| `createdAt` | instant client | informatif, non utilisé pour ordonner |
| `acceptedAt` | instant serveur | null avant acceptation |
| `status` | état | `pending`, `sending`, `accepted`, `blocked` |

Un même `updateId` avec le même digest rejoue le résultat précédent. Le même ID
avec un digest différent est une violation d'intégrité et bloque l'appareil
jusqu'au diagnostic.

Le serveur ne fait pas confiance à un résumé sémantique client. Il calcule les
blocs et champs touchés depuis le delta importé et sa base causale.

## 5. Entités serveur

Les noms ci-dessous sont les noms de conception ; la migration Drizzle peut
adapter les contraintes et index sans changer leur sens.

### `page_operation_states`

Une ligne par page.

| Colonne | Règle |
| --- | --- |
| `page_id` PK/FK | exact `items.id`, page seulement |
| `workspace_id` | intégrité tenant unique |
| `status` | `legacy`, `initializing`, `active`, `blocked` |
| `operational_format` | `myownnotion.page-operations+loro` |
| `operational_version` | commence à 1 |
| `current_checkpoint_id` | checkpoint vérifié |
| `current_frontier_envelope_id` | version vector/frontier chiffrée |
| `operational_digest` | digest causal canonique de l'identité de page et de sa version vector |
| `canonical_digest` | digest de `page_documents` à la même frontière |
| `canonical_format_version` | 2 pour legacy, 3 après migration |
| `last_update_sequence` | séquence de page monotone |
| `last_revision_id` | dernière révision visible consolidée |
| `revision_window_started_at` | début de la fenêtre globale non consolidée, null si aucune |
| `revision_window_last_update_at` | dernière update de la fenêtre, null si aucune |
| `revision_window_frontier_envelope_id` | frontier courante à consolider, scellée |
| `bootstrapped_at`, `updated_at` | temps serveur |

Transitions :

~~~text
absent/legacy ── première écriture v3 ──> initializing ── commit vérifié ──> active
       ▲                                      │
       └──────── rollback sans écriture ──────┘

active ── intégrité/projection impossible ──> blocked ── réparation vérifiée ──> active
~~~

Une page `initializing` n'est jamais présentée comme éditable. Un crash avant le
commit laisse l'état legacy ; un crash après commit laisse l'état active complet.

Une fenêtre de révision ouverte n'est pas une perte d'historique : chaque
update est déjà dans l'oplog et la projection courante est commitée. Elle est
finalisée après 30 secondes sans update, après 5 minutes au maximum, sur borne
sémantique ou fin propre. Après un arrêt, le prochain accès clôt toute fenêtre
échue avant de répondre à l'historique.

### `page_operation_updates`

Une ligne par lot accepté ou refus terminal.

| Colonne | Règle |
| --- | --- |
| `id` PK | `updateId` idempotent |
| `page_id`, `workspace_id` | index `(page_id, page_sequence)` |
| `page_sequence` | ordre serveur d'acceptation, pas ordre causal |
| `authored_by_device_id` | FK appareil, conservée dans l'historique |
| `base_frontier_envelope_id` | base causale chiffrée ; null après compaction sûre |
| `result_frontier_envelope_id` | frontier après import, toujours conservée |
| `update_envelope_id` | octets chiffrés ; null après compaction sûre |
| `update_digest` | unique avec `id` |
| `status` | `accepted`, `rejected` |
| `failure_code` | null ou problème stable |
| `accepted_at` | temps serveur |
| `compacted_at` | null, ou date de retrait des deux payloads devenus redondants |

`page_sequence` sert à paginer et sauvegarder ; la convergence dépend des
version vectors internes, jamais de cette séquence.

`base_frontier_envelope_id` et `update_envelope_id` possèdent chacun un index de
support de clé étrangère. PostgreSQL ne les crée pas automatiquement ; sans ces
index, retirer les enveloppes couvertes vérifierait chaque référence par un scan
complet de l'oplog et rendrait la compaction quadratique.

La compaction ne supprime jamais la ligne d'update. `id`, digest, appareil,
séquence d'origine et frontier résultante forment un reçu d'idempotence
immuable : une requête rejouée après perte de réponse obtient encore exactement
la séquence et la frontier déjà acceptées. Seuls la base causale et les octets
volumineux couverts par le checkpoint sont retirés.

### `page_operation_checkpoints`

| Colonne | Règle |
| --- | --- |
| `id` | UUID |
| `page_id` | page concernée |
| `through_page_sequence` | dernière update incluse |
| `frontier_envelope_id` | frontier chiffrée |
| `snapshot_envelope_id` | snapshot opérationnelle chiffrée |
| `snapshot_digest` | intégrité |
| `canonical_digest` | projection à cette frontier |
| `revision_id` | révision consolidée correspondante, si créée |
| `state` | `candidate`, `verified`, `superseded`, `retained` |
| `created_at`, `verified_at` | temps serveur |

Deux encodages Loro utilisent cette même entité et les mêmes contrôles
d'intégrité :

- la snapshot complète de replay conserve tout l'historique causal ; elle est
  créée tous les 512 updates au plus, vérifiée après scellement puis promue pour
  borner le prochain chargement, sans retirer les payloads de l'oplog ;
- le candidat de compaction est une shallow snapshot à la frontier courante ;
  il est indépendant des checkpoints de replay et ne peut être promu ni utilisé
  pour compacter avant vérification et satisfaction de toutes les frontiers de
  devices, sauvegardes, révisions et ambiguïtés.

Le `snapshot_digest` vérifie toujours le payload chiffré rouvert depuis le
stockage. Après ouverture, projection canonique et digest causal sont recalculés
pour prouver que le checkpoint représente aussi le même contenu et le même
ensemble d'opérations. Le hash brut d'une snapshot n'est jamais utilisé comme
identité logique : son encodage peut varier avec l'ordre d'import sans que
l'état CRDT varie.

La contrainte unique `(page_id, through_page_sequence)` garantit une seule
preuve scellée par frontière. Le checkpoint de replay est toujours créé avant
l'acceptation d'un nouveau lot, de sorte qu'une future shallow candidate de
compaction se situe à une frontière strictement ultérieure.

### `page_device_frontiers`

Clé `(page_id, device_id)`.

| Colonne | Règle |
| --- | --- |
| `frontier_envelope_id` | version vector complète connue, chiffrée |
| `frontier_digest` | intégrité/égalité sans journaliser les octets |
| `confirmed_page_sequence` | préfixe serveur contigu dominé par la frontier |
| `last_confirmed_at` | dernière confirmation serveur |
| `device_state` | `authorized` ou `revoked` copié pour décision de compaction |

Une frontier ne recule jamais pour le même appareil. Une annonce incomparable
indique que le device possède des opérations locales ; elle est importée avant
d'avancer la frontier confirmée. `confirmed_page_sequence` est le préfixe
contigu maximal dont la frontier résultante est dominée. Comme ces résultats
serveur sont monotones, sa vérification reprend au préfixe existant et s'arrête
au premier manque au lieu de rescanner toute la page.

La ligne est créée lorsqu'un appareil a persisté puis confirmé son premier état
opérationnel de cette page. Un appareil autorisé qui n'a jamais possédé cette
page ne bloque pas la compaction : il démarrera du checkpoint courant. Une
branche v2 détenue avant activation est couverte séparément par sa base
canonique et `legacyOfflineBranches`; elle n'est pas faussement représentée par
une frontier Loro vide.

### `page_ambiguities`

| Colonne | Règle |
| --- | --- |
| `id` | UUID |
| `page_id` | page concernée |
| `kind` | `delete-edit`, `delete-move`, `type-transform`, `property-transform`, `schema` |
| `status` | `open`, `resolved-keep`, `resolved-delete`, `resolved-custom` |
| `details_envelope_id` | blocs, deltas, snapshots et options chiffrés |
| `source_update_ids` | updates causales concernées |
| `opened_at`, `resolved_at` | temps serveur |
| `resolution_revision_id` | nouvelle révision, jamais une source altérée |

Deux détections du même couple causal et du même bloc produisent la même clé
logique et ne créent pas de conflits dupliqués.

## 6. Entités locales Dexie

La version locale passe de 6 à 7 sans supprimer les déclarations historiques.

### `pageOperationStates`

- clé `pageId` ;
- statut legacy/initializing/active/blocked ;
- snapshot/checkpoint scellé ;
- projection canonique scellée ;
- version vector/frontier scellée ;
- digests, format versions et dernière séquence serveur ;
- disponibilité locale et dernier accès pour l'éviction.

### `pageOperationUpdates`

- clé `updateId` ;
- index `pageId`, `status`, `enqueueOrder` ;
- body complet scellé, y compris base vector et octets ;
- statuts `pending`, `sending`, `accepted`, `blocked` ;
- résultat serveur scellé si nécessaire.

Les rows `sending` reviennent à `pending` au boot. Pendant l'exécution, chaque
échange ne peut libérer que les rows qu'il a lui-même revendiquées et les remet
à `pending` sur toute sortie qui précède le commit local. Un autre passage qui
observe cette revendication attend sans transport et ne peut envoyer le suffixe
causal. Une update acceptée peut être retirée seulement après inclusion vérifiée
dans le checkpoint local et frontier serveur correspondante.

### `pageAmbiguities`

Copie locale scellée des ambiguïtés ouvertes nécessaires au mode hors ligne et
à l'interface de résolution.

### `legacyOfflineBranches`

Pont de migration uniquement, créé lorsqu'un client v3 modifie hors ligne une
page dont il ne possède encore qu'un état canonique v2 :

- clé `pageId` ;
- révision et digest de base ;
- snapshot v2 de base s'il est nécessaire au futur diff ;
- projection locale v3 scellée ;
- transactions sémantiques ordonnées (texte, marque, insertion, suppression,
  déplacement et changement de type/propriété) ;
- fichiers locaux encore requis ;
- statut `editing`, `sending`, `blocked` ou `converted`.

Une branche ne contient jamais un checkpoint Loro présenté comme compatible
avec le serveur : deux initialisations Loro indépendantes d'un même JSON ne
partagent pas les mêmes identités internes. À la reconnexion, le serveur
convertit la branche par IDs canoniques vers des opérations sur l'état actif.
Le client ne supprime la branche qu'après avoir persisté atomiquement le
checkpoint actif, sa projection et les éventuelles ambiguïtés retournées.

### `workspacePresentation`

Préférences locales non canoniques :

- thème `system|light|dark` ;
- sidebar ouverte/fermée et largeur bornée ;
- visibilité et état déplié indépendants des raccourcis `Favoris` et
  `Récents` ;
- branches ouvertes ;
- dernier item ;
- ancre de scroll par page (`blockId`, offset interne, fallback pixel) ;
- préférences de densité autorisées.

Ces valeurs ne rejoignent pas le CRDT du document et ne sont pas synchronisées
entre appareils. Une ligne locale créée avant l'ajout des préférences de
raccourcis est normalisée avec les quatre valeurs à `true`, sans migration
destructive ni nouveau store IndexedDB.

## 7. État visible de synchronisation

L'état de page est dérivé, jamais choisi par un composant :

| État | Condition |
| --- | --- |
| `local-saving` | transaction éditeur non encore commitée dans Dexie |
| `local-saved` | Dexie commitée, aucune tentative réseau active |
| `pending` | au moins une update locale non confirmée |
| `syncing` | un lot est `sending` ou des updates distantes sont importées |
| `synced` | aucune update locale en attente et frontier serveur domine la frontier locale |
| `offline` | réseau indisponible ; état local durable explicite |
| `blocked` | quota, clé, protocole, révocation, validation ou intégrité empêche la progression |
| `attention` | au moins une `PageAmbiguity` ouverte |

`attention` peut coexister avec une frontier synchronisée : les updates sont
conservées et partagées, mais une intention doit être résolue. L'interface ne
doit pas appeler cet état « erreur de sauvegarde ».

## 8. Détection sémantique

À l'import d'une update, le serveur compare ses opérations aux changements non
dominés par sa `baseVersionVector`.

| Opération A | Opération B sur même identité | Résultat |
| --- | --- | --- |
| texte/mark | texte/mark | auto-convergence |
| move | texte/mark | auto-convergence, texte suit le bloc |
| move | move | auto-convergence déterministe |
| insert bloc X | insert bloc Y | auto-convergence déterministe |
| delete | texte/mark du bloc ou descendant | ambiguïté `delete-edit` |
| delete | insertion sous le bloc ou un descendant | ambiguïté `delete-edit`, sous-arbre inséré récupérable |
| delete | move du bloc ou descendant | ambiguïté `delete-move` |
| type A | type B différent | ambiguïté `type-transform` |
| propriété scalar A | même propriété scalar B différente | ambiguïté `property-transform` si le type ne définit pas de merge |
| schéma inconnu | écriture qui réduirait les données | blocage `schema` |

Le CRDT peut posséder un état visible déterministe avant résolution ; les
données alternatives restent néanmoins conservées et l'interface signale
l'ambiguïté. La branche récupérable rejoue ses changements sémantiques dans
l'ordre : une insertion de parent suivie d'une insertion d'enfant ne peut pas
perdre ce second enfant, y compris lorsque le parent canonique est une cellule
de tableau.

## 9. Résolution et résurrection

Résoudre une suppression concurrente ne modifie jamais la tombstone source.

- **Confirmer suppression** : clôt l'ambiguïté, conserve les sources selon la
  rétention, puis autorise une compaction future.
- **Conserver édition/move** : crée un nouveau nœud opérationnel vivant portant
  le même `blockId` canonique, copie le contenu choisi et l'insère à la position
  choisie. Il référence le nœud source dans les métadonnées d'historique.
- **Fusion personnalisée** : crée le nœud/résultat choisi après aperçu, puis une
  révision à plusieurs parents.

L'invariant « un seul nœud vivant par blockId » est vérifié avant commit.

## 10. Checkpoint et compaction

Soit `C` un checkpoint vérifié et `Fdevice(page)` la frontier confirmée de chaque
appareil autorisé. Les updates incluses avant `C` ne peuvent être supprimées que
si :

1. chaque `Fdevice(page)` domine la frontier de compaction ;
2. les ambiguïtés et révisions retenues n'en dépendent plus ;
3. une sauvegarde vérifiée contient le checkpoint et les données requises ;
4. un test de reconstruction depuis `C` reproduit le digest canonique ;
5. aucune rotation ou restauration n'est en cours.

Une révocation retire l'appareil de l'ensemble après commit de l'audit. Un TTL,
la dernière activité ou la date du checkpoint ne suffisent jamais seuls.

La promotion de `C` et le retrait des payloads couverts forment une seule
transaction. Les lignes d'updates et leurs frontiers résultantes restent
présentes comme reçus d'idempotence ; un client qui redemande des octets déjà
compactés doit repartir du checkpoint courant.

## 11. Sauvegarde et restauration

Le manifeste de sauvegarde ajoute :

- version du format opérationnel ;
- chaque `page_operation_state` ;
- checkpoint vérifié courant et checkpoints retenus ;
- update log non compactable ;
- frontiers des appareils autorisés ;
- ambiguïtés et sources ;
- digests de projection et révisions associées.

La restauration vérifie d'abord l'état opérationnel, le projette, compare le
JSON canonique et reconstruit les index. Un appareil autorisé absent peut
ensuite envoyer des updates plus récentes. Leur base antérieure n'est pas un
motif de rejet tant que leurs dépendances sont présentes ; elles sont importées
et convergent avec l'état restauré.

## 12. Rétention et éviction locale

Ne sont jamais évincés automatiquement :

- update locale non confirmée ;
- checkpoint nécessaire à une update locale ;
- ambiguity ouverte et ses sources ;
- fichier hors ligne référencé par une update non confirmée ;
- état dont le serveur n'a pas confirmé l'intégrité et la présence.

Une page entièrement synchronisée et non épinglée peut être remplacée
localement par ses métadonnées et frontier. Sa réouverture télécharge un
checkpoint vérifié, puis les updates postérieures.
