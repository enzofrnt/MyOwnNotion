# UI Contract: application routing

## Canonical paths

```text
/
/setup[?returnTo=<encoded protected path>]
/login[?returnTo=<encoded protected path>]
/notes
/notes/:itemId
/settings
/settings/security
/settings/navigation
/settings/backups
/settings/storage-sync
/settings/trash
/settings/page/:itemId
```

`/settings` remplace immédiatement vers `/settings/security`. `/` est une entrée transitoire et ne reste jamais l’adresse durable d’une page utilisateur après résolution du gate.

## Path builder contract

```ts
notePath(itemId: Uuid): `/notes/${string}`
settingsPath(section: SettingsRouteSection): string
pageSettingsPath(itemId: Uuid): `/settings/page/${string}`
loginPath(returnTo?: ProtectedDestination): string
setupPath(returnTo?: ProtectedDestination): string
```

Les composants métier consomment ces fonctions ou un callback de navigation. Ils ne concatènent pas eux-mêmes de segments et n’appellent pas directement `window.history`.

## Recognition contract

```ts
recognizeDestination(pathname: string, search: string): ApplicationDestination
safeReturnDestination(raw: string | null): ProtectedDestination | null
```

- Correspondance exacte des segments.
- UUID validé avant rendu du workspace.
- Route inconnue ou encodage invalide → `notFound`.
- Paramètre de retour absolu, protocole relatif, public ou inconnu → `null`.

## Navigation semantics

| Action | Historique |
| --- | --- |
| Ouvrir note/dossier/base/entrée | push |
| Ouvrir une section de réglages | push |
| Changer volontairement de section | push |
| `/settings` → sécurité | replace |
| `/` → destination autorisée | replace |
| Protection → login/setup | replace |
| Succès login/setup → retour | replace |
| Changer `?view=` d’une même base | replace |
| Précédent/suivant navigateur | navigation delta native |

## Protected-route contract

- Aucune surface privée ne s’affiche avant résolution du gate.
- Un refus explicite de session conduit à la connexion.
- Une indisponibilité réseau conserve l’accès local-first existant.
- Une réussite reprend uniquement un `returnTo` validé.
- Aucun contenu utilisateur, secret, cookie, jeton ou titre n’entre dans l’URL.

## Workspace adapter contract

```ts
interface HierarchyExplorerRouteProps {
  selectedItemId: Uuid | null;
  onOpenItem(itemId: Uuid, options?: { replace?: boolean }): void;
}
```

La sélection rendue provient exclusivement de `selectedItemId`. Les refs internes peuvent annuler des lectures asynchrones obsolètes mais ne choisissent pas un autre item.

## Distribution contract

- Vite dev/preview et nginx retournent le shell pour chaque chemin canonique utilisateur.
- `/v1/`, `/health`, `/assets/` et les fichiers statiques ne passent jamais par le fallback applicatif.
- Hors ligne, le service worker répond aux navigations same-origin canoniques avec l’`index.html` précaché.
- Les réponses API et les contenus canoniques ne sont pas mis en cache par le routeur de navigation.
