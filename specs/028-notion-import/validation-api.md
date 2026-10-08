# Notion API validation — 2026-10-04

The initial delivery evidence below precedes the owner's follow-up. See
« Owner corrections » at the end for the current exclusions, active counts and
editor activation repair; the original immutable import plan remains recoverable.

## Delivered instance and isolation

Browser: http://127.0.0.1:8082. Compose project `myownnotion-notion-api`,
checkout `3f48`, branch `codex/notion-api-import`. PostgreSQL port 55433;
HTTPS port 8445 allocated. HTTP 127.0.0.1 is the tested browser origin and
isolates cookies from the UI instance's localhost host. Development credentials
and Compose overrides remain outside Git in ignored local files.

Five independent volumes: postgres-data, file-store, backup-store, caddy-data,
caddy-config, each prefixed with `myownnotion-notion-api_`. Fresh external 0600
deployment key; immutable API bundle in an independently tagged runtime image.
The other UI project `myownnotion-ui-dev` uses checkout `b3fe`, ports
8080/8443/5432 and its own volumes/key. Every mutation, image/startup and
container command targeted the import project explicitly. No default stack,
reset, shared image rebuild or operation on the UI project was performed.
Container/mount inspection confirmed separate checkouts and volume names.

## Real source and application

Notion API `2026-03-11` returned HTTP 200. Complete discovery returned 277 pages
and 10 data sources. Source collection retrieved 10 database owners and 43 views;
340 page/database/source/view metadata objects passed the second-read stability
check. A coverage audit found nine discovered pages absent from source query
results. These were read and verified before the final application; collection
now covers them directly. None of these nine declared the template flag.

The final import created 277 pages, including 121 source memberships, 10 database
containers with 10 distinct sources, 58 deduplicated media files, one protected
original JSON file and two grouping folders. Snapshot: 86,986,432 bytes. A verified
full safety backup preceded the 790 accepted canonical operations. One earlier
conversion trial was trashed through the normal authenticated API; only the
final group remains active, with 348 active items.

The browser rendered editorial content and native database views without page
errors. Ordinary authenticated APIs returned all 10 active databases, 43 views
(11 table, 8 board, 6 list, 3 calendar, 15 gallery), property values and decrypted
file bytes. The entry endpoint also exposes a directly nested database page
through its direct-child membership semantics; 121 imported source memberships
remain the canonical source count. This model/API distinction is documented in
the owner guide, with a conversion notice for directly nested database owners.
Real relation columns were present; synthetic tests, rather than empty live
relations, establish nonempty relation target fidelity and multi-source behavior.

SQL aggregate inspection: zero unsealed item names and zero unsealed page bodies.
Names use the reserved neutralized marker and documents the protected payload
marker. Integration tests additionally inspect protected snapshots/originals,
source definitions, entry values and canonical encrypted files. Temporary live
collection retries used application-encrypted validation records; no plaintext
source snapshot or private fixture was checked in.

Production CLI resume ran without a Notion token and returned already-complete
with zero writes. The application preserves the subsequent owner-style rename
of the final root. Replanning the encrypted collection with current conversion
code produced the same fingerprint and also replayed with zero writes. The
Notion token file was removed from the host and container after collection.

## Observed differences

The 56 schema properties include 5 people fields and 1 created-time field,
converted to static text. Native types present: title, rich text, select,
multi-select, status, date, checkbox and relation. Formulas/rollups were not
observed live; their static-value conversion is covered by the conversion design.
No live linked display was observed; encrypted linked/multi-source fixtures
cover those cases.

The stored report has 522 conversion notices, not 522 missing pages. Relevant
counts include 9 incompatible view queries explicitly shown as unfiltered
fallback tables, 1 unsupported layout, 2 date range/zone notices, 3 date-only
values converted into instant columns, 18 column flattenings, 99 soft-break
conversions, 82 inline-code formatting adaptations, 2 inaccessible synced
originals and 35 blocks declared unsupported by Notion. Covers/file icons remain
attachments when downloadable; equations, presentation details and unsupported
blocks retain the API original and a readable fallback. Some external media
remain links. The API cannot supply hidden unsupported contents or unshared
synced originals; an original response cannot restore content never returned.

See [the owner comparison](../../docs/notion-import.md#différences-à-examiner-pour-faire-évoluer-lapplication)
for required app changes versus source-access limitations.

## Selected checks and results

Bun 1.4.2; installation with `bun ci` passed. Changed paths are the Notion source,
plan/apply/CLI adapters, their tests, API dependency removals/lockfile, and the
source-specific protected database read/impact repair. No SQL migration or UI
implementation change.

- 88 tests in 10 files passed: 24 Notion API/CLI/canonical/realtime tests and 64
  existing database, linked-source, security, projection/query and core database
  integration tests. Host PostgreSQL 18 clients supplied required backup tools.
  Tests used disposable harness databases through isolated port 55433.
- Full workspace typecheck passed; scoped Biome formatting/static checks passed.
- API production build and immutable isolated runtime image build passed.
- Password sign-in, editorial/database rendering, ordinary API value/file
  readback and SQL neutralization inspected against the actual isolated instance.
- Backup refusal, cancellation, drift, unavailable selected content,
  pagination/retries, synced original access, media bounds/no credentials,
  interrupted restart, local edits and idempotent replay passed in synthetic
  contract/integration tests.
- Documentation links/terminology, Spec Kit prerequisites/artifact consistency
  and `git diff --check` reviewed.

This is local implementation evidence, not publication evidence. No branch push,
PR, merge or release was performed. The cross-cutting pre-push `checks:local`
gate remains required by docs/development.md before publication; it has not been
claimed as passed here.

## Convergence

Convergence assessed the current implementation against 10 functional
requirements, 4 success criteria, 11 story acceptance scenarios, the plan's
conversion/storage/isolation decisions and all 8 constitutional principles.
No missing, partial, contradicting or unrequested buildable work remains within
028's scope. The converge assessment appended no tasks; implementation then
recorded T036/T037 completion. Product-model limitations are documented rather
than silently expanded into new features.

Final immutable-runtime startup completed guarded migrations successfully,
with zero pending SQL migrations and a verified pre-update backup. The ordinary
production CLI again resumed without source credentials and made zero writes.
Post-restart Chromium rendered editorial and database content with zero page
errors, 348 active items and 10 active databases, and confirmed that the renamed
import root was preserved. The isolated services are left running for the owner.
Private browser state and temporary screenshots were removed after inspection;
the deployment key and isolated encrypted data volumes remain available.

## Owner corrections — current state

The owner excludes all people-related schema fields and page/database covers,
and rejects the synthetic « Sources importées » folder in their notes. Fresh
collection skips people pagination and cover downloads; planning skips people,
created_by and last_edited_by fields and historical cover media slots. The
original JSON remains inside the encrypted recovery snapshot without a visible
file/folder. Existing version-2 snapshots remain immutable and resumable.

The reported page failed POST activation with BlockTreeOperationError: the
operational tree omitted databaseView's containerItemId/viewId while projection
required both. The domain property extractor also omitted them. Both now retain
these references; tests cover property extraction, view edits, checkpoint
reopen and actual authenticated activation of an imported inline-database page.
No CSS, layout, SQL migration or new import screen was added.

Cleanup used verified full backups and the existing protected canonical command
pipeline on the import project only. Five Personne columns and 98 associated
values were removed; the technical folder/original file and one cover-only
asset were trashed. File placements were removed with the normal placement
command; shared editorial media were retained. The current source schemas have
51 properties, the 10 database owners retain 43 views, and 57 media files remain.
The active tree has 346 items: 277 imported pages, one subsequently created
owner page, 10 databases, 57 files and one import folder. No technical archive
is active. All 277 imported page IDs and the owner's root rename are retained.
The 98 value-update revisions were compared with their immediate prior
protected snapshots: zero editorial document digest differences. Sorted-body
verification also passed for all 277 imported pages. Recovery originals and
history remain encrypted, including historical import bytes.

UI quality and its lessons journal were applied to the existing editor journey.
Chromium checked all 278 active page documents through operational projection
and checkpoint reopen: every canonical digest matched. All seven pages with
inline database blocks opened in the real UI without an alert. The owner page
rendered in light/dark at 1440/320 px with no whole-page horizontal overflow.
Its 15 entries match the ordinary source query; entries with no board-axis value
occupy the final Kanban column, reachable through the board's own horizontal
scrollport. Screenshots were inspected privately, including the populated
column; source titles/content are not committed. Keyboard entry, server save
and reload with the inline database preserved passed on a temporary native QA
page; QA pages were then trashed canonically. The final uninterrupted browser
run reported zero page errors and zero HTTP 5xx responses. A trial overlapping
our API restart encountered expected transient 502/503 responses and was rerun
after the isolated services were healthy.

Selected follow-up checks passed:

- 1,228 domain/page-state tests in 79 files, including inline-database roundtrip.
- 24 Notion API/CLI/import tests in three files, including exclusions, private
  originals and imported-page activation.
- 17 activation/page-operation API tests in three files using disposable
  databases on port 55433.
- 77 client-core operation/encryption tests and 26 existing web adapter,
  page-editor and view-query tests, each in three files.
- Full workspace typecheck, affected-file Biome checks, API production build
  and immutable isolated runtime image build.
- Spec Kit prerequisites, artifact/link/terminology review and diff whitespace.

The final isolated runtime completed guarded migration startup with no pending
SQL migration. It retains separate checkout, ports, key and five volumes; the
UI instance was not changed. This remains local test delivery: no publication
or claim that the full pre-push checks:local gate passed. The follow-up changes
match US2/FR-003–006/009/010 and the explicit owner exclusions. Model/source
limitations in the owner guide still apply; they do not require a new Personne
or cover feature. Convergence rechecked the amended spec, plan and T039–T043:
the exclusions, private archive, editor repair, preserved edits and isolated
delivery are implemented and verified; no additional buildable task remains
within this follow-up. Browser state and private screenshots were removed after
inspection. The encrypted instance and deployment key remain available.
The final production CLI resumed the historical completed job without a Notion
credential and returned already-complete; it did not recreate the removed
archive/cover or overwrite the owner's edits.

## Complément034 — 2026-10-04

Après une nouvelle sauvegarde complète vérifiée, la réparation canonique a
mis à niveau41blocs sur cinq pages :10équations de bloc,31équations inline
portées par29blocs et deux sommaires. Les fallbacks ont été comparés à la source
ancienne avant mutation ; zéro bloc édité localement a été remplacé. Deux parents
block_id ont été réparés, dont Simple Note sous Archive > Lycée. People, son
unique source et ses deux membres sont hors de l'arbre actif, via la corbeille.
Les identités importées et le nom choisi par le propriétaire restent conservés.
Le snapshot d'origine n'a pas été réécrit. Neuf bases et57médias restent actifs.

La validation détaillée, les parcours natifs et captures synthétiques sont dans
[034/validation.md](../034-notion-content-navigation/validation.md). Les équations
et sommaires ne sont plus des limitations de bloc de cet importeur ; le rendu
reste celui du sous-ensemble KaTeX. Les35blocs unsupported et deux originaux de
blocs synchronisés indisponibles restent des limites de réponse/accès Notion.
