# Implementation Plan: Bases réutilisables intégrées

**Branch**: `codex/026-linked-databases` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary

Séparer la révision de définition de la révision courante de l'ancienne page hôte. Le registre `databases` devient l'autorité de la source. Une ancre d'item existante peut rester pour le journal immutable et la compatibilité des enveloppes ; ni sa visibilité ni son cycle de vie ne déterminent la disponibilité de la source. Les configurations d'emplacements, noms et vues restent dans le payload de définition chiffré et empruntent les mutations, projections et exports existants.

## Technical Context

Bun/TypeScript, PostgreSQL/Drizzle, React, Dexie et services de protection actuels. Aucune dépendance ajoutée. Migration réservée `0016_linked_databases`. La création depuis une page peut créer une source avec une ancre sans emplacement de hiérarchie. Les anciennes bases gardent leur affichage par défaut sur leur page actuelle. Les entrées sont conservées hors de la branche de hiérarchie des hôtes afin que la suppression d'un hôte ne cascade pas sur leur appartenance.

## Constitution Check

PASS : propriétaire unique ; source canonique partagée ; aucune persistance privée en clair ; mutations offline atomiques ; historique préservé ; export/restauration explicites ; tests de comportements ; chaîne Bun et gates de `docs/development.md`. Pas de changement de principe constitutionnel. Canvas §14 et 009 doivent être alignés.

## Design

- La définition ajoute un nom de source et des emplacements `{id, hostPageId, views, state}` optionnels pour lire les anciennes définitions sans les réécrire avant déchiffrement. L'absence représente un emplacement historique sur l'ancienne page ; une liste vide représente une source sans affichage.
- Les vues d'un emplacement sont évaluées par le moteur 009 avec le même schéma et les mêmes entrées ; les changements de propriétés affectent le schéma commun. Les mutations gardent des révisions causales ; les emplacements distincts sont fusionnés par identité.
- Le registre de sources conserve sa propre `definition_revision_id`. Les écritures de pages, corbeille et purge ne l'avancent pas. Les révisions référencées par une source ne sont pas nettoyées avec l'historique d'un hôte.
- Les noms/configurations passent par les snapshots protégés existants ; aucune migration SQL ne déchiffre ou copie du contenu privé. Le protocole transmet la révision de source avec sa définition et conserve la projection locale chiffrée.
- L'UI réutilise `DatabasePage`, les cinq vues et l'édition d'entrée. Un sélecteur de source et une action de retrait encadrent l'intégration dans une page éditoriale normale. Référence obligatoire : [UI quality](../../.agents/skills/ui-quality/SKILL.md), tokens, boutons sémantiques et arrondis imbriqués.
- Les formats canoniques conservent leurs anciennes données lisibles, incluent les champs additifs des définitions et la révision de source, et vérifient leur cohérence. La sauvegarde complète 024 capture le catalogue SQL sans sélection de tables figée.

## Migration and purge findings

0016 emits durable refresh changes for each migrated source and its entries;
this announces detached legacy placements to devices already holding a cursor.
Upgraded offline devices detach those placements atomically before host trash.
No editorial revision or encrypted payload is rewritten by SQL migration.

The portable export previously omitted purged items while retaining their
revision headers, causing restoration to fail the revision-owner foreign key.
026 exports neutral structural tombstones with no old private payload or active
placement. It restores the current live source definition separately from the
old host's revision. Definition edits write source-only snapshots, so the
journal does not recopy purged editorial data. This finding is communicated to
the shared 025 audit for consolidation. Full purge scheduling remains outside
026; tests apply its canonical purged state explicitly.

## Validation Strategy

Tests de domaine pour identité/validation/fusion d'emplacements ; tests réels PostgreSQL pour migration, suppression/purge des hôtes et accès ultérieur ; tests client pour persistance chiffrée et projection ; test UI et parcours Playwright pour deux pages, configurations distinctes et édition partagée. Exécuter les suites ciblées et signaler au parent les résultats. Le parent exécute le gate complet avant tout push ; cette branche reste locale.

## Project Structure

`packages/domain/src/databases/`, `packages/contracts/src/content-api.ts`, `packages/database/src/`, `packages/client-core/src/`, `apps/api/src/databases/`, `apps/web/src/features/databases/`, `apps/web/src/features/hierarchy/`, tests associés et `specs/026-linked-databases/`.

## Convergence : pagination et chargement des grandes sources

Les emplacements parcourent les curseurs canoniques avec une commande explicite et un compte chargé ; ils n'annoncent pas une couverture complète quand des valeurs locales sont déchargées. Le retour à une entrée hors première page recharge les curseurs de sa vue avant de restaurer le focus. Un scénario API + navigateur crée 1 001 entrées canoniques protégées et mesure séparément la préparation, la première page et la suivante.

Le chargement SQL de la projection ne doit pas relire et déchiffrer chaque page éditoriale à chaque ajout. Une lecture groupée porte uniquement noms, versions exactes des valeurs et relations ; la couche de protection partagée conserve l'authentification et refuse l'absence d'une enveloppe nécessaire. La projection réutilise les entrées inchangées si la définition reste identique, avec reconstruction complète sur changement de définition ou invalidation.

Le scénario réel a également révélé deux coûts de rattrapage : résolution API séquentielle des noms/corps et transactions IndexedDB par entrée affichée. Les lectures de contenu partagées sont groupées par type d'enveloppe ; la résolution locale récupère items/placements/relations par lots et ouvre les enveloppes avec une concurrence bornée à 64, sans persister de copie en clair. Les délais de préparation API et de disponibilité de l'UI sont mesurés séparément.


Les affichages conservent leur projection locale lorsqu'une entrée est ouverte. Le panneau reçoit immédiatement l'entrée canonique déjà visible, puis la sélection structurelle vérifie son état en arrière-plan comme pour le parcours 009. Le rafraîchissement de navigation exclut également les ancres de source sans placement après une notification incrémentale, et non uniquement au démarrage.


## Clarification des placements d'entrée

`database.entry.create` accepte un `placement` optionnel ; tous les autres contrats de création gardent leurs exigences. Le flux UI omet ce champ et l'API/outbox locale créent une page canonique et son appartenance sans placement hiérarchique. Le contrat explicite ancien continue de fonctionner. Aucune colonne ni migration supplémentaire n'est nécessaire : 0016 autorise déjà les pages sans placement, et son détachement historique conserve les identifiants de placements existants. Le corpus UI de 1 001 entrées reproduit ce nouveau défaut et vérifie que la navigation ne comporte pas 1 001 racines. Les permissions MCP par branche restent fondées sur la hiérarchie ; un affichage n'accorde aucun droit implicite sur les entrées.

## T015 — Validation des commandes externes

La couverture intégrée passe 4 085 tests mais dépasse le budget de branches
non couvertes (2 559 / 2 465). L'audit des frontières partagées reproduit une
acceptation de `unsupported-view` par `parseMutationCommand` lors d'un remplacement
de définition. Le schéma doit vérifier les vocabulaires de types déjà canoniques
pour les propriétés et vues, y compris les vues d'emplacement. Les tests passent
par le parseur public, avec commandes JSON malformées et preuves positives de
normalisation/rejeu ; aucune méthode privée ni exclusion de couverture. Les
valeurs inconnues sont refusées, pas converties silencieusement. FR-008 et les
limites existantes de la 009 restent inchangés.

Task-field projections must preserve missing values and reject incompatible
retained data. Destructive-definition previews must count only actually affected
entry/property pairs, including retired choices and removed properties, and
refuse invalid or foreign definitions. Add public domain tests for these
existing safeguards as part of T015's shared validation review.

The bulk local relationship reader introduced for large sources must enforce
the same database/property boundary as individual reads, deduplicate targets,
and exclude unrequested pages. Extend the existing mixed-source fixture to
compare bulk and individual results and cover empty batches.

## T016–T018 — Integrated browser convergence

The first complete integrated Chromium run passes 280 journeys and fails four.
Two failures still require the old host-owned hierarchy semantics: a newly
created entry appearing in the sidebar and host trash counting/cascading entries.
Update those journeys to verify retained canonical membership/identity and
source reuse instead. Do not recreate implicit placements to satisfy them.

The empty database screenshot also exposes an actual early editor activation:
`database.create` is absent from the existing workspace-page journal barrier,
so checkpoint/item reads race its accepted creation and leave `Item does not
exist` visible. Both `database.create` and `database.entry.create` create editable
pages and must share the same accepted/pending/conflict barrier as `item.create`.
Extend the existing real local-service tests rather than add a separate protocol.

The controlled visibility checkbox resets to the previous persisted value while
its async definition write runs. Retain the proposed boolean locally until the
write settles, keep duplicate actions disabled, and revert to the last confirmed
definition after rejection. Verify a delayed commit and failure in React tests,
then the existing two-device browser journey. Keep view and source boundaries
explicit when local pending state is used. Apply the UI-quality skill.

The full attempt at `1c562317` passed types, formatting, 4,209 coverage tests,
nine performance budgets, database/migration/contract tests; it failed Chromium
and was interrupted before running all remaining browsers. It is not a passing
delivery gate. Log: `/tmp/mon-pre-v1-full-gate-integrated.log`.
