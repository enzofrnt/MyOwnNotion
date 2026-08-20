# Data Model: Recherche initiale du workspace

La recherche est une projection transitoire. Aucune entité ci-dessous ne crée
une seconde source canonique ou une nouvelle table persistante.

## SearchDocument

Une entrée active dans le moteur commun.

| Champ | Type | Règle |
| --- | --- | --- |
| itemId | UUID | Identité canonique et clé unique |
| revisionId | UUID | Révision courante utilisée pour refuser un upsert ancien |
| sourceVersion | entier croissant | Séquence serveur ou locale utilisée pour ordonner les notifications et empêcher une révision ancienne de remplacer la projection courante |
| kind | page, folder, file | Type courant après conversion |
| title | string | Titre ou nom ouvert par le codec protégé |
| bodyText | string | Texte visible d'une page prise en charge ; vide sinon |
| conflict | boolean | Signale un conflit local ou canonique sans le résoudre |

Le chemin, les ancêtres et la disponibilité locale ne sont pas indexés. Ils
sont hydratés depuis la projection courante afin qu'un déplacement ou un
déchargement ne laisse aucune valeur obsolète.

### Validation

- itemId et revisionId sont des UUID valides.
- Seuls les items active sont présents.
- folder et file ont un bodyText vide.
- Un document avec une révision plus ancienne que celle déjà indexée est
  ignoré selon sourceVersion ; une même sourceVersion portant deux revisionId
  différents invalide la mise à jour au lieu de choisir selon l'horloge.
- title et bodyText ne sont jamais journalisés ni sérialisés comme index.

## SearchQuery

| Champ | Type | Règle |
| --- | --- | --- |
| query | string | 1 à 512 caractères Unicode après refus du vide |
| kinds | ensemble optionnel | Sous-ensemble unique de page, folder, file |
| branchRootItemId | UUID optionnel | Inclut la racine et ses descendants actifs |
| limit | entier | 1 à 50 ; 20 par défaut |
| cursor | string opaque optionnelle | Liée à la requête normalisée et à la génération |

La normalisation dérivée n'est jamais renvoyée au client ni stockée dans les
logs.

## SearchIndexGeneration

| Champ | Type | Règle |
| --- | --- | --- |
| generation | entier croissant | Change uniquement lors d'un échange réussi |
| state | cold, building, ready, degraded | État visible du composant |
| indexedCount | entier | Nombre de documents validés |
| expectedCount | entier | Nombre de sources actives à lire |
| startedAt | instant | Présent pendant building |
| completedAt | instant optionnel | Présent après échange réussi |
| lastAppliedChange | curseur optionnel | Position de changement déjà reflétée |
| failureCode | code sûr optionnel | Jamais un contenu ou une requête |

### Transitions

~~~text
cold -> building -> ready
ready -> building -> ready        reconstruction atomique
ready -> degraded                 échec d'upsert ou d'intégrité
building -> degraded              reconstruction refusée
degraded -> building -> ready     réparation/reprise
~~~

Une génération building n'est jamais exposée comme complète. Une ancienne
génération ready peut rester servie pendant un rebuild planifié, mais pas après
un échec qui prouve qu'elle est obsolète.

## SearchCandidate

Résultat interne du moteur avant hydratation.

| Champ | Type | Règle |
| --- | --- | --- |
| itemId | UUID | Référence SearchDocument |
| score | nombre | Valeur interne non contractuelle |
| matchedFields | ensemble | title, body ou propriété structurée (extension 009) |
| matchedTerms | ensemble | Valeurs normalisées gardées en mémoire |
| orderKey | tuple | Rang stable, titre normalisé, itemId |

Le score brut n'est pas exposé comme contrat produit.

## SearchResult

| Champ | Type | Règle |
| --- | --- | --- |
| itemId | UUID | Identité canonique |
| revisionId | UUID | Version présentée |
| kind | page, folder, file | Type courant |
| title | string | Titre courant |
| path | liste de segments | Chemin courant, chaque segment garde son identité |
| matchedField | title, fileName, body, property | Raison principale du résultat |
| propertyId | UUID ou null | Propriété structurée correspondante, extension 009 |
| propertyName | string ou null | Nom courant de cette propriété, jamais sa valeur |
| snippet | string ou null | Texte sûr, jamais HTML |
| conflict | boolean | Conflit à signaler |
| localAvailability | optionnel | present, offloaded, never-fetched |
| source | local ou server | Utilisé seulement pour la fusion client |

## SearchPage

| Champ | Type | Règle |
| --- | --- | --- |
| coverage | local-only ou complete | Jamais complete pour une réponse partielle |
| generation | entier ou null | Génération serveur si disponible |
| results | SearchResult[] | Ordre stable |
| nextCursor | string ou null | Aucun texte de requête en clair |

## MergedSearchState

État d'interface dérivé de la page locale, de la page serveur et de la
connectivité.

| État | Signification |
| --- | --- |
| empty-query | Aucun caractère visible |
| local-loading | Worker en construction |
| local-results | Résultat local disponible, serveur non confirmé |
| server-loading | Local visible, recherche complète en cours |
| complete | Serveur prêt et fusion terminée |
| rebuilding | Serveur ou worker reconstruit sans prétendre être complet |
| offline | Seules les données locales ont été interrogées |
| degraded | Intégrité ou mise à jour refusée ; résultat complet indisponible |
| no-results | Couverture connue et aucune correspondance |

## Merge Rules

1. Dédupliquer par itemId.
2. Retirer immédiatement un item local trashed ou purged.
3. Préférer une révision locale pending ou conflict à la révision serveur.
4. Conserver le marqueur conflict jusqu'à résolution acceptée.
5. Pour une révision locale synchronized identique, accepter l'hydratation
   serveur du chemin et du rang.
6. Une erreur serveur ne supprime ni requête, ni filtres, ni résultats locaux.

## Persistence and Recovery

- PostgreSQL et IndexedDB ne reçoivent aucune table ou store d'index.
- Les données canoniques protégées et la projection locale protégée restent les
  seules sources persistantes.
- Une sauvegarde n'a pas à transporter MiniSearch ; la restauration doit
  reconstruire et vérifier une génération avant de déclarer complete.
- Un verrouillage ou une perte de clé vide et termine le worker local.
