# Data Model: URLs canoniques de l’application

Cette feature ne modifie aucune table serveur, aucun document canonique et aucun format synchronisé. Les entités suivantes appartiennent uniquement à la navigation d’un onglet client.

## ApplicationDestination

Union fermée représentant une route reconnue.

- `root`
- `setup` avec `returnTo?: ProtectedDestination`
- `login` avec `returnTo?: ProtectedDestination`
- `notes` sans item
- `note` avec `itemId: Uuid`
- `graph` avec `itemId: Uuid | null`
- `settings` avec `section: security | navigation | backups | storage-sync | trash`
- `pageSettings` avec `itemId: Uuid`
- `notFound` avec le chemin demandé et une raison non sensible

### Validation

- Les segments dynamiques d’item sont des UUID canoniques valides.
- Aucun segment supplémentaire, origine, schéma, fragment ou double slash n’est accepté comme route canonique.
- Les aliases internes `local-data` et `page-details` ne sont pas des chemins publics ; ils sont mappés vers les composants existants.
- Une route reconnue peut ensuite résoudre vers un item actif, en corbeille, absent ou indisponible localement sans changer son identité.

## ProtectedDestination

Sous-ensemble des destinations accessible au propriétaire : notes, graphe et réglages.

### Règles

- Sérialisable comme chemin relatif commençant par un seul `/`.
- Reconnue par la même table de routes que la navigation normale.
- Ne peut pointer vers `/login`, `/setup`, `/__ui-lab` ou une route inconnue.
- Les paramètres de requête sont filtrés ; seul le contexte explicitement autorisé, notamment `view`, est conservé.

## WorkspaceRouteState

État transitoire propre à une entrée d’historique.

- `returnPath: ProtectedDestination | null`
- `focusTestId: string | null` ou autre identifiant UI non sensible
- `databaseContextKey: string | null`

Le scroll éditorial durable reste dans `WorkspacePresentationState` existant. Cet état n’est jamais synchronisé et ne suffit jamais à déterminer la page active.

## RouteResolvedItem

Résultat local après hydratation de `itemId`.

- `loading`
- `active` avec `ProjectedItem`
- `trashed` avec métadonnées sûres
- `unavailable-local`
- `not-found`

### Transitions

```text
route reconnue
  → loading
  → active | trashed | unavailable-local | not-found

active --suppression--> trashed
trashed --restauration--> active
active --rename/move/convert--> active (même URL)
```

## DatabaseRouteContext

Contexte de vue existant, ajusté au routeur.

- `databaseId: Uuid`
- `activeViewId: Uuid`
- `selectedEntryId: Uuid | null` uniquement pour restauration de focus
- `scrollTop: number`

L’ouverture d’une entrée change la destination canonique vers son propre `itemId`. `selectedEntryId` ne remplace jamais cette destination.
