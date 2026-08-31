# Validation: URLs canoniques de l’application

## Preuves TDD

- Contrat de chemins initial : code 1, module de routage absent ; point rouge confirmé sous surveillance `gpt-5.6-luna`.
- Sélection hiérarchique et vues de base initiales : code 1, 13 tests réussis et 4 échecs attendus sur les helpers absents ; point rouge confirmé sous surveillance `gpt-5.6-luna`.
- Shell hors ligne et fallback Web initiaux : code 1, 21 tests réussis et 3 échecs attendus ; point rouge confirmé sous surveillance `gpt-5.6-luna`.
- Journey navigateur initial : l’infrastructure a d’abord refusé un second PostgreSQL sur le port 5432. La relance utilise le PostgreSQL de la stack de développement directement, sans arrêter ni remplacer cette stack.

## Validation ciblée après implémentation

| Vérification | Résultat | Surveillance |
| --- | --- | --- |
| TypeScript Web strict | code 0 | `gpt-5.6-luna`, effort low |
| Projet Vitest Web complet | code 0, 74 suites et 471 tests réussis | `gpt-5.6-luna`, effort low |
| Contrats impact/offline/nginx | code 0, 3 suites et 58 tests réussis | `gpt-5.6-luna`, effort low |
| Chromium desktop, routage + frontière réglages | code 0, 4 tests réussis | `gpt-5.6-luna`, effort low |
| Reprise login/setup + refus History API | code 0, 10 tests réussis | `gpt-5.6-luna`, effort low |
| Build Web de production | code 0 | `gpt-5.6-luna`, effort low |

Le journey Chromium couvre les identités de page, dossier, base et entrée, le rechargement, précédent/suivant, le renommage, le déplacement, la conversion, les réglages adressables, l’état introuvable et la continuité locale lorsque l’API est indisponible. Les tests de composant couvrent aussi la reprise effective après connexion/setup et un refus déterministe d’écriture dans l’historique.

## Gate complet

Exécuté le 31 août 2026 après relecture de l’inventaire courant de
`docs/development.md` :

```text
MYOWNNOTION_E2E_JOBS=1 PATH=/tmp/myownnotion-shfmt-3.12.0:$PATH bun run checks:local
code de sortie : 0
```

Le code de sortie du processus principal est l’autorité. Des sous-agents
`gpt-5.6-luna` à faible effort ont surveillé les phases longues et confirmé
l'absence d'erreur dans les journaux courants sans modifier, relancer ni
interrompre le gate.

| Gate | Résultat autoritaire |
| --- | --- |
| Outils, shell, format, lint et types stricts | réussi |
| Couverture agrégée | 321 fichiers de tests, 3 332 tests réussis |
| Budgets de performance | 7 scénarios réussis |
| Intégration base de données | 33 fichiers, 332 tests réussis |
| Migrations | réussi |
| Contrats API et workspace | 110 fichiers, 1 249 tests réussis |
| Matrice Playwright | 5 projets sur 5 réussis en 3 242 s |
| Builds applicatifs | API et Web réussis ; 25 sorties Web et 16 assets précachés |
| Images conteneur | 2 images réussies pour `linux/amd64` et `linux/arm64` ; smoke runtime API réussi |
| Sécurité et distribution | audit dépendances, secrets, analyse statique, licences et contrat Compose réussis |

### Artefacts navigateurs

| Profil | Résultat |
| --- | --- |
| `.e2e-logs/chromium-desktop.log` | 264 réussis, 2 ignorés |
| `.e2e-logs/firefox-desktop.log` | 246 réussis, 20 ignorés |
| `.e2e-logs/webkit-desktop.log` | 246 réussis, 20 ignorés |
| `.e2e-logs/chromium-mobile.log` | 252 réussis, 14 ignorés |
| `.e2e-logs/webkit-mobile.log` | 241 réussis, 25 ignorés |

Firefox desktop et les deux profils WebKit ont utilisé l'image Playwright
Linux épinglée sur macOS, conformément à l'équivalent documenté. Le scénario
WebKit mobile de convergence structurée qui avait révélé une hydratation tardive
a réussi du premier coup dans ce gate. Avant la relance complète, il avait aussi
réussi 10 fois sur 10 en répétition ciblée, sans flaky.

## Garde de livraison

- Aucun commit, push, PR, merge ou déploiement local n'est inclus dans cette
  validation.
- Ordre demandé : CI de PR entièrement verte, lancement local pour validation
  manuelle, accord explicite de l'utilisateur, merge, puis vérification de la CI
  de `main`.
- Incident à traiter avant le lancement local : une commande Playwright brute a
  réinitialisé par erreur la base de développement locale `myownnotion`. Le gate
  complet ci-dessus a utilisé uniquement des bases isolées. Aucune restauration
  n'a été tentée sans instruction de l'utilisateur.
