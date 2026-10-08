# Implementation Plan: Notion API replacement

**Branch**: `codex/notion-api-import` · **Date**: 2026-10-04 · [Spec](spec.md)

## Technical context and constitution check

Bun 1.4.2, TypeScript strict, PostgreSQL 18, existing canonical mutation pipeline,
ProtectedRecordService and ProtectedFileService. Replace source adapters/tests;
retain verified backup, readiness, durable feed and transactional checkpoints.
No new dependency or SQL migration anticipated. Constitution I–VIII satisfied:
canonical offline/sync writes, one 028 directory, explicit loss accounting,
encrypted originals, bounded remote access, Bun-only checks and product alignment.
Canvas §§6.1/27.1/47 and roadmap updated; 029's import task redirected here.

UI quality skill and lessons read:
`.agents/skills/ui-quality/{SKILL,lessons}.md`.
No changed CSS or new interface. Owner validation exposed an editor activation
failure on imported inline databases. Follow ui-quality and its lessons for
error/loading/success inspection, editing/reopen, narrow viewport and both
themes. Visual evidence stays private; record aggregate evidence in this feature.

## Architecture

Owner follow-up: skip people property pagination/conversion, authorship fields
(created_by/last_edited_by) and cover downloads;
ignore cover slots from older encrypted collections as well. Keep the original
JSON inside import.snapshot, without a canonical technical file/folder. Legacy
version-2 plans remain resumable unchanged. Clean the delivered instance through
canonical mutations and a verified backup, retaining page IDs and later edits.

Editor prerequisite: `initialiseKnownBlockPayload` in page-state/block-tree.ts
omits databaseView's containerItemId/viewId. The projection expects both and
throws during activation. Initialize those properties and include them in
domain/document/block-properties.ts so insert/property changes and checkpoints
retain them. Cover operational roundtrip and actual activation of an imported
page, then test the owner-reported page and other pages with inline databases.

Integration evidence exposed first-source fallback on protected schema/entry
reads. Repair `packages/database/src/{repositories/database-repository,
mutations/database-commands}.ts` to select the requested/membership source and
scope impact preview to that source. Preserve existing command contracts;
cover this prerequisite through encrypted multi-source import/readback tests.
Source collection runs from a bundled immutable copy inside the isolated
container: Docker Desktop's live bind mounts can expose truncated files after
host replacement. This was reproduced before any live canonical writes.

- `api-client.ts`: fixed Notion HTTPS origin, explicit `2026-03-11` confirmed
  live; credential-scoped 350 ms scheduler, timeout, abort, bounded 429/5xx retry
  honoring Retry-After; pagination guards. GET and read-only POST search/query
  only. Fixed safe error codes; no SDK stacking.
- `collect.ts`: discovery, explicit roots/all, recursive blocks and pages,
  distinct database/data sources, complete row property pagination, synced
  block cycle guards, views. Bound count/depth/bytes; second metadata read
  detects edits. Preview stays in memory, no plaintext source cache.
  A 403/404 specifically on a synced block's external original yields an explicit
  unavailable placeholder and retained source reference. Selected page/body/schema
  failures, including failures deeper inside an accessible original, still block.
  Cover every discovered object in all-mode and every discovered child of a
  selected source, including pages absent from its query results. A live
  coverage comparison found nine such accessible pages, with no template flag.
- `media.ts`: Notion-hosted HTTPS only, DNS/IP checks, manual redirects,
  bounded streams without credentials. External URLs remain reported links.
  Stable source slot identities; snapshot includes bytes for offline resume.
- `blocks.ts`, `properties.ts`, `views.ts`, `plan.ts`: pure canonical v3
  conversion. Reserve IDs first. Multiple sources share one owner with distinct
  source IDs. Relations/documents applied after targets exist. Unsupported
  values become text snapshots plus originals, never live formulas. Incompatible
  view configuration yields an explicitly named fallback and notice.
  Scope owned views by their database parent; bind linked displays after all
  referenced sources exist. Active quick filters and unsupported grouping
  controls are reported, never silently omitted as a faithful saved view.
  Adapt soft breaks to separate/native child paragraphs and normalize the
  exclusive inline code mark with explicit notices; table/code line breaks stay
  native. Report nested database pages' direct-child membership implication.
- `source.ts`/`model.ts`: bounded snapshot and typed plan/report.
- `apply.ts`: protected import.snapshot before canonical application;
  resume reads it without Notion. Keep job lock, verified backup, source binding,
  revision guards, canonical files and transactional checkpoints. Track source
  heads by source ID; schema before entries, then relations/documents. Abort
  before each operation.
- `cli.ts`: discover, repeatable root UUID or all, id, apply/dry-run, resume,
  json. Secret from NOTION_TOKEN or NOTION_TOKEN_FILE only. Explicit target
  config. Remove source option. Counts/fixed codes by default, intentional
  private detail through json.
  `target.ts` supports packaged SQL layout and optional
  MYOWNNOTION_MIGRATIONS_DIR, retaining the source-execution package fallback.

## Isolation and validation

### Audit opérationnel du 5 octobre 2026

Le propriétaire demande un import neuf sur 8082 et une comparaison directe
avec Notion. T053–T055 suivent sauvegarde vérifiée, nouvelle collecte stable,
retrait canonique de l'ancienne branche et nouvel import. ui-quality et son
journal guident la revue des parcours, rendus et erreurs ; le canvas §§14/27.1
reste la référence. Les preuves privées restent dans `work/notion-api/1005-*`.
Les suites automatisées ne sont pas relancées selon l'instruction du propriétaire.

L'[audit comparatif](audit-2026-10-05.md) révèle notamment que l'une des neuf
pages hors requête est un modèle dans le navigateur, malgré l'absence de champ
`is_template` dans la réponse API. La décision antérieure de toutes les traiter
comme des entrées ne permet donc pas une fidélité 1:1. Les replis de vues,
intervalles de dates, projections et présentations restent des écarts concrets
à traiter ; leur archive ne prouve pas une équivalence fonctionnelle. Cet audit
est terminé, mais ne déclare pas ces capacités implémentées. Aucun changement
des données Notion ni de l'instance UI 8080 n'est autorisé par cette opération.

### Maintenance Matière — historique remplacé par 036

Le repli décrit ci-dessous appartient à l'intervention antérieure refusée par le propriétaire. Le comportement actuel conserve les Kanbans multi-select selon 036 ; sa restauration et ses preuves sont dans [036/validation.md](../036-multi-select-boards/validation.md).

`views.ts` limite les axes Kanban au statut/sélection et les regroupements
table au statut/sélection/case, conformément au moteur existant. Les autres
types et références d'axe absentes produisent une table avec `group: null`,
copie explicite et avis `import.view-grouping-preserved-as-table`, en conservant
les filtres/tris/presentations compatibles. Pas de changement du moteur ni du
modèle canonique. Tests de conversion puis évaluation de leurs résultats dans
`notion-content.spec.ts`. ui-quality/lessons et guide UI déjà référencés
gouvernent la revue de la table réelle : erreur initiale puis succès,
clair/sombre et 320px, avec preuve privée ignorée. Les états vide/chargement
et les interactions du tableau existant ne changent pas.

Comparer vue par vue l'ancien plan protégé et le nouveau à la présentation
actuelle ; ne remplacer que les réglages incompatibles encore identiques. Les
propriétés visibles peuvent avoir été nettoyées ou éditées depuis : conserver
leur liste actuelle dans le résultat et comparer tous les autres champs.
Préserver les autres onglets et leurs identités. Sauvegarde vérifiée avant mutation
canonique de présentation avec version attendue, aucune requête Notion.
La définition de compatibilité conserve aussi une copie des vues : la remettre
en cohérence avec la présentation actuelle via mutation canonique, en vérifiant
la révision de présentation dans la transaction et sans changer les propriétés.
Sinon une édition ultérieure des propriétés pourrait restaurer l'ancien axe.
Consigner la preuve dans `validation-matiere.md`, puis types/static/tests API et build API,
image isolée et smoke navigateur. Aucun redémarrage de l'autre instance.

Checkout 3f48; Compose project myownnotion-notion-api; DB 55433, HTTP 8082,
HTTPS 8445 with explicit origins. Browser origin http://127.0.0.1:8082 also
isolates cookies from the UI instance's localhost host. Project-scoped volumes,
fresh deployment key, independently tagged image with immutable API bundle.
Override in ignored work/notion-api. Never use
default Compose or dev:stack:reset. Inspect mounts before writes.

Focused network/conversion/CLI tests and real canonical integration;
backup/encryption/restart/edit-preservation, API build and strict types.
Full checks:local for cross-cutting publication. No push implied. Real probes
emit aggregates; no private fixtures/screenshots committed.

## Corrections de contenu et hiérarchie — dépendance034

Convertir equation/table_of_contents et rich_text equation dans les types natifs
v3 de034, avec identité inline stable et source exacte. Le mark code exclusif
cède à l'équation lorsqu'une annotation Notion cumule les deux ; le snapshot
conserve l'annotation et le rapport le signale. Pour les parents block_id,
construire une carte propriétaire de bloc depuis les forêts de pages collectées ;
ne pas appliquer cette résolution à database_id/data_source_id, qui indiquent
une appartenance de source. L'option CLI répétable --exclude-database sélectionne
explicitement une base et ses descendants/sources/membres/médias, sans exclusion
universelle du nom People. La reprise utilise la sélection du plan historique.

Réparation sur8082 après sauvegarde vérifiée, via commandes/updates canoniques :
conversion des seuls fallbacks inchangés, identités et éditions préservées,
déplacements de parents et corbeille de People. Snapshot source original conservé.
Les preuves natives/navigateur et différences sont dans034/validation.md.


## Ajustement des liens et commandes — 035

Le retour du propriétaire du 4 octobre est défini dans
[035/spec.md](../035-item-links-database-insertion/spec.md), avec approche et
suivi dans ses plan.md/tasks.md. Il remplace les libellés précédents par les
créations « Page/Dossier/Base de données imbriqué(e) », élargit « Lien vers un
autre élément » aux bases, et fusionne les commandes d'affichage intégré et lié
dans un dialogue de choix. Le concept de vue liée et la propriété des sources
restent inchangés. L'import respecte is_inline et corrige les références
historiques inchangées ; la validation locale propre à035 ne revalide pas les
anciennes phases de cette feature.

## Extension 036 — 2026-10-04

[036](../036-multi-select-boards/spec.md) ajoute le regroupement Kanban par sélection multiple, sans repli table pour ce cas. Les anciennes preuves Matière restent historiques ; la restauration ciblée et la validation native sont suivies dans 036.
