# Implementation Plan: Chargement progressif

**Branch**: `codex/notion-api-import` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

Ouvrir/déchiffrer le stockage local, restaurer navigation et transferts, rendre
la projection sans attendre le rattrapage. Si elle est vierge, précharger
`GET /v1/items?parentItemId=root` (états actuels complets), sous verrou de
projection avec garde contre les écritures locales, sans avancer le curseur.
Le journal ordonné continue en arrière-plan et publie les identités affectées
après chaque lot durable. La couverture initiale reste explicitement partielle
jusqu'au dernier lot accepté ou à un snapshot complet installé durablement.
Aucune modification du protocole serveur.

La recherche et son worker ne démarrent qu'à la première utilisation. Les lots
hiérarchiques utilisent `getItems` et une seule fusion du catalogue. Aucun travail
supplémentaire sur le rendu des arbres fermés sans lenteur vérifiée.

## Technical Context

**Language/Version**: TypeScript 5.9, Bun 1.4.2.
**Primary Dependencies**: React 19, Dexie, Fastify existants, Vitest/Playwright.
**Storage**: IndexedDB chiffré ; un marqueur de couverture non sensible dans meta.
**Testing**: tests service/reconciliation/navigation/recherche, E2E appareil neuf
avec lot retenu, cache local et édition concurrente ; matrice complète ensuite.
**Target Platform**: Web desktop/mobile et clients desktop existants.
**Project Type**: monorepo local-first existant.
**Performance Goals**: SC001/002 : contenu utilisable avant un lot réseau retenu
5 s ; SC004 zéro indexation inutilisée. Mesurer séparément fin de téléchargement.
**Constraints**: aucun effacement/outbox contournée ; aucun nouveau service,
contrat serveur, migration SQL, dépendance ou package manager.
**Scale/Scope**: fixture ≥300 descendants ; journal paginé actuel ; volume réel
HAR 1 097 items / 2 894 événements conservé comme contexte, jamais commité.

## Constitution Check

I : projection locale et intentions durables conservées. II/VIII : un dossier,
canevas §§12/17–19/43 et invariants inchangés. III : comportement testé et tâches
traçables ; gate complet requis car frontière sync. IV : codec/verrous actuels,
aucun contenu sensible journalisé. V : API et journal existants. VI : états
partiels honnêtes, clavier et 320 px. VII : Bun épinglé. PASS avant et après design.

## UI states and quality gates

Charger [.agents/skills/ui-quality/SKILL.md](../../.agents/skills/ui-quality/SKILL.md),
[lessons.md](../../.agents/skills/ui-quality/lessons.md) et
[ui-system.md](../../docs/design/ui-system.md). Réutiliser BranchState et
WorkspaceState : racines disponibles, branche partielle loading/offline/error,
base définition absente loading, véritable vide seulement couverture complète.
Si définition et entrées connues sont déjà locales, les garder lisibles même
sans marqueur historique et hors ligne. Normaliser toutes les pages de résultat
et leur fallback en couverture partielle, sans agrégats ni total inventé, avec
une notice de découverte et reprise. La table annonce un total inconnu ; une
base sans entrée connue reste dans son état de chargement/indisponibilité.
Les valeurs connues et réglages de vue restent modifiables. Les modifications
de structure de source (properties/taskRoles) attendent la découverte complète,
car leur aperçu destructif ne peut pas reposer sur un sous-ensemble d'entrées.
Préserver expanded/tabs tant que la couverture est partielle ; route absente en
attente plutôt que not-found. Les pages pouvant contenir des enfants ont un
dépliage provisoire pendant la découverte. Aucun chrome permanent de sync ni toast.
Captures clair/sombre, 320 px, clavier ; écart matériel bloque convergence.

## Project Structure

- `apps/web/src/services/local-content.ts` : boot, couverture, prélecture, journal.
- `packages/client-core/src/reconciliation/reconcile.ts` : callback après commit.
- `packages/client-core/src/local-store/schema.ts` : marqueur meta.
- `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` : états et fusion.
- `apps/web/src/features/hierarchy/navigation-item-signature.ts` : patch par lots.
- `apps/web/src/features/workspace/folder-children-list.tsx` : nombre d'enfants
  inconnu distinct d'un dossier vide pendant la découverte.
- `apps/web/src/services/search.ts` : worker/index à la demande.
- `apps/web/src/features/editor/custom-blocks/database-view.tsx` : distinguer
  entrées connues lisibles et absence encore inconnue pendant la découverte.
- `apps/web/src/features/databases/database-page.tsx` et `table-view.tsx` :
  couverture de découverte partielle indépendante du nombre de memberships
  locales, notice sans faux total et comptage accessible inconnu.
- Tests correspondants web/client-core et `tests/e2e/progressive-startup.spec.ts`.

## Validation and delivery

Tests ciblés avant gate complet `bun run checks:local` ; utiliser les équivalents
Linux documentés pour Firefox/WebKit sur macOS. Préserver instances 8080 et API/DB
8082 ; reconstruire seulement le web 8082 pour revue réelle. La demande de
publication du 7 octobre autorise commit, contrôles complets, push et PR.
Conserver les captures privées dans `work/notion-api/040-*` et l'évidence résumée
sans données propriétaire dans validation.md.

## Complexity Tracking

Aucune exception constitutionnelle. Le préchargement racine peut inclure de gros
corps ; il privilégie la première disponibilité sans promettre un plafond absolu.

## Maintenance de validation CI — 8 octobre

Le premier run PR 182 atteint les limites de lots causaux, mais le test de
101 écritures réelles dépasse le timeout Vitest générique de 5 s sous Istanbul
sur le runner partagé. Le cas teste taille/ordre/acquittement durables, pas un
budget produit de 5 s. Lui accorder 15 s uniquement, conserver les 101 créations
chiffrées, les lots [100, 1], chaque identité dans l'ordre, les 101 acquittements,
la file vide et le marqueur complet. Aucun changement production, de plafond de
couverture, de tolérance E2E ou de budget performance. Exécuter le fichier
instrumenté et répété, puis la couverture complète locale ; réutiliser les
autres preuves de 758945b8 dont les inputs exécutables restent identiques.
