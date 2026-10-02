# Vérification — Réduction des duplications

Date : 2 octobre 2026. Bun 1.4.2. Vérifications locales, aucun push.

## Traçabilité Spec Kit et analyse

- Les 173 groupes initiaux ont une décision motivée et des références vérifiées
  vers les exigences des fonctions existantes dans [audit.json](audit.json).
- 71 groupes retenus se recouvrent en 59 familles, reliées aux tâches T004–T062,
  aux extractions et aux tests dans [traceability.md](traceability.md).
- T067 partage en plus la règle valeurs/relations d’une cellule avec la
  hiérarchie, tout en gardant les retries, le refresh et les erreurs propres.
- Nouvelle analyse intégrale, mêmes modèle et paramètres : **173 → 109 groupes**,
  **398 → 252 unités participantes**, **124 → 67 unités de copies exactes**.
  Les copies exactes ne sont pas des paires. Aucun groupe initial `share` ne
  conserve son empreinte ; huit groupes nouveaux/modifiés ont été lus et qualifiés.
  Les 109 décisions finales sont dans [follow-up-audit.json](follow-up-audit.json).
- Les références de specs et identifiants FR des 173 décisions existent ;
  aucune nouvelle direction produit ni modification du canevas n’est requise.

## Contrôles exécutés

| Contrôle | Résultat | Preuve locale |
| --- | --- | --- |
| Vitest : domain, page-state, contracts, client-core, web, database-integration, api-contract, workspace-contract | Première passe : 430 fichiers, 4 484 tests réussis, 46 échecs, 27 ignorés ; les écarts sont détaillés ci-dessous, cette passe seule n’est pas déclarée verte | work/slopo/verification-tests.log |
| Contrats de requêtes et règle de cellule ajoutés | 2 fichiers, 4 tests réussis | work/slopo/verification-extra.log |
| PG18 : import Notion, sauvegarde native et cohérence | 3 fichiers, 37 tests réussis | work/slopo/verification-pg18.log |
| PG18 : archive de pages, migration gardée, sauvegardes complètes/historique, service et CLI | 6 fichiers, 40 tests réussis | work/slopo/verification-pg18-followup.log |
| PG18 : restauration et garde de mise à jour | 2 fichiers, 14 tests réussis | work/slopo/verification-pg18-restore.log |
| Coloration, schéma local, menus, sources/vues, cellule et titre | 6 fichiers, 27 tests réussis | work/slopo/verification-unit-followup.log |
| Rattrapage après 90 jours et 10 000 changements | Réussi : 1 fichier, 1 test ; 301 secondes | work/slopo/verification-long-absence.log |
| Typage de tous les packages et racine | Réussi : tous les packages et la racine | work/slopo/typecheck-final.log |
| Biome sur les fichiers modifiés/ajoutés | Réussi : 118 fichiers, zéro erreur, 12 avertissements antérieurs conservés | work/slopo/lint-final.log |
| Build web de production | Réussi : 23 sorties et 16 assets précachés | work/slopo/verification-web-build.log |
| Analyse statique de sécurité | Réussie : 1 229 sources, zéro finding | work/slopo/verification-static.log |
| Scripts shell avec shfmt épinglé 3.12.0 | Réussi : 13 scripts maintenus ; les différences du Spec Kit vendored sont admises par le gate existant | work/slopo/verification-shell.log |
| Politique toolchain | Réussie : 1 690 fichiers suivis | work/slopo/verification-toolchain.log |

Les tests des helpers ajoutés couvrent les cycles/profondeurs JSON, politiques de
sérialisation, copies binaires, timestamps, compatibilité des documents stockés,
marques inconnues, offsets de recherche, quotas, priorité des refus de protocole,
conflits chiffrés, manifests ordonnés, DTO défensifs et valeurs/relations des cellules.
Les suites existantes vérifient CAS, révisions, chiffrement, offline, sauvegardes,
migrations, undo/redo et projections. Aucun agrégat des relances n’est ajouté
au compteur global : plusieurs tests se recouvrent.

## Écarts de la première passe et traitement

1. Les clients PostgreSQL 18 étaient installés mais absents du PATH utilisé par
   les tests. Les suites de sauvegarde, restauration et import ont été relancées
   avec `/opt/homebrew/opt/libpq/bin`, conformément à docs/development.md.
   Les deux erreurs de connexion non gérées initiales provenaient de cette
   exécution interrompue ; aucune erreur non gérée dans les relances concernées.
2. Quatre attentes unitaires anciennes ne suivaient plus les évolutions
   approuvées : vues liées multiples (029), table locale `databaseSources` (029),
   légende sous le groupe de titre (022), menus de liens via leurs actions (003).
   Les tests ont été alignés sur les contrats présents ; les évolutions produit
   ont été conservées. Les six fichiers de la relance unitaire passent.
3. Coloration et rattrapage long avaient dépassé leur délai sous charge. Relance
   isolée avec un seul worker, sans changer les nombres de changements ni délais
   de tests. La coloration et le rattrapage passent ; ce dernier termine en 301 secondes,
   sous son budget existant de 600 secondes.
4. Le gate toolchain lisait `.codex`, lien suivi vers un répertoire, comme un
   fichier texte. Le filtre de fichiers ordinaires conserve l’inventaire Git
   partagé et tous les contrôles des fichiers réels. Le gate passe.

## Gate UI/UX

Revue des véritables composants React et de la feuille globale de l’application,
à 1 280 et 320 px, en clair et sombre. Ouverture clavier, focus initial sur Fermer,
Escape et retour de focus au bouton déclencheur sont vérifiés pour dialogue et
panneau. La propriété titre reste visible et désactivée. Les libellés et actions
d’utilisation de fichiers gardent leur contrat.

Un nom d’utilisation de fichier long débordait à 320 px : T068 ajoute un retour
à la ligne limité à ce lien. Après correction, la largeur de défilement correspond
à la fenêtre (320 ou 1 280 px), dans les deux thèmes. Preuves :
[mesures](assets/observations.json), [clair 320](assets/light-320-rest.png),
[sombre 320 dialogue](assets/dark-320-dialog.png),
[clair 1 280 dialogue](assets/light-1280-dialog.png),
[sombre 1 280 panneau](assets/dark-1280-drawer.png).

L’inspection porte sur les composants réels isolés avec les styles applicatifs,
complétée par leurs tests DOM et les suites de logique. Elle ne constitue pas
une validation de tous les parcours de l’espace de travail. Les fichiers de
prévisualisation temporaires ont été retirés après la revue.

## Limites explicites

- Aucun E2E exécuté, conformément à la demande du propriétaire.
- `checks:local` complet non exécuté : il inclut les E2E et d’autres gates de
  livraison. Cette feature n’autorise pas un push sans ce futur gate complet.
- Aucun push, déploiement ni nouvelle dépendance produit. Slopo/Ollama restent
  locaux. Les changements sont consultables dans ce checkout.
- Les métriques Slopo mesurent la ressemblance du code, pas la correction des
  contrats. La qualification manuelle, les références Spec Kit et les tests
  constituent les preuves complémentaires.

## Résultat de clôture

Les échecs de la première passe ont chacun une relance réussie ci-dessus. Les
contrôles ciblés, le typage, le build et les gates locaux cités passent. Les 12
avertissements Biome déjà présents restent explicites ; aucun gate de livraison
non exécuté n’est déclaré réussi. SC-001 à SC-004 sont satisfaits dans le périmètre
local défini par la feature.
