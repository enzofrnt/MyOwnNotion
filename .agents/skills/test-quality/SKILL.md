---
name: test-quality
description: Écrire et revoir des tests MyOwnNotion qui attendent l'état réel dont dépend l'étape suivante (jamais un délai, une visibilité ou un idle), avec les leçons capitalisées de nos échecs CI. À charger pour toute création ou modification de test, pour Speckit (plan, tasks, implement, converge) et avant de conclure qu'un échec est « instable ».
---

# Qualité des tests MyOwnNotion

Lire d'abord la règle normative — [`docs/testing/wait-contracts.md`](../../../docs/testing/wait-contracts.md) —
puis le journal de nos échecs — [lessons.md](lessons.md). Ce skill ne crée pas de
permission de fusionner : il dit comment prouver qu'un test mesure ce qu'il
annonce.

Ce dossier est **maintenu à la main** (comme `ui-quality`), pas généré par la CLI
Specify. Les skills `speckit-*` restent générés : ne pas les éditer.

## Ce que le skill change dans le flux Spec Kit

| Étape | Exigence |
| --- | --- |
| `spec.md` | chaque scénario d'acceptation nomme l'état qui prouve son achèvement, pas une durée |
| `plan.md` | la stratégie de test dit quel niveau prouve la garantie (unitaire vs parcours) et pourquoi |
| `tasks.md` | une tâche « test » qui ne peut pas échouer n'est pas terminée |
| `implement` | tout nouveau parcours répond aux six questions de `wait-contracts.md` § « Writing a new test » |
| `converge` | un échec intermittent non expliqué bloque la convergence : c'est une fenêtre non prouvée, pas du bruit |

## La règle en une phrase

Une étape commence sur une **preuve produite par le code qui achève
l'opération**, corrélée à cette opération (entité, révision, compteur capturé
avant le geste), qui ne peut être ni manquée ni périmée. Le temps écoulé, un
élément simplement visible, une réponse réseau reçue et un état `idle` n'en sont
jamais.

## Boucle atelier (échec → leçon)

1. Constater l'échec sur une exécution réelle ; rassembler la preuve (run, job,
   ligne, trace, capture).
2. Nommer l'état qui a changé — pas le moment où ça a échoué.
3. Corriger la cause : le produit si c'est un défaut applicatif, le témoin si le
   test observait un proxy.
4. Extraire la règle réutilisable et l'ajouter à [lessons.md](lessons.md) au
   format existant (`L-NNN`, statut, symptôme, anti-pattern, règle, preuve).
5. Si la règle est générale, la remonter dans `docs/testing/wait-contracts.md`
   (la norme) plutôt que de la laisser dans le journal.

## Quand une leçon doit remonter plus haut

- **Norme générale** → `docs/testing/wait-contracts.md`.
- **Principe non négociable** (ce qui vaut pour toute livraison) →
  `.specify/memory/constitution.md`, avec l'amendement et son Sync Impact Report.
- **Réutilisation d'un geste ou d'un helper** → `tests/e2e/waits/` ou
  `tests/e2e/helpers.ts`, jamais une copie dans une spec.

## Avant de conclure « instable »

Un vert local répété ne réfute pas un échec CI : cela prouve seulement que la
fenêtre est rare. Chercher la même signature dans les preuves conservées, puis
l'état qui a changé (L-004, L-005). Une relance verte n'est pas une correction.

## Checklist de revue

- [ ] Chaque attente observe un état écrit par le code qui achève l'opération.
- [ ] L'attente est corrélée à l'entité, la révision, le compteur capturé avant.
- [ ] Aucun `waitForTimeout`, aucun sommeil de synchronisation, aucune boucle qui
      refait l'action jusqu'à ce que l'assertion passe.
- [ ] Aucune assertion affaiblie ; le diff ne touche que l'attente.
- [ ] Les courses volontaires (fermeture, coupure, concurrence) sont déclenchées
      par une barrière contrôlée, pas par la chance.
- [ ] Une injection ou une mutation rend le test rouge avec le bon message.
- [ ] Si le test touche un menu portail ou une saisie, L-001 et L-002 ont été lues.
