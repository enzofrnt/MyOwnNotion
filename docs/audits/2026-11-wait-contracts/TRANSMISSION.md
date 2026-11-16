# Transmission — audit des défauts de témoin dans la CI (pour Opus 5.5)

Tu reprends un **audit**, pas une implémentation à moitié faite. Rien n'a été modifié dans
l'application, les tests ou les workflows : aucune branche, aucun commit, aucun push. Les trois
documents ci-dessous sont toute l'entrée.

## Ce qui s'est passé, en un paragraphe

Un parcours a échoué sur `main` juste après la fusion de la PR #202, puis est passé à la réexécution
du job en échec sans aucun changement de code. La cause n'est pas « instable » : le parcours
sélectionnait une page, vérifiait que le titre s'était affiché, et fermait la page du navigateur
environ 18 ms plus tard, alors que le document local de l'appareil
`navigation-state.lastVisitedItemId` était encore en cours d'écriture par une transaction Dexie
lancée sans attente. L'appareil redémarré a donc restauré la page *précédente*. Reproduit en local sur
le même arbre (1 échec sur 20 avec une fenêtre resserrée, la sonde IDB montrant que l'écriture n'a
jamais été validée). La même **classe** — un test qui avance sur le début d'une opération au lieu de
sa fin — a ensuite été cherchée dans tout le dépôt et tout l'historique CI disponible.

## Ordre de lecture

1. `RAPPORT.md` — périmètre et SHA audité (`0679cdeb`, arbre `5f71be02`), les 100 runs et
   111 tentatives examinés, ce qui manque comme preuves et pourquoi, la chronologie de l'incident, les
   échecs observés classés (classe temporelle vs produit vs infrastructure), pourquoi la PR était verte
   et la fusion rouge.
2. `INVENTAIRE.md` — 56 sites (`W-01`…`W-56`), chacun avec l'opération en vol, le témoin utilisé
   aujourd'hui, le témoin requis, la gravité et la confiance. 55 attentes ont été vérifiées comme
   **saines** et sont listées pour que tu ne les « corriges » pas. Trois sites ne peuvent pas échouer
   pour la raison qu'ils annoncent (W-03, W-05, W-07) — W-03 en particulier certifie une propriété de
   non-perte qu'aucun code de production n'implémente.
3. `DOCTRINE.md` — **l'exigence transversale, normative** : la robustesse de tous les tests, présents
   et futurs, repose sur un état réel vérifiable corrélé à l'opération exacte. Le temps écoulé, un
   élément seulement visible, une réponse réseau reçue et un état `idle` n'y sont jamais des preuves.
   Le catalogue `S1`…`S20` donne, pour chaque séquence asynchrone, la précondition et le signal fiable
   avec son producteur et le moment exact où il devient vrai. Les timeouts n'y sont que des bornes de
   sécurité avec diagnostic ; quand le temps est le sujet, l'horloge est contrôlée.
4. `COUVERTURE.md` — la carte des 520 fichiers de test : ce qui est déjà correctement synchronisé, ce
   qui doit migrer (4 specs E2E et 20 fichiers unitaires utilisent un vrai sommeil ; 45 fichiers
   portent un constat), ce qui relève du temps comme sujet, ce qui est une borne de sécurité légitime.
5. `PLAN-OPUS.md` — lots L0 (instrumentation, à faire d'abord) → L5, le module de témoins
   (`tests/e2e/waits/`, un fichier par famille `S…`), le lot d'horloge contrôlée, les contrôles
   automatisés et de revue, la matrice d'injection, la calibration de sensibilité, le protocole de
   validation, et quatre décisions qui ne doivent être prises que par toi (`D-A`…`D-D`).

Preuves plus fines si nécessaire : `evidence/failures.tsv` (403 instances de job en échec, toutes
tentatives), `evidence/errors/` (138 rapports d'erreur CI extraits), `evidence/logs/` (signatures),
`evidence/scan-*.md` (les trois balayages sources, analyse complète en anglais).

## Non négociables venant de l'utilisateur

- Ne pas pousser de correction dans le cadre de l'audit — il est terminé ; l'implémentation est la
  tienne.
- Pas de retries, pas de skips, pas d'assertions affaiblies, pas d'allongement général des délais pour
  obtenir du vert.
- Garder `retries: 0`, `maxFailures: 10`, `actionTimeout` 15 s, `expect` 10 s.
- Les parcours de course volontaire (fermeture brutale, coupure réseau, concurrence) doivent être
  préservés et rendus déterministes, pas adoucis — `tests/e2e/deliberate-races.ts` est l'endroit où ils
  se déclarent.
- Une seule branche depuis `main`, pas de PR empilées. Tester en local avant de pousser. Valider avec
  les cinq projets navigateurs et avec des opérations volontairement retardées, puis deux runs CI
  complets verts à la première tentative sur le commit final.
- Ne pas fusionner, ne pas fermer les PR Dependabot.

## Notes d'environnement

- Worktrees : `/Users/enzofournet/Git/MyOwnNotion` (checkout principal, en retard au moment de
  l'audit), `/Users/enzofournet/Git/MyOwnNotion-059` (arbre `5f71be02`, identique au commit de fusion
  audité — à utiliser en lecture seule comme référence).
- E2E en local sur macOS : Firefox et WebKit uniquement via
  `scripts/test-e2e-firefox-container.sh` (image épinglée `mcr.microsoft.com/playwright:v1.64.1-noble`) ;
  Playwright est épinglé à 1.64.1 parce que 1.65 fait planter Firefox 159 sur `ariaLabelledByElements`.
- Une base isolée est disponible avec `COMPOSE_PROJECT_NAME=mn059-investigation
  MYOWNNOTION_DB_PORT=5599 DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:5599/myownnotion`.
- Les preuves volumineuses (traces, rapports blob, exécution de la sonde locale) sont hors dépôt dans
  `/private/tmp/claude-501/-Users-enzofournet-Git-MyOwnNotion/0af274a5-95a3-409f-ae5f-05280e3f7cce/scratchpad/postmerge`.

## Ce qu'il ne faut pas refaire

- Ne pas relancer l'analyse « est-ce instable ? » : la réponse est démontrée, et une réexécution verte
  n'est pas une correction.
- Ne pas chercher la cause dans la consolidation des dépendances, le plan de voies, le cache de durées
  ou l'image du runner : tout est identique entre le run rouge et le run vert du même arbre (§4.3 du
  rapport).
- Ne pas ajouter de drapeau E2E dans l'application : les signaux proposés sont des lectures d'états
  réels, et les courses volontaires s'obtiennent en retardant l'opération depuis le test.
- Ne pas affaiblir une assertion en migrant un témoin : le diff ne doit toucher que l'attente. Un
  changement d'assertion se justifie séparément, dans son propre commit.
- Ne pas traiter la doctrine comme un simple document : elle doit finir dans `docs/testing/` et être
  référencée par `docs/development.md`, `AGENTS.md` et le modèle de revue, sinon elle ne survivra pas
  au prochain changement d'agent.
