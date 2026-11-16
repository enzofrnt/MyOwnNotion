# Audit — défauts de témoin dans la CI de tests (lecture seule, 15 novembre 2026)

Audit de la suite de tests pour la classe de défaut révélée par l'échec post-fusion de
`tests/e2e/page-multi-device-convergence.spec.ts` (run `43722479700`, rouge à la tentative 1, vert à la
réexécution sans aucun changement) : **un test qui avance sur le début d'une opération au lieu de la
preuve que l'opération est terminée**.

| Fichier | Contenu |
|---|---|
| `RAPPORT.md` | Rapport d'audit : périmètre et SHA audité, couverture CI, preuves manquantes, chronologie de l'incident, échecs observés classés, analyse de cause, doctrine, limites |
| `DOCTRINE.md` | **Exigence transversale (normatif)** : ce qu'est une preuve d'achèvement, liste noire, liste blanche, catalogue `S1`…`S20` (séquence → précondition → signal → producteur), règle d'écriture des nouveaux tests, contrôles, politique d'horloge |
| `COUVERTURE.md` | Carte du dépôt : 520 fichiers de test classés (conformes / à migrer / temps comme sujet / bornes de sécurité), avec lot de migration |
| `INVENTAIRE.md` | Inventaire normalisé de 56 sites (`W-01`…`W-56`) avec le témoin requis pour chacun, plus les 55 attentes vérifiées saines |
| `PLAN-OPUS.md` | Plan d'implémentation pour l'agent suivant : instrumentation d'abord, module de témoins, lots ordonnés, matrice d'injection, protocole de validation, décisions à prendre |
| `TRANSMISSION.md` | Message de transmission et notes d'environnement |
| `evidence/` | Preuves brutes et extraites (voir ci-dessous) |

## Statut

Artefacts d'audit neufs, non suivis par Git. Aucun fichier hors de ce dossier n'a été modifié. Aucun
commit, aucun push. L'implémentation n'est volontairement pas commencée.

## Références auditées

- Dépôt : `enzofrnt/MyOwnNotion`
- Arbre audité : `5f71be02c458813be70f8abee7e5daddd813c8bf` — l'arbre du commit de fusion de `main`
  `0679cdeb1ba43d4e0d0658c228e7b35067b4c215` (PR #202) et de la tête de PR
  `f73b449c70f8b055be9b1363ab2986c1d58f2192` (worktree `MyOwnNotion-059`).
- Fenêtre CI : 100 derniers runs `CI`, du 2026-11-12 à 11:35:31 UTC au 2026-11-15 à 14:05:59 UTC,
  111 tentatives.

## Preuves

| Chemin | Contenu |
|---|---|
| `evidence/ci-runs.json` | Les 100 runs CI, huit champs chacun (charge utile complète conservée hors dépôt) |
| `evidence/failures.tsv` | 403 instances de job en échec sur 86 runs, toutes tentatives, avec run, tentative, événement, date, SHA, branche, identifiant et nom du job |
| `evidence/logs/` | 138 extractions de signatures d'échec depuis les journaux des jobs en échec |
| `evidence/errors/` | 138 sections de rapport d'erreur (en-tête de test, message, journal d'appel, lignes de source citées) |
| `evidence/scan-sync-devices.md` | Balayage de 20 specs synchro/persistance/hors-ligne/multi-appareils — 15 constats (anglais) |
| `evidence/scan-ui-menus.md` | Balayage de 48 specs UI/éditeur/bases/fichiers/sécurité — 14 constats + l'analyse des quatre `waitForTimeout` (anglais) |
| `evidence/scan-unit.md` | Balayage des suites unitaires et d'intégration — 26 constats + décompte de couverture (anglais) |
| `evidence/00-brief-scanners-EN.md` | La classe de défaut et le format de restitution donnés aux balayeurs |

Traces, rapports blob par voie et journal de la reproduction locale sont trop volumineux pour le
dépôt et restent dans
`/private/tmp/claude-501/-Users-enzofournet-Git-MyOwnNotion/0af274a5-95a3-409f-ae5f-05280e3f7cce/scratchpad/postmerge`
(`art/`, `blobs/`, `trace/`, `probe1-full.log`, `probe2-full.log`, `ci-runs-raw.json`).

## Régénérer les preuves

La collecte n'a utilisé que `gh api` sur `enzofrnt/MyOwnNotion` :

- runs : `gh api "repos/enzofrnt/MyOwnNotion/actions/workflows/ci.yml/runs?per_page=100"`
- par tentative : `…/actions/runs/<id>/attempts/<n>/jobs?per_page=100&page=<k>`
- journaux : `gh api --allow-escape-sequences …/actions/jobs/<job>/logs`
- artefacts : `…/actions/runs/<id>/artifacts` puis `…/actions/artifacts/<id>/zip`

Une réexécution **complète** détruit les artefacts de la tentative précédente ; une réexécution **des
seuls jobs en échec** conserve les deux. Préférer la seconde quand la tentative rouge est la preuve.
