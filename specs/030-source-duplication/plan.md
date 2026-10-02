# Plan technique — Réduction des duplications

Date : 2 octobre 2026. Checkout : `codex/029-database-pages-views`.
Specification : [spec.md](spec.md). Canevas : sections 14, 18–20, 27–31, 39, 42, 46.

## Résumé

Qualifier les 173 groupes avant les changements ; 71 groupes initiaux correspondent
à 59 familles d’extraction (les groupes se recouvrent). L’audit complet conserve
les différences de contrats et les précautions propres à chaque appelant.
Les petits idiomes et contrats différents restent séparés.

## Contexte technique

TypeScript 5.9, Bun 1.4.2, React, Dexie/IndexedDB côté client, Drizzle/PostgreSQL
côté serveur ; Vitest pour les tests ciblés. Slopo 0.9.0 et Ollama locaux servent
à l’analyse, sans nouvelle dépendance du produit. Aucune migration ni évolution
API, stockage ou protocole. Les extractions conservent le rendu ; une correction
ciblée des longs noms d’utilisation de fichier à 320 px répond à 003 FR-021.

## Contrôle de constitution

- Le cœur métier reste pur et portable : validations/document/query dans domain.
- DTO partagés dans contracts ; aucun import contracts depuis domain.
- Crypto Node demeure dans le sous-chemin domain/security et côté API.
- Préparation chiffrée hors transactions Dexie ; I/O, locks et retry restent aux appelants.
- Ordre des mutations, causalité, idempotence et fail-closed sont conservés.
- Aucun contenu utilisateur envoyé à un service distant ; seules les sources locales sont indexées.
- Tests ciblés et typage obligatoires. E2E différés par instruction utilisateur.
- Aucun push : le gate checks:local sera requis avant un futur push.

Les contrôles prérecherche et postconception sont satisfaits ; aucune dérogation architecturale.

## Structure et approche

`packages/domain/src/` : lecteurs de documents, validation, binaires purs, search.
`packages/contracts/src/` : assemblage des résultats de requêtes.
`packages/page-state/src/` : identité/payload de tables, checkpoints, undo/redo.
`packages/client-core/src/` : stockage, conflits, sync et projections chiffrées.
`packages/database/src/` : persistance transactionnelle et projections de révision.
`apps/api/src/` : adaptations fichiers, audit, récupération, sécurité et sauvegardes.
`apps/web/src/` : hooks et petits composants internes, orchestration de cellules.
`scripts/ci/` : lecture commune des fichiers Git.

Chaque famille de [audit.json](audit.json) devient une tâche ; les recouvrements
partagent la même extraction. Les helpers sont nommés par contrat concret, sans
framework générique. Les paramètres représentent seulement les vraies variations
(messages, parents, normalisation, adaptateurs de schéma). Aucune transaction n’est
fusionnée et aucun effet de bord ne change de propriétaire.

## Gate UI/UX

Références : `.agents/skills/ui-quality/SKILL.md` et
`.agents/skills/ui-quality/lessons.md`. Les extractions de modal, visibilité,
usages, états outbox et restauration conservent DOM, classes, labels, defaults,
focus/escape/backdrop et ordre des états. Scénarios à vérifier : dialog/drawer
ouverture-fermeture, titre désactivé, clic usage, sauvegarde bloquée et sélection
rapide. Aucun redesign ni nouveau parcours. Tests DOM existants et inspection des
wrappers doivent confirmer les contrats ; un écart matériel bloque convergence.

## Vérification

Avant extraction : lire les tests existants et ajouter une régression seulement
si un cas de contrat n’est pas couvert. Après chaque famille/cohorte : Vitest
ciblé. Puis typage global et format/lint des fichiers modifiés. Les tests de
persistance passent via le runner PostgreSQL du dépôt. Analyse Slopo finale
intégrale : vérifier les familles initiales par empreinte/emplacement et qualifier
les nouveaux groupes. Les résultats et limites sont consignés dans verification.md.

## Dépendances et livraison

US1 qualification → US2 partage par cohorte → US3 contrôles et nouvelle analyse.
Les tâches modifiant le même module sont séquentielles. Une interruption garde les
tâches restantes explicitement ouvertes. Aucun push, déploiement ou E2E dans ce
travail ; les changements restent reviewables dans le checkout.

## Liens aux exigences existantes

Voir [traceability.md](traceability.md) : correspondances par famille entre audit,
tâches, exigences des features existantes, extraction et tests. Les politiques
différentes identifiées lors de l’analyse y sont conservées explicitement.

## Ajustements de convergence

T066 conserve la preuve visuelle du skill UI. T067 partage la règle valeurs/relations
également avec la hiérarchie, sans déplacer ses retries. T068 corrige le débordement
d’un long nom d’utilisation de fichier constaté dans la revue réelle à 320 px ;
le style est limité au lien d’utilisation, avec une seule feuille propriétaire
chargée depuis global.css. Aucun nouveau parcours ni besoin produit.

T069 conserve la liste Git commune mais filtre, dans le gate toolchain, les liens
vers des répertoires avant lecture de texte. T070 corrige quatre attentes de tests
périmées au regard des évolutions déjà approuvées dans 029/022/003 ; aucun retour
à l’ancienne UI ni ancien schéma. T071 corrige le PATH local PG18 conformément à
docs/development.md et isole les deux tests dépassant leur budget sous charge.
