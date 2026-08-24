# Contract: Synchronisation opérationnelle des pages

## 1. Portée

Ce contrat remplace `page.document.replace` comme chemin normal du corps d'une
page. Il ne remplace pas :

- les commandes d'items, placements, lifecycle, bases ou relations ;
- le transfert et la vérification des octets de fichiers ;
- le flux SSE et le curseur workspace ;
- l'autorisation/révocation des appareils ;
- le chiffrement, la rotation ou les sauvegardes existants.

Le préfixe HTTP reste `/v1` parce qu'il identifie la famille d'API publique. La
compatibilité d'écriture est gouvernée par l'en-tête de protocole existant, qui
passe à `3`.

## 2. Invariants de transport

1. Toutes les routes sont authentifiées, vérifient CSRF, appareil, workspace,
   rotation et protocole avant de lire les octets.
2. Les version vectors, updates, snapshots, projections et détails de conflit
   sont dans le corps, jamais dans une URL ou un journal.
3. Un update possède un UUID stable et un digest. Réessayer est idempotent.
4. L'ordre d'envoi n'est pas l'ordre causal. Le serveur accepte un lot dont les
   dépendances sont déjà présentes et renvoie explicitement toute dépendance
   manquante.
5. Un appareil révoqué est refusé avant décodage ou import d'une update.
6. Une réponse « synchronized » signifie que le serveur domine la frontier que
   l'appareil a déclarée comme persistée, pas seulement qu'une requête HTTP a
   réussi.
7. Base64url est utilisé seulement pour transporter les octets dans JSON. Les
   octets sont chiffrés au repos des deux côtés et protégés par TLS en transit
   dans le déploiement public.
8. Le serveur décode la version vector intrinsèque de chaque update et vérifie
   qu'elle est cohérente avec `baseVersionVector`. Le champ client ne peut ni
   cacher une dépendance, ni faire apparaître une update concurrente comme
   descendante.

## 3. Négociation de protocole

Le client réutilise les en-têtes existants :

~~~http
X-MyOwnNotion-Client-Protocol: 3
~~~

Réponse :

~~~http
X-MyOwnNotion-Protocol: 3
~~~

Lors d'un refus, l'en-tête existant
`X-MyOwnNotion-Required-Protocol: 3` accompagne le problème.

La fenêtre générale reste distincte de la capacité éditoriale : le serveur
annonce le protocole 3, accepte encore le protocole 2 pour les commandes dont le
contrat n'a pas changé, et exige explicitement le protocole 3 sur les routes
`page-operations`. Un client v2 peut encore remplacer le document d'une page
`legacy`; dès que la page est `active`, ce remplacement est refusé avant de
lire son body. La constante globale ne doit donc pas rendre artificiellement
incompatibles les commandes d'items, fichiers ou bases qui restent sûres.

Un client v2 peut lire la projection canonique. Il ne peut pas appeler les
routes ci-dessous ni envoyer `page.document.replace` sur une page `active`.

La mutation `page.document.replace` relit l'état opérationnel dans la transaction
PostgreSQL `SERIALIZABLE` qui écrirait le document. Cette transaction est
l'unique frontière d'autorité : si activation et remplacement complet se
présentent ensemble, ils ne peuvent pas être acceptés tous les deux et une
tentative rejouée après un conflit de sérialisation réévalue l'exclusion avant
toute écriture. La route adapte ce refus au problème 426 ci-dessous seulement
après la décision transactionnelle ; elle ne préempte jamais le rejeu idempotent
d'une mutation qui avait déjà été acceptée avant l'activation.

Problème :

~~~json
{
  "code": "page-operations.protocol-read-only",
  "message": "Cette page utilise la synchronisation éditoriale v3. Mettez à jour cet appareil pour la modifier.",
  "requiredProtocol": 3,
  "readAllowed": true
}
~~~

## 4. Échange bidirectionnel

### `POST /v1/page-operations/{pageId}/sync`

Une requête peut à la fois confirmer la frontier durable du client, envoyer des
updates locales et demander les updates manquantes. Les limites initiales sont
64 updates et 1 MiB d'octets décodés par requête ; le serveur peut répondre
`hasMore`.

### Requête active

~~~ts
interface ActivePageSyncRequest {
  mode: "active";
  requestId: Uuid;
  operationalVersion: 1;
  persistedVersionVector: Base64Url;
  knownServerPageSequence: number;
  updates: Array<{
    updateId: Uuid;
    baseVersionVector: Base64Url;
    updateBytes: Base64Url;
    updateDigest: Sha256Hex;
    createdAt: Rfc3339Instant;
  }>;
  maxRemoteBytes: number;
  revisionBoundary?: "editor-closed";
}
~~~

`persistedVersionVector` désigne uniquement un état déjà chiffré et commit dans
Dexie. Le client ne l'avance pas pour un état seulement en mémoire.

### Réponse active

~~~ts
interface ActivePageSyncResponse {
  mode: "active";
  requestId: Uuid;
  pageId: Uuid;
  accepted: Array<{
    updateId: Uuid;
    pageSequence: number;
    resultVersionVector: Base64Url;
    consolidatedRevisionId?: Uuid;
  }>;
  repeated: Array<{
    updateId: Uuid;
    pageSequence: number;
    resultVersionVector: Base64Url;
  }>;
  remoteUpdates: Array<{
    updateId: Uuid;
    pageSequence: number;
    authoredByDeviceId: Uuid;
    updateBytes: Base64Url;
    updateDigest: Sha256Hex;
    acceptedAt: Rfc3339Instant;
  }>;
  serverVersionVector: Base64Url;
  throughPageSequence: number;
  latestPageSequence: number;
  hasMore: boolean;
  canonical: {
    format: "myownnotion.document+json";
    formatVersion: 3;
    digest: Sha256Hex;
    lastConsolidatedRevisionId: Uuid | null;
    hasUnconsolidatedChanges: boolean;
  };
  ambiguities: PageAmbiguitySummary[];
  fileRequirements: Array<{
    fileId: Uuid;
    state: "present" | "upload-required" | "verifying" | "rejected";
  }>;
}
~~~

Le serveur n'inclut pas dans `remoteUpdates` une update déjà dominée par
`persistedVersionVector`. Une update importée mais pas encore persistée sera
redemandée au prochain appel : l'import est idempotent.

`throughPageSequence` est la dernière ligne contiguë du journal que le serveur
a effectivement examinée pour cette réponse, y compris une ligne déjà dominée
ou accusée dans `accepted`/`repeated`. Le client l'avance seulement après avoir
persisté la réponse. `latestPageSequence` décrit la tête du journal et ne doit
jamais servir de curseur de rattrapage tant que `hasMore` vaut `true`.

`revisionBoundary` est un hint de fermeture propre, jamais la garantie de
durabilité. Le serveur applique sa propre politique : 30 secondes d'inactivité,
5 minutes maximum d'édition continue et bornes sémantiques. Le digest canonique
décrit toujours la projection courante ; l'identifiant de révision peut donc
décrire une frontier antérieure lorsque `hasUnconsolidatedChanges` vaut `true`.

### Transaction serveur

Tous les `accepted` d'une requête sont traités séquentiellement sous le verrou
de page mais commités atomiquement avec :

- update log chiffré ;
- état/checkpoint courant ;
- projection canonique et digests ;
- liens internes et usages de fichiers ;
- ambiguïtés ;
- frontier de l'appareil ;
- révision consolidée éventuelle ;
- changement workspace et notification après commit.

Une update invalide refuse le lot concerné sans avancer sa frontier. Les autres
updates indépendantes de la même requête peuvent être retournées comme
acceptées seulement si leurs transactions sont explicitement séparées ; la
première implémentation utilise une transaction de requête unique et refuse
toute la requête pour garder une sémantique simple.

## 5. Checkpoint de rattrapage

Lorsque le client n'a aucun état local ou demande une réinstallation, la même
route accepte :

~~~ts
interface EmptyPageSyncRequest {
  mode: "empty";
  requestId: Uuid;
  knownServerPageSequence: 0;
  maxRemoteBytes: number;
}
~~~

Réponse :

~~~ts
interface PageCheckpointResponse {
  mode: "checkpoint";
  requestId: Uuid;
  pageId: Uuid;
  operationalVersion: 1;
  checkpointId: Uuid;
  checkpointBytes: Base64Url;
  checkpointDigest: Sha256Hex;
  versionVector: Base64Url;
  throughPageSequence: number;
  canonicalDigest: Sha256Hex;
  lastConsolidatedRevisionId: Uuid | null;
  hasUnconsolidatedChanges: boolean;
  followingUpdates: RemotePageUpdate[];
  latestPageSequence: number;
  hasMore: boolean;
  ambiguities: PageAmbiguitySummary[];
}
~~~

Le serveur crée ou avance la `page_device_frontier` seulement après que le
client renvoie cette version vector comme `persistedVersionVector`. La remise du
checkpoint seule n'est pas un accusé de durabilité.

## 6. Première migration en ligne

### `POST /v1/page-operations/{pageId}/activate`

Utilisé quand serveur et client voient encore une page legacy et que le client
n'a aucune modification locale.

~~~ts
interface ActivatePageRequest {
  requestId: Uuid;
  expectedRevisionId: Uuid;
  expectedCanonicalDigest: Sha256Hex;
}
~~~

Le serveur :

1. verrouille la page ;
2. vérifie révision et digest ;
3. construit un checkpoint opérationnel depuis le document canonique ;
4. reproduit exactement la même projection ;
5. commit état active, checkpoint, digests et marqueur de protocole ;
6. retourne une `PageCheckpointResponse`.

Une requête répétée retourne le checkpoint actif. Une révision différente
retourne `page-operations.activation-stale` et le client recharge avant de
modifier.

## 7. Branche legacy modifiée hors ligne

Un client v3 peut être mis à jour alors qu'il est hors ligne et ne possède
qu'un document v2. Il peut continuer à travailler, mais persiste un
`LegacyOfflineBranch` plutôt que prétendre être déjà synchronisé.

~~~ts
interface LegacyOfflineBranchSyncRequest {
  mode: "legacy-branch";
  requestId: Uuid;
  branchId: Uuid;
  baseRevisionId: Uuid;
  baseCanonicalDigest: Sha256Hex;
  baseDocument?: PageDocumentV2;
  localDocument: PageDocumentV3;
  localDocumentDigest: Sha256Hex;
  semanticTransactions: LegacySemanticTransaction[];
  createdAt: Rfc3339Instant;
}
~~~

`branchId` est créé avant la première édition locale et reste stable à travers
rechargements et retries. Deux payloads différents sous le même `branchId` sont
une violation d'intégrité.

Si la branche a été ouverte pendant que la création optimiste de sa page était
encore dans l'outbox, sa révision de base peut garder l'identité locale connue
par la session montée. Avant chaque envoi, le client résout l'alias
local→canonique conservé lors de l'accusé serveur. Le journal et son document de
base ne sont pas réécrits ; seule l'identité de révision transmise devient celle
que le serveur a réellement créée et peut vérifier.

~~~ts
interface LegacySemanticTransaction {
  transactionId: Uuid;
  sequence: number;
  commands: LegacySemanticCommand[];
}

type LegacySemanticCommand =
  | {
      type: "insert-block";
      block: CanonicalBlockSubtreeV3;
      parentBlockId: Uuid | null;
      beforeBlockId: Uuid | null;
    }
  | {
      type: "move-block";
      blockId: Uuid;
      parentBlockId: Uuid | null;
      beforeBlockId: Uuid | null;
    }
  | { type: "delete-block"; blockId: Uuid }
  | {
      type: "replace-text";
      blockId: Uuid;
      baseFrom: number;
      baseTo: number;
      beforeContext: string;
      afterContext: string;
      text: string;
    }
  | {
      type: "set-mark";
      blockId: Uuid;
      baseFrom: number;
      baseTo: number;
      mark: CanonicalMarkV3;
      enabled: boolean;
    }
  | {
      type: "set-type-or-property";
      blockId: Uuid;
      key: string;
      before: JsonValue;
      after: JsonValue;
      properties?: JsonObject;
    }
  | {
      type: "insert-table-row";
      tableId: Uuid;
      row: TableRowV3;
      beforeRowId: Uuid | null;
    }
  | { type: "delete-table-row"; tableId: Uuid; rowId: Uuid }
  | {
      type: "insert-table-column";
      tableId: Uuid;
      column: TableColumnV3;
      cells: Array<{ rowId: Uuid; cell: TableCellV3 }>;
      beforeColumnId: Uuid | null;
    }
  | { type: "delete-table-column"; tableId: Uuid; columnId: Uuid };
~~~

Les offsets de la branche sont UTF-16 comme l'éditeur. Les contextes bornés ne
sont pas des identités causales ; ils aident seulement à vérifier le diff. Le
serveur reconstruit le document local en rejouant les transactions sur la base
et exige le même digest que `localDocument`. Il calcule ensuite le diff réel
sur `base/local/head`, y compris les lignes, colonnes et cellules de tableau,
afin qu'un client ne puisse pas masquer une réduction de données dans une
liste de commandes incomplète.

`baseDocument` est omis si le serveur possède encore le snapshot. S'il est
fourni, le serveur vérifie format, UUID, digest annoncé, lignée de révision
connue et cohérence avec les transactions. Il ne lui fait pas confiance comme
projection serveur.

Le serveur active d'abord la page à partir de sa tête canonique. Il effectue
ensuite une migration à trois entrées `base/local/head`, mais à granularité
sémantique :

- diff de texte caractère/marque par `blockId` ;
- insertion/suppression/move par IDs stables ;
- fusion récursive de la hiérarchie ;
- ambiguïté pour recouvrement impossible, delete/edit, delete/move ou schéma.

Le résultat compatible est exprimé comme nouvelles opérations dans l'état actif
et non comme remplacement complet. La réponse fournit un checkpoint actif que
le client persiste atomiquement avant de supprimer sa branche legacy.

~~~ts
interface LegacyBranchConvertedResponse extends PageCheckpointResponse {
  convertedBranchId: Uuid;
  conversionUpdateIds: Uuid[];
  localDocumentDigest: Sha256Hex;
  ambiguities: PageAmbiguitySummary[];
}
~~~

Une répétition du même `branchId` renvoie le même résultat de conversion, même
si le checkpoint courant a depuis avancé ; les updates de conversion gardent
leurs identités et le catch-up normal fournit ensuite les changements manquants.

Deux branches legacy concurrentes peuvent être soumises dans n'importe quel
ordre. La deuxième est comparée à sa base et exprimée comme opérations ; une
simple différence de paragraphe ne devient pas un conflit de page entière.

## 8. Accusé de frontier sans nouvelle update

Un appel `mode: "active"` avec `updates: []` suffit. Il n'existe pas d'endpoint
GET avec version vector en query string.

L'état local `sending` représente uniquement une tentative interrompue. Il est
récupéré une fois à l'initialisation du stockage, avant le démarrage des
réconciliateurs. Un passage de synchronisation vivant ne récupère jamais les
updates d'une autre page : il pourrait sinon remettre en attente un envoi réel
et laisser les deux réconciliateurs se disputer la même ligne durable.

Un lot reçu dans une même requête est validé et importé dans son ordre causal,
puis projeté une seule fois. Le serveur scelle en groupe les octets et les
frontiers, attribue une séquence contiguë à chaque update immuable et avance
l'état final de la page dans la même transaction PostgreSQL. Aucun lecteur ne
peut observer un préfixe du lot. Un échec d'enveloppe, de projection ou d'insert
annule le lot entier ; l'idempotence reste portée par chaque `updateId`, pas par
l'identité de la requête.

Les index dérivés comme la recherche peuvent reconstruire leur projection après
ce commit, mais ils ne font pas partie de l'accusé canonique et ne peuvent
bloquer ni le démarrage du workspace ni la synchronisation durable.

### 8.1 Checkpoints et reçus après compaction

Un shallow checkpoint reste candidat tant que ses octets scellés n'ont pas été
rouverts et reprojetés vers le digest canonique déclaré. Sa promotion et le
retrait des payloads couverts sont atomiques et restent interdits tant qu'une
frontier d'appareil non révoqué, une ambiguïté, l'historique, une sauvegarde
vérifiée, une rotation ou une restauration ne donne pas une preuve favorable.
L'âge d'une update ou d'un appareil n'est jamais une preuve.

Après promotion, le serveur conserve pour chaque update compactée son
`updateId`, son digest, son appareil, sa `pageSequence` d'origine et sa frontier
résultante. Ce reçu immuable permet de répondre idempotemment à une nouvelle
tentative dont la première réponse s'est perdue. Les octets et la base causale
peuvent être absents ; un client qui ne domine pas encore cette frontier reçoit
`page-operations.dependencies-missing` et recharge le checkpoint courant.

## 9. Ambiguïtés

~~~ts
interface PageAmbiguitySummary {
  ambiguityId: Uuid;
  pageId: Uuid;
  kind:
    | "delete-edit"
    | "delete-move"
    | "type-transform"
    | "property-transform"
    | "schema";
  blockIds: Uuid[];
  openedAt: Rfc3339Instant;
  status: "open";
}
~~~

Le résumé ne contient pas de texte. Le détail est demandé par :

### `GET /v1/page-ambiguities/{ambiguityId}`

Réponse authentifiée et `Cache-Control: no-store` : base commune, intention A,
intention B, bloc/sous-arbre récupérable, placements et options de résolution.

### `POST /v1/page-ambiguities/{ambiguityId}/resolve`

~~~ts
type ResolvePageAmbiguityRequest =
  | { requestId: Uuid; decision: "confirm-delete" }
  | {
      requestId: Uuid;
      decision: "restore-change";
      parentBlockId: Uuid | null;
      beforeBlockId: Uuid | null;
    }
  | {
      requestId: Uuid;
      decision: "custom";
      result: CanonicalBlockSubtreeV3;
      parentBlockId: Uuid | null;
      beforeBlockId: Uuid | null;
    };
~~~

La résolution produit des opérations et une nouvelle révision. Elle ne modifie
ni ne supprime les updates sources.

## 10. Fichiers

Une update qui crée une référence de fichier peut être acceptée alors que les
octets restent locaux. La page affiche alors `pending-files`; elle n'est pas
globalement « synchronized ». Le client reprend l'upload idempotent de la
feature 005. Le serveur ne marque la référence complète qu'après vérification du
blob et reconstruit l'usage dans la projection canonique.

Supprimer la référence avant la fin de l'upload n'efface pas une update locale ;
le cycle de vie du fichier décide ensuite si le blob orphelin peut être nettoyé.

## 11. SSE et change feed

Après commit, le serveur ajoute un événement workspace dont la nature est
`page-operations.updated` et `changedItemIds=[pageId]`. SSE annonce seulement le
nouveau curseur. Le client :

1. rattrape `/v1/changes` comme aujourd'hui ;
2. voit qu'une page opérationnelle a changé ;
3. appelle `/sync` avec sa version vector persistée ;
4. importe et persiste les updates ;
5. met à jour l'éditeur ciblé.

Un événement SSE perdu est couvert par le curseur. Plusieurs événements
coalescés n'entraînent qu'un échange de frontiers.

## 12. Problèmes stables

| Code | Effet client |
| --- | --- |
| `page-operations.protocol-read-only` | conserver local, bloquer l'envoi, demander mise à jour |
| `page-operations.not-active` | ouvrir la projection legacy sans confondre cette absence avec une corruption |
| `page-operations.activation-stale` | recharger tête/projection, ne rien supprimer |
| `page-operations.update-id-reused` | erreur d'intégrité, bloquer l'appareil |
| `page-operations.digest-mismatch` | conserver bytes locaux, diagnostic/réparation |
| `page-operations.dependencies-missing` | demander checkpoint/updates manquantes |
| `page-operations.projection-invalid` | serveur n'avance pas, état blocked |
| `page-operations.device-revoked` | aucun import, expliquer la révocation |
| `page-operations.rotation-blocked` | garder pending, reprendre après rotation |
| `page-operations.quota` | saisie non confirmée localement ou serveur, expliquer la couche |
| `page-operations.schema-unsupported` | lecture/projection sûre, écriture bloquée |

Chaque problème est expurgé : aucun texte, update binaire, version vector ou
nom de fichier n'est journalisé.

## 13. Cas d'acceptation contractuels

- même update deux fois → un seul `pageSequence`, même réponse ;
- même ID, digest différent → rejet d'intégrité ;
- updates A/B reçues A-B ou B-A → même digest canonique ;
- `persistedVersionVector` en retard → remote updates, pas conflit ;
- interruption après réponse mais avant Dexie → mêmes updates renvoyées ;
- device révoqué avec update valide → aucun import ;
- v2 replace sur page active → lecture seule ;
- branche legacy avec même paragraphe modifié ailleurs → merge caractère ou
  ambiguïté locale, jamais conflit document entier ;
- checkpoint corrompu → aucune compaction ni état synchronized ;
- fichier référencé mais blob absent → contenu conservé, état pending-files.
