# Data Model: Synchronisation éditoriale temps réel durable

## Authority map

~~~text
geste éditeur
    │
    ▼
mise à jour Loro chiffrée dans IndexedDB ── autorité locale non confirmée
    │
    ▼
échange WebSocket ou repli HTTP ────────── transport éphémère
    │
    ▼
transaction PostgreSQL
    ├── update immuable chiffrée
    ├── frontière causale chiffrée
    ├── projection canonique chiffrée
    ├── révision / séquence
    └── ambiguïtés éventuelles ─────────── autorité serveur durable
    │
    ▼
annonce page-advanced ──────────────────── indice éphémère, jamais autorité
~~~

Le socket, le hub et une annonce ne possèdent jamais l'unique copie d'un
contenu. La vérité causale reste le journal opérationnel ; la projection
canonique est reconstruite à une frontière vérifiée.

## Browser device identity

Cette identité existe avant la session et ne constitue pas un secret.

| Field | Type | Rules |
| --- | --- | --- |
| `version` | literal `1` | Permet une évolution explicite du format local |
| `deviceBindingId` | `web-` + UUID aléatoire | Stable dans un profil, distinct entre profils |
| `name` | string bornée | Nom initial visible et renommable depuis les réglages |
| `platform` | string bornée | Indication générale, jamais empreinte détaillée |

L'objet est partagé par les onglets via le stockage d'origine. Il ne porte ni
preuve d'autorité ni clé : le serveur ne l'accepte qu'après vérification du mot
de passe ou de l'assertion passkey. La contrainte unique
`(owner_id, device_binding_id)` empêche deux lignes pour le même profil. Une
ligne active est réutilisée, une ligne en attente de réautorisation peut revenir
à `active` après cette preuve, et une ligne révoquée reste terminale.

## Realtime session

Une session existe uniquement en mémoire dans le client et le processus API.

| Field | Type | Rules |
| --- | --- | --- |
| `connectionId` | UUID v7 | Créé par le serveur après `hello`, uniquement diagnostic |
| `ownerId` | UUID | Provient de la session cookie validée |
| `deviceId` | UUID | Doit rester autorisé pendant toute la session |
| `realtimeProtocolVersion` | integer | Exactement la version négociée |
| `pageOperationProtocolVersion` | integer | Version du payload de page réutilisé |
| `state` | enum | `awaiting-hello`, `ready`, `closing`, `closed` |
| `openedAt` / `lastSeenAt` | instant | Horloge serveur, jamais fournie par le client |
| `inFlight` | set of request IDs | Maximum huit ; libéré à réponse ou fermeture |
| `lastPongAt` | instant | Utilisé uniquement pour la vie de la session |

### Invariants

- Aucun message `sync` n'est traité avant `ready`.
- Un `requestId` ne peut être en vol qu'une fois sur une session.
- L'origine, le propriétaire et l'appareil sont immuables après l'upgrade.
- La fermeture supprime immédiatement la session du hub et empêche tout envoi
  différé.
- Un redémarrage serveur perd toutes les sessions sans perdre aucune mise à
  jour ; les clients se reconnectent et rattrapent leur frontière.

## Correlated realtime request

| Field | Type | Rules |
| --- | --- | --- |
| `requestId` | UUID v7 | Identique à `request.requestId` |
| `pageId` | UUID v7 | Identique à la page du payload et de la réponse |
| `request` | `PageSyncRequestDto` | Schéma opérationnel existant, max 64 updates / 1 MiB |
| `startedAt` | monotonic time | Pour timeout et métrique, non persisté |
| `state` | enum | `in-flight`, `answered`, `abandoned` |

Une requête `abandoned` après fermeture n'est pas annulée dans PostgreSQL. Si
elle finit par committer, le client le découvre à la nouvelle tentative par ses
identifiants immuables.

## Durable page update

Cette entité existe déjà localement et côté serveur ; la feature ne change pas
son identité.

| Field | Meaning |
| --- | --- |
| `updateId` | Identité globale immuable de l'intention |
| `pageId` | Page propriétaire |
| `authoredByDeviceId` | Appareil auteur côté serveur |
| `baseVersionVector` | Causalité connue au moment du geste |
| `updateBytes` / `updateDigest` | Opérations Loro et preuve d'intégrité |
| `resultVersionVector` | Frontière après import côté serveur |
| `pageSequence` | Ordre de stockage serveur, pas ordre causal unique |
| `status` local | `pending`, `sending`, `accepted`, `blocked` |
| `createdAt` / `acceptedAt` | Temps local informatif / temps serveur durable |

### State transitions

~~~text
pending ── sélection sous verrou ──► sending
   ▲                                  │
   │ socket perdu / timeout           ├── commit + réponse vérifiée ─► accepted
   └──────────────────────────────────┤
                                      └── refus permanent ───────────► blocked
~~~

`sending` est un marqueur de crash, pas une propriété du réseau. Le prochain
propriétaire du verrou le remet à `pending` avant de le sélectionner.

## Page advance announcement

| Field | Type | Rules |
| --- | --- | --- |
| `pageId` | UUID v7 | Page dont la transaction vient de committer |
| `latestPageSequence` | safe integer | Séquence serveur après commit |
| `announcedAt` | instant | Diagnostic uniquement |

Le destinataire compare `latestPageSequence` à
`PageOperationState.latestServerPageSequence`. Si elle est déjà dominée,
l'annonce est ignorée, y compris par l'auteur. Sinon elle coalesce un passage du
réconciliateur. Une annonce ne fait jamais avancer la séquence locale elle-même.

## Realtime client state

| State | Meaning | Allowed transition |
| --- | --- | --- |
| `idle` | Session non démarrée ou utilisateur non authentifié | `connecting`, `closed` |
| `connecting` | Handshake réseau en cours | `authenticating`, `backoff`, `closed` |
| `authenticating` | `hello` envoyé, attente de `ready` | `ready`, `backoff`, `revoked`, `needs-update` |
| `ready` | Échanges corrélés autorisés | `backoff`, `revoked`, `needs-update`, `closed` |
| `backoff` | Prochaine tentative planifiée avec jitter | `connecting`, `closed` |
| `revoked` | Appareil refusé, aucune nouvelle tentative automatique | `closed` |
| `needs-update` | Protocole incompatible | `closed` |
| `closed` | Cycle de vie terminé | aucune |

Le passage à `ready` déclenche un drain global. Le passage à `backoff` rejette
les promesses en vol comme hors-ligne mais ne touche pas directement la base ;
le réconciliateur possède cette transition sous verrou.

## Legacy sync recovery (local schema v9)

La nouvelle table ne porte aucun contenu utilisateur. Elle route vers le
conflit chiffré existant jusqu'à conversion.

| Field | Type | Rules |
| --- | --- | --- |
| `mutationId` | UUID | Clé primaire et FK logique vers `conflicts` |
| `pageId` | UUID or null | Index par page ; `null` seulement si payload et headers sont illisibles, sans inventer une identité |
| `status` | enum | `pending`, `converting`, `quarantined`, `converted` |
| `reasonCode` | safe string or null | Code borné, jamais message ou contenu |
| `branchId` | UUID or null | Branche sémantique durable créée pour cette récupération |
| `attemptCount` | non-negative integer | Diagnostic et backoff, pas décision de suppression |
| `capturedAt` | instant | Copié du conflit pour l'ordre déterministe |
| `updatedAt` | instant | Transition la plus récente |

### Transitions

~~~text
absent ── classification ──► pending
pending ── branche durable ─► converting
converting ── checkpoint installé + conflit retiré ─► converted
pending/converting ── preuve insuffisante ──────────► quarantined
quarantined ── preuve redevenue disponible ────────► pending
~~~

- `converted` signifie que l'intention est dans l'autorité opérationnelle et
  que l'ancien conflit a été retiré atomiquement.
- `quarantined` exige que le conflit chiffré existe encore. Une ligne orpheline
  est une erreur d'intégrité.
- Un crash en `converting` relit branche, état et conflit. Si le checkpoint est
  déjà installé, il termine ; sinon il reprend la même branche.
- Plusieurs récupérations d'une page sont ordonnées par `capturedAt`, puis
  `mutationId`. Une seule peut être `converting` à la fois.

## Active owner decision

Les ambiguïtés opérationnelles existantes restent la seule source de conflit
éditorial ordinaire.

| Field | Meaning |
| --- | --- |
| `ambiguityId` | Identité stable |
| `pageId` | Page concernée |
| `kind` | `delete-edit`, `delete-move`, transformation ou schéma |
| `status` | `open` ou résolution durable |
| `details` | Intentions chiffrées et contenu récupérable |

Une récupération `quarantined` est affichée dans les diagnostics comme ancien
brouillon à récupérer ; elle peut contribuer à `needsAttentionCount`, mais ne
porte pas le mot « conflit » et ne bloque pas l'édition opérationnelle courante.

## Derived synchronization status

Le statut visible est calculé, jamais persisté comme autorité.

| Input | Meaning |
| --- | --- |
| `localSaveFailure` | Le dernier geste n'a pas pu être écrit localement |
| `pendingUpdates` | Mises à jour page et mutations workspace durables non confirmées |
| `sendingUpdates` | Lots actuellement possédés par un réconciliateur |
| `pendingFiles` | Octets requis non confirmés |
| `openAmbiguities` | Décisions éditoriales actives |
| `quarantinedRecoveries` | Anciens brouillons demandant une action |
| `transportState` | Diagnostic de connexion orthogonal |
| `storagePersisted` | Risque d'éviction orthogonal |

Priorité de dérivation : échec local → attention nécessaire → synchronisation →
enregistré localement/en attente → synchronisé. Une connexion `ready` ne
court-circuite aucun de ces compteurs.

## Server persistence

Aucune nouvelle table PostgreSQL n'est requise au départ. Les entités
`page_operation_updates`, `page_operation_states`, checkpoints, enveloppes,
frontières, révisions, mutations et changes existantes forment déjà le commit
durable. Les sessions et annonces restent en mémoire.

Si une preuve de test montre qu'un `latestPageSequence` ne peut pas être dérivé
après une branche, activation ou résolution, le correctif doit enrichir le
résultat transactionnel ou ajouter une migration additive ; il ne doit pas
publier avant le commit.
