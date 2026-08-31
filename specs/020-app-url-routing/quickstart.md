# Quickstart: validation des URLs canoniques

## Prérequis

- Bun 1.4.0 exactement.
- Dépendances installées avec `bun ci`.
- PostgreSQL/Docker disponibles pour les journeys qui utilisent la stack réelle.

## Validation ciblée

```bash
bun run --bun vitest run --project web apps/web/tests/route-paths.spec.ts apps/web/tests/app-routing.spec.tsx apps/web/tests/database-views.spec.tsx
bun run typecheck
bun run --filter @myownnotion/web build
```

Attendu : chemins reconnus/canonicalisés, retours externes refusés, routes de réglages et notes cohérentes, build Web réussi.

## Scénario navigateur principal

```bash
bun run test:e2e:local -- tests/e2e/routing.spec.ts tests/e2e/workspace-settings-boundary.spec.ts
```

Vérifier au minimum :

1. `/` est remplacé par une destination canonique.
2. Une page et un dossier utilisent `/notes/:itemId`.
3. Rechargement, précédent et suivant gardent URL, arbre, fil d’Ariane et contenu alignés.
4. Chaque réglage possède son chemin et le retour restaure le workspace.
5. Une entrée de base obtient sa propre route et précédent restaure base, vue et focus.
6. Une note locale se recharge hors ligne ; une identité absente affiche l’état prévu.
7. Route inconnue et UUID invalide n’ouvrent jamais le dernier item visité.

## Distribution directe

Construire le Web puis vérifier que les chemins profonds sont servis par le shell, en ligne et après précache hors ligne. Les tests contractuels doivent prouver que nginx exclut toujours l’API et les assets du fallback.

## Gate pré-push

Relire l’inventaire courant dans `docs/development.md`, puis exécuter sans omission :

```bash
bun run checks:local
```

Le gate est réussi uniquement si la commande termine avec le code 0. Chaque commande longue peut être lancée ou surveillée par un sous-agent économique, qui doit rendre le code de sortie et les suites en échec ; son résumé ne remplace pas le résultat du processus.
