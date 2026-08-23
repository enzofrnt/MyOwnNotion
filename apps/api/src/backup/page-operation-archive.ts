/** Portable, verified operational page state carried inside a sealed backup. */

import {
  pageOperationCheckpointHasVerifiedBackup,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  documentDigestV3,
  migrateStoredPageDocumentToV3,
  normaliseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import {
  OPERATIONAL_FORMAT,
  OPERATIONAL_FORMAT_VERSION,
  type OperationalPageCheckpoint,
  OperationalPageDocument,
  sha256Hex,
  versionVectorBytesEqual,
} from "@myownnotion/page-state";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PageCheckpointRetentionContext } from "../page-state/checkpoint-service.ts";
import type {
  PageOperationCrypto,
  ProtectedOperationalFrontier,
} from "../page-state/page-operation-crypto.ts";

export const PAGE_OPERATION_ARCHIVE_FORMAT = "myownnotion.page-operations-backup" as const;
export const PAGE_OPERATION_ARCHIVE_VERSION = 1 as const;

export interface ArchivedFrontier {
  readonly versionVector: string;
  readonly frontiers: string;
}

export interface ArchivedPageOperationCheckpoint {
  readonly id: Uuid;
  readonly throughPageSequence: number;
  readonly frontier: ArchivedFrontier;
  readonly snapshotBytes: string;
  readonly snapshotDigest: string;
  readonly canonicalDigest: string;
  readonly revisionId: Uuid | null;
  readonly state: "candidate" | "verified" | "superseded" | "retained";
  readonly createdAt: string;
  readonly verifiedAt: string | null;
}

export interface ArchivedPageOperationUpdate {
  readonly id: Uuid;
  readonly pageSequence: number;
  readonly authoredByDeviceId: Uuid;
  readonly baseFrontier: ArchivedFrontier | null;
  readonly resultFrontier: ArchivedFrontier;
  readonly updateBytes: string | null;
  readonly updateDigest: string;
  readonly status: "accepted" | "rejected";
  readonly failureCode: string | null;
  readonly acceptedAt: string;
  readonly compactedAt: string | null;
}

export interface ArchivedPageDeviceFrontier {
  readonly deviceId: Uuid;
  readonly frontier: ArchivedFrontier;
  readonly frontierDigest: string;
  readonly confirmedPageSequence: number;
  readonly recordVersion: number;
  readonly lastConfirmedAt: string;
  readonly deviceState: "authorized" | "revoked";
}

export interface ArchivedPageAmbiguity {
  readonly id: Uuid;
  readonly logicalKey: string;
  readonly kind: "delete-edit" | "delete-move" | "type-transform" | "property-transform" | "schema";
  readonly status: "open" | "resolved-keep" | "resolved-delete" | "resolved-custom";
  readonly detailsBytes: string;
  readonly sourceUpdateIds: readonly Uuid[];
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly resolutionRevisionId: Uuid | null;
}

export interface ArchivedLegacyBranchConversion {
  readonly branchId: Uuid;
  readonly requestDigest: string;
  readonly status: "sending" | "converted" | "blocked";
  readonly responseBytes: string | null;
  readonly checkpointId: Uuid | null;
  readonly conversionUpdateIds: readonly Uuid[];
  readonly localDocumentDigest: string;
  readonly createdAt: string;
  readonly convertedAt: string | null;
}

export interface ArchivedPageOperationState {
  readonly pageId: Uuid;
  readonly status: "legacy" | "initializing" | "active" | "blocked";
  readonly operationalFormat: string;
  readonly operationalVersion: number;
  readonly currentCheckpointId: Uuid | null;
  readonly currentFrontier: ArchivedFrontier | null;
  readonly operationalDigest: string | null;
  readonly canonicalDigest: string;
  readonly canonicalFormatVersion: number;
  readonly lastUpdateSequence: number;
  readonly lastRevisionId: Uuid | null;
  readonly revisionWindowStartedAt: string | null;
  readonly revisionWindowLastUpdateAt: string | null;
  readonly revisionWindowFrontier: ArchivedFrontier | null;
  readonly bootstrappedAt: string | null;
  readonly updatedAt: string;
  readonly checkpoints: readonly ArchivedPageOperationCheckpoint[];
  readonly updates: readonly ArchivedPageOperationUpdate[];
  readonly deviceFrontiers: readonly ArchivedPageDeviceFrontier[];
  readonly ambiguities: readonly ArchivedPageAmbiguity[];
  readonly legacyBranchConversions: readonly ArchivedLegacyBranchConversion[];
}

export interface PageOperationArchive {
  readonly format: typeof PAGE_OPERATION_ARCHIVE_FORMAT;
  readonly formatVersion: typeof PAGE_OPERATION_ARCHIVE_VERSION;
  readonly pages: readonly ArchivedPageOperationState[];
  readonly counts: {
    readonly pages: number;
    readonly checkpoints: number;
    readonly updates: number;
    readonly deviceFrontiers: number;
    readonly ambiguities: number;
    readonly legacyBranchConversions: number;
  };
}

export interface PageOperationBackupCoverage {
  readonly checkpointId: Uuid;
  readonly snapshotDigest: string;
  readonly canonicalDigest: string;
}

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decoded(value: string): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(new ArrayBuffer(source.byteLength));
  bytes.set(source);
  return bytes;
}

function archiveFrontier(frontier: ProtectedOperationalFrontier): ArchivedFrontier {
  return { versionVector: encoded(frontier.versionVector), frontiers: encoded(frontier.frontiers) };
}

function openArchivedFrontier(frontier: ArchivedFrontier): ProtectedOperationalFrontier {
  return { versionVector: decoded(frontier.versionVector), frontiers: decoded(frontier.frontiers) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("operational backup is not serializable");
  return serialized;
}

export function pageOperationArchiveString(archive: PageOperationArchive): string {
  return canonicalJson(archive);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPageOperationArchive(value: unknown): PageOperationArchive {
  if (!isRecord(value)) throw new TypeError("operational backup is not an object");
  if (
    value["format"] !== PAGE_OPERATION_ARCHIVE_FORMAT ||
    value["formatVersion"] !== PAGE_OPERATION_ARCHIVE_VERSION ||
    !Array.isArray(value["pages"]) ||
    !isRecord(value["counts"])
  ) {
    throw new TypeError("operational backup has an unsupported envelope");
  }
  for (const [index, page] of value["pages"].entries()) {
    if (
      !isRecord(page) ||
      typeof page["pageId"] !== "string" ||
      typeof page["status"] !== "string" ||
      page["operationalFormat"] !== OPERATIONAL_FORMAT ||
      page["operationalVersion"] !== OPERATIONAL_FORMAT_VERSION ||
      typeof page["lastUpdateSequence"] !== "number" ||
      !Array.isArray(page["checkpoints"]) ||
      !Array.isArray(page["updates"]) ||
      !Array.isArray(page["deviceFrontiers"]) ||
      !Array.isArray(page["ambiguities"]) ||
      !Array.isArray(page["legacyBranchConversions"])
    ) {
      throw new TypeError(`operational backup page ${index} has an invalid shape`);
    }
  }
  const archive = value as unknown as PageOperationArchive;
  const counts = archive.counts;
  const actual = {
    pages: archive.pages.length,
    checkpoints: archive.pages.reduce((sum, page) => sum + page.checkpoints.length, 0),
    updates: archive.pages.reduce((sum, page) => sum + page.updates.length, 0),
    deviceFrontiers: archive.pages.reduce((sum, page) => sum + page.deviceFrontiers.length, 0),
    ambiguities: archive.pages.reduce((sum, page) => sum + page.ambiguities.length, 0),
    legacyBranchConversions: archive.pages.reduce(
      (sum, page) => sum + page.legacyBranchConversions.length,
      0,
    ),
  };
  if (!sameCounts(counts, actual)) {
    throw new TypeError("operational backup counts do not match its records");
  }
  const pageIds = new Set<Uuid>();
  const updateIds = new Set<Uuid>();
  const checkpointIds = new Set<Uuid>();
  for (const page of archive.pages) {
    if (pageIds.has(page.pageId)) {
      throw new TypeError("operational backup contains a duplicate page");
    }
    pageIds.add(page.pageId);
    for (const checkpoint of page.checkpoints) {
      if (!isRecord(checkpoint) || typeof checkpoint.id !== "string") {
        throw new TypeError("operational backup contains an invalid checkpoint");
      }
      if (checkpointIds.has(checkpoint.id)) {
        throw new TypeError("operational backup contains a duplicate checkpoint");
      }
      checkpointIds.add(checkpoint.id);
    }
    for (const update of page.updates) {
      if (!isRecord(update) || typeof update.id !== "string") {
        throw new TypeError("operational backup contains an invalid update");
      }
      if (updateIds.has(update.id)) {
        throw new TypeError("operational backup contains a duplicate update");
      }
      updateIds.add(update.id);
    }
  }
  return archive;
}

function sameCounts(
  left: PageOperationArchive["counts"],
  right: PageOperationArchive["counts"],
): boolean {
  return Object.keys(right).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

function date(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function pageOperationArchiveDeviceReferences(
  archive: PageOperationArchive,
): readonly { readonly id: Uuid; readonly state: "active" | "revoked" }[] {
  const states = new Map<Uuid, "active" | "revoked">();
  for (const page of archive.pages) {
    for (const update of page.updates) {
      if (!states.has(update.authoredByDeviceId)) states.set(update.authoredByDeviceId, "active");
    }
    for (const frontier of page.deviceFrontiers) {
      states.set(frontier.deviceId, frontier.deviceState === "revoked" ? "revoked" : "active");
    }
  }
  return [...states]
    .map(([id, state]) => ({ id, state }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export class PageOperationArchiveService {
  constructor(
    private readonly deps: {
      readonly workspaceId: Uuid;
      readonly crypto: PageOperationCrypto;
    },
  ) {}

  async export(tx: Transaction): Promise<{
    readonly archive: PageOperationArchive;
    readonly coverage: readonly PageOperationBackupCoverage[];
  }> {
    const availability = await tx.execute<{
      states: boolean;
      updates: boolean;
      checkpoints: boolean;
      frontiers: boolean;
      ambiguities: boolean;
      conversions: boolean;
    }>(sql`
      SELECT
        to_regclass('public.page_operation_states') IS NOT NULL AS states,
        to_regclass('public.page_operation_updates') IS NOT NULL AS updates,
        to_regclass('public.page_operation_checkpoints') IS NOT NULL AS checkpoints,
        to_regclass('public.page_device_frontiers') IS NOT NULL AS frontiers,
        to_regclass('public.page_ambiguities') IS NOT NULL AS ambiguities,
        to_regclass('public.page_legacy_branch_conversions') IS NOT NULL AS conversions
    `);
    const present = availability.rows[0];
    const tableCount =
      present === undefined
        ? 0
        : [
            present.states,
            present.updates,
            present.checkpoints,
            present.frontiers,
            present.ambiguities,
            present.conversions,
          ].filter(Boolean).length;
    if (tableCount === 0) {
      return {
        archive: {
          format: PAGE_OPERATION_ARCHIVE_FORMAT,
          formatVersion: PAGE_OPERATION_ARCHIVE_VERSION,
          pages: [],
          counts: {
            pages: 0,
            checkpoints: 0,
            updates: 0,
            deviceFrontiers: 0,
            ambiguities: 0,
            legacyBranchConversions: 0,
          },
        },
        coverage: [],
      };
    }
    if (tableCount !== 6) {
      throw new Error("the operational page schema is only partially installed");
    }

    const states = await tx
      .select()
      .from(schema.pageOperationStates)
      .where(eq(schema.pageOperationStates.workspaceId, this.deps.workspaceId))
      .orderBy(asc(schema.pageOperationStates.pageId));
    const pages: ArchivedPageOperationState[] = [];
    const coverage: PageOperationBackupCoverage[] = [];

    for (const state of states) {
      const checkpointRows = await tx
        .select({
          id: schema.pageOperationCheckpoints.id,
          pageId: schema.pageOperationCheckpoints.pageId,
          workspaceId: schema.pageOperationCheckpoints.workspaceId,
          throughPageSequence: schema.pageOperationCheckpoints.throughPageSequence,
          frontierEnvelopeId: schema.pageOperationCheckpoints.frontierEnvelopeId,
          snapshotEnvelopeId: schema.pageOperationCheckpoints.snapshotEnvelopeId,
          snapshotDigest: schema.pageOperationCheckpoints.snapshotDigest,
          canonicalDigest: schema.pageOperationCheckpoints.canonicalDigest,
          revisionId: schema.pageOperationCheckpoints.revisionId,
          state: schema.pageOperationCheckpoints.state,
          createdAt: schema.pageOperationCheckpoints.createdAt,
          verifiedAt: schema.pageOperationCheckpoints.verifiedAt,
        })
        .from(schema.pageOperationCheckpoints)
        .where(
          and(
            eq(schema.pageOperationCheckpoints.workspaceId, this.deps.workspaceId),
            eq(schema.pageOperationCheckpoints.pageId, state.pageId),
          ),
        )
        .orderBy(asc(schema.pageOperationCheckpoints.throughPageSequence));
      const checkpoints = checkpointRows.filter(
        (checkpoint) =>
          checkpoint.id === state.currentCheckpointId ||
          ["verified", "retained"].includes(checkpoint.state),
      );
      const updates = await tx
        .select({
          id: schema.pageOperationUpdates.id,
          pageId: schema.pageOperationUpdates.pageId,
          workspaceId: schema.pageOperationUpdates.workspaceId,
          pageSequence: schema.pageOperationUpdates.pageSequence,
          authoredByDeviceId: schema.pageOperationUpdates.authoredByDeviceId,
          baseFrontierEnvelopeId: schema.pageOperationUpdates.baseFrontierEnvelopeId,
          resultFrontierEnvelopeId: schema.pageOperationUpdates.resultFrontierEnvelopeId,
          updateEnvelopeId: schema.pageOperationUpdates.updateEnvelopeId,
          updateDigest: schema.pageOperationUpdates.updateDigest,
          status: schema.pageOperationUpdates.status,
          failureCode: schema.pageOperationUpdates.failureCode,
          acceptedAt: schema.pageOperationUpdates.acceptedAt,
          // `to_jsonb` keeps pre-0009 update-guard backups readable: a missing
          // key becomes null without referring to a column that does not exist.
          compactedAt: sql<Date | string | null>`
            (to_jsonb(page_operation_updates) ->> 'compacted_at')::timestamptz
          `,
        })
        .from(schema.pageOperationUpdates)
        .where(
          and(
            eq(schema.pageOperationUpdates.workspaceId, this.deps.workspaceId),
            eq(schema.pageOperationUpdates.pageId, state.pageId),
          ),
        )
        .orderBy(asc(schema.pageOperationUpdates.pageSequence));
      const frontiers = await tx
        .select()
        .from(schema.pageDeviceFrontiers)
        .where(
          and(
            eq(schema.pageDeviceFrontiers.workspaceId, this.deps.workspaceId),
            eq(schema.pageDeviceFrontiers.pageId, state.pageId),
          ),
        )
        .orderBy(asc(schema.pageDeviceFrontiers.deviceId));
      const ambiguities = await tx
        .select()
        .from(schema.pageAmbiguities)
        .where(
          and(
            eq(schema.pageAmbiguities.workspaceId, this.deps.workspaceId),
            eq(schema.pageAmbiguities.pageId, state.pageId),
          ),
        )
        .orderBy(asc(schema.pageAmbiguities.id));
      const conversions = await tx
        .select()
        .from(schema.pageLegacyBranchConversions)
        .where(
          and(
            eq(schema.pageLegacyBranchConversions.workspaceId, this.deps.workspaceId),
            eq(schema.pageLegacyBranchConversions.pageId, state.pageId),
          ),
        )
        .orderBy(asc(schema.pageLegacyBranchConversions.branchId));

      const archivedCheckpoints: ArchivedPageOperationCheckpoint[] = [];
      for (const checkpoint of checkpoints) {
        const frontier = await this.deps.crypto.openFrontier(
          tx,
          checkpoint.frontierEnvelopeId as Uuid,
        );
        const snapshot = await this.deps.crypto.openBytes(
          tx,
          "checkpoint",
          checkpoint.snapshotEnvelopeId as Uuid,
        );
        archivedCheckpoints.push({
          id: checkpoint.id as Uuid,
          throughPageSequence: checkpoint.throughPageSequence,
          frontier: archiveFrontier(frontier),
          snapshotBytes: encoded(snapshot),
          snapshotDigest: checkpoint.snapshotDigest,
          canonicalDigest: checkpoint.canonicalDigest,
          revisionId: checkpoint.revisionId as Uuid | null,
          state: checkpoint.state as ArchivedPageOperationCheckpoint["state"],
          createdAt: checkpoint.createdAt.toISOString(),
          verifiedAt: date(checkpoint.verifiedAt),
        });
        if (["verified", "retained"].includes(checkpoint.state)) {
          coverage.push({
            checkpointId: checkpoint.id as Uuid,
            snapshotDigest: checkpoint.snapshotDigest,
            canonicalDigest: checkpoint.canonicalDigest,
          });
        }
      }

      const archivedUpdates: ArchivedPageOperationUpdate[] = [];
      for (const update of updates) {
        const resultFrontier = await this.deps.crypto.openFrontier(
          tx,
          update.resultFrontierEnvelopeId as Uuid,
        );
        const baseFrontier =
          update.baseFrontierEnvelopeId === null
            ? null
            : archiveFrontier(
                await this.deps.crypto.openFrontier(tx, update.baseFrontierEnvelopeId as Uuid),
              );
        const updateBytes =
          update.updateEnvelopeId === null
            ? null
            : encoded(
                await this.deps.crypto.openBytes(tx, "update", update.updateEnvelopeId as Uuid),
              );
        archivedUpdates.push({
          id: update.id as Uuid,
          pageSequence: update.pageSequence,
          authoredByDeviceId: update.authoredByDeviceId as Uuid,
          baseFrontier,
          resultFrontier: archiveFrontier(resultFrontier),
          updateBytes,
          updateDigest: update.updateDigest,
          status: update.status as ArchivedPageOperationUpdate["status"],
          failureCode: update.failureCode,
          acceptedAt: update.acceptedAt.toISOString(),
          compactedAt: date(update.compactedAt),
        });
      }

      const archivedFrontiers: ArchivedPageDeviceFrontier[] = [];
      for (const frontier of frontiers) {
        archivedFrontiers.push({
          deviceId: frontier.deviceId as Uuid,
          frontier: archiveFrontier(
            await this.deps.crypto.openFrontier(tx, frontier.frontierEnvelopeId as Uuid),
          ),
          frontierDigest: frontier.frontierDigest,
          confirmedPageSequence: frontier.confirmedPageSequence,
          recordVersion: frontier.recordVersion,
          lastConfirmedAt: frontier.lastConfirmedAt.toISOString(),
          deviceState: frontier.deviceState as ArchivedPageDeviceFrontier["deviceState"],
        });
      }

      const archivedAmbiguities: ArchivedPageAmbiguity[] = [];
      for (const ambiguity of ambiguities) {
        archivedAmbiguities.push({
          id: ambiguity.id as Uuid,
          logicalKey: ambiguity.logicalKey,
          kind: ambiguity.kind as ArchivedPageAmbiguity["kind"],
          status: ambiguity.status as ArchivedPageAmbiguity["status"],
          detailsBytes: encoded(
            await this.deps.crypto.openBytes(tx, "ambiguity", ambiguity.detailsEnvelopeId as Uuid),
          ),
          sourceUpdateIds: ambiguity.sourceUpdateIds as Uuid[],
          openedAt: ambiguity.openedAt.toISOString(),
          resolvedAt: date(ambiguity.resolvedAt),
          resolutionRevisionId: ambiguity.resolutionRevisionId as Uuid | null,
        });
      }

      const archivedConversions: ArchivedLegacyBranchConversion[] = [];
      for (const conversion of conversions) {
        archivedConversions.push({
          branchId: conversion.branchId as Uuid,
          requestDigest: conversion.requestDigest,
          status: conversion.status as ArchivedLegacyBranchConversion["status"],
          responseBytes:
            conversion.responseEnvelopeId === null
              ? null
              : encoded(
                  await this.deps.crypto.openBytes(
                    tx,
                    "legacyResponse",
                    conversion.responseEnvelopeId as Uuid,
                  ),
                ),
          checkpointId: conversion.checkpointId as Uuid | null,
          conversionUpdateIds: conversion.conversionUpdateIds as Uuid[],
          localDocumentDigest: conversion.localDocumentDigest,
          createdAt: conversion.createdAt.toISOString(),
          convertedAt: date(conversion.convertedAt),
        });
      }

      pages.push({
        pageId: state.pageId as Uuid,
        status: state.status as ArchivedPageOperationState["status"],
        operationalFormat: state.operationalFormat,
        operationalVersion: state.operationalVersion,
        currentCheckpointId: state.currentCheckpointId as Uuid | null,
        currentFrontier:
          state.currentFrontierEnvelopeId === null
            ? null
            : archiveFrontier(
                await this.deps.crypto.openFrontier(tx, state.currentFrontierEnvelopeId as Uuid),
              ),
        operationalDigest: state.operationalDigest,
        canonicalDigest: state.canonicalDigest,
        canonicalFormatVersion: state.canonicalFormatVersion,
        lastUpdateSequence: state.lastUpdateSequence,
        lastRevisionId: state.lastRevisionId as Uuid | null,
        revisionWindowStartedAt: date(state.revisionWindowStartedAt),
        revisionWindowLastUpdateAt: date(state.revisionWindowLastUpdateAt),
        revisionWindowFrontier:
          state.revisionWindowFrontierEnvelopeId === null
            ? null
            : archiveFrontier(
                await this.deps.crypto.openFrontier(
                  tx,
                  state.revisionWindowFrontierEnvelopeId as Uuid,
                ),
              ),
        bootstrappedAt: date(state.bootstrappedAt),
        updatedAt: state.updatedAt.toISOString(),
        checkpoints: archivedCheckpoints,
        updates: archivedUpdates,
        deviceFrontiers: archivedFrontiers,
        ambiguities: archivedAmbiguities,
        legacyBranchConversions: archivedConversions,
      });
    }

    return {
      archive: {
        format: PAGE_OPERATION_ARCHIVE_FORMAT,
        formatVersion: PAGE_OPERATION_ARCHIVE_VERSION,
        pages,
        counts: {
          pages: pages.length,
          checkpoints: pages.reduce((sum, page) => sum + page.checkpoints.length, 0),
          updates: pages.reduce((sum, page) => sum + page.updates.length, 0),
          deviceFrontiers: pages.reduce((sum, page) => sum + page.deviceFrontiers.length, 0),
          ambiguities: pages.reduce((sum, page) => sum + page.ambiguities.length, 0),
          legacyBranchConversions: pages.reduce(
            (sum, page) => sum + page.legacyBranchConversions.length,
            0,
          ),
        },
      },
      coverage,
    };
  }

  async verify(archive: PageOperationArchive, canonicalExport?: unknown): Promise<void> {
    const canonicalItems = new Map<string, unknown>();
    if (isRecord(canonicalExport) && Array.isArray(canonicalExport["items"])) {
      for (const item of canonicalExport["items"]) {
        if (isRecord(item) && typeof item["id"] === "string") {
          canonicalItems.set(item["id"], item["pageDocument"]);
        }
      }
    }

    for (const page of archive.pages) {
      if (page.currentCheckpointId === null) {
        if (page.status === "legacy") continue;
        throw new TypeError("a non-legacy operational backup has no current checkpoint");
      }
      const current = page.checkpoints.find(({ id }) => id === page.currentCheckpointId);
      if (current === undefined || page.currentFrontier === null) {
        throw new TypeError("an active operational backup has no current checkpoint");
      }
      for (const frontier of page.deviceFrontiers) {
        if (
          (await sha256Hex(decoded(frontier.frontier.versionVector))) !== frontier.frontierDigest ||
          frontier.confirmedPageSequence > page.lastUpdateSequence
        ) {
          throw new TypeError(
            "an operational device frontier does not match its digest or sequence",
          );
        }
      }
      const pageUpdateIds = new Set(page.updates.map(({ id }) => id));
      if (
        page.ambiguities.some(({ sourceUpdateIds }) =>
          sourceUpdateIds.some((updateId) => !pageUpdateIds.has(updateId)),
        )
      ) {
        throw new TypeError("an operational ambiguity names an update absent from the backup");
      }
      for (const checkpoint of page.checkpoints) {
        const opened = await this.#openCheckpoint(page, checkpoint);
        const projection = await opened.project();
        if (projection.canonicalDigest !== checkpoint.canonicalDigest) {
          throw new TypeError("an operational checkpoint does not reproduce its canonical digest");
        }
      }
      const document = await this.#openCheckpoint(page, current);
      const ordered = [...page.updates].sort(
        (left, right) => left.pageSequence - right.pageSequence,
      );
      if (
        ordered.length !== page.lastUpdateSequence ||
        ordered.some((update, index) => update.pageSequence !== index + 1)
      ) {
        throw new TypeError("an operational backup has a non-contiguous update log");
      }
      for (const update of ordered) {
        if (update.pageSequence <= current.throughPageSequence) continue;
        if (update.updateBytes === null) {
          throw new TypeError("an update after the current checkpoint has no bytes");
        }
        const bytes = decoded(update.updateBytes);
        if ((await sha256Hex(bytes)) !== update.updateDigest) {
          throw new TypeError("an operational update does not match its digest");
        }
        const imported = document.importUpdate(bytes);
        if (
          imported.pending ||
          !versionVectorBytesEqual(
            imported.versionVector,
            decoded(update.resultFrontier.versionVector),
          )
        ) {
          throw new TypeError("an operational update cannot be reconstructed from the backup");
        }
      }
      const projection = await document.project();
      if (
        projection.canonicalDigest !== page.canonicalDigest ||
        projection.operationalDigest !== page.operationalDigest ||
        !versionVectorBytesEqual(
          document.versionVectorBytes(),
          decoded(page.currentFrontier.versionVector),
        )
      ) {
        throw new TypeError("an operational page does not reproduce its archived head");
      }
      const canonicalEnvelope = canonicalItems.get(page.pageId);
      if (
        canonicalExport !== undefined &&
        (!isRecord(canonicalEnvelope) || typeof canonicalEnvelope["formatVersion"] !== "number")
      ) {
        throw new TypeError("an operational page is missing from the canonical export");
      }
      if (!isRecord(canonicalEnvelope) || typeof canonicalEnvelope["formatVersion"] !== "number") {
        continue;
      }
      const migrated = migrateStoredPageDocumentToV3({
        formatVersion: canonicalEnvelope["formatVersion"],
        body: canonicalEnvelope["body"],
      });
      if (
        !migrated.ok ||
        (await documentDigestV3(normaliseDocumentV3(migrated.document))) !== page.canonicalDigest
      ) {
        throw new TypeError("the canonical export and operational backup disagree");
      }
    }
  }

  async restore(tx: Transaction, rawArchive: unknown): Promise<void> {
    const archive = readPageOperationArchive(rawArchive);
    await this.verify(archive);
    const deviceIds = [
      ...new Set(
        archive.pages.flatMap((page) => [
          ...page.updates.map(({ authoredByDeviceId }) => authoredByDeviceId),
          ...page.deviceFrontiers.map(({ deviceId }) => deviceId),
        ]),
      ),
    ];
    if (deviceIds.length > 0) {
      const devices = await tx
        .select({ id: schema.authorizedDevices.id })
        .from(schema.authorizedDevices)
        .where(inArray(schema.authorizedDevices.id, deviceIds));
      if (devices.length !== deviceIds.length) {
        throw new TypeError("the restore target is missing an archived authorized device");
      }
    }

    for (const page of archive.pages) {
      const currentFrontierEnvelopeId =
        page.currentFrontier === null
          ? null
          : await this.deps.crypto.sealFrontier(tx, openArchivedFrontier(page.currentFrontier));
      const revisionWindowFrontierEnvelopeId =
        page.revisionWindowFrontier === null
          ? null
          : await this.deps.crypto.sealFrontier(
              tx,
              openArchivedFrontier(page.revisionWindowFrontier),
            );
      await tx.insert(schema.pageOperationStates).values({
        pageId: page.pageId,
        workspaceId: this.deps.workspaceId,
        status: "initializing",
        operationalFormat: page.operationalFormat,
        operationalVersion: page.operationalVersion,
        currentCheckpointId: null,
        currentFrontierEnvelopeId,
        operationalDigest: page.operationalDigest,
        canonicalDigest: page.canonicalDigest,
        canonicalFormatVersion: page.canonicalFormatVersion,
        lastUpdateSequence: page.lastUpdateSequence,
        lastRevisionId: page.lastRevisionId,
        revisionWindowStartedAt:
          page.revisionWindowStartedAt === null ? null : new Date(page.revisionWindowStartedAt),
        revisionWindowLastUpdateAt:
          page.revisionWindowLastUpdateAt === null
            ? null
            : new Date(page.revisionWindowLastUpdateAt),
        revisionWindowFrontierEnvelopeId,
        bootstrappedAt: page.bootstrappedAt === null ? null : new Date(page.bootstrappedAt),
        updatedAt: new Date(page.updatedAt),
      });

      for (const checkpoint of page.checkpoints) {
        const frontierEnvelopeId = await this.deps.crypto.sealFrontier(
          tx,
          openArchivedFrontier(checkpoint.frontier),
        );
        const snapshotEnvelopeId = await this.deps.crypto.sealBytes(
          tx,
          "checkpoint",
          decoded(checkpoint.snapshotBytes),
        );
        await tx.insert(schema.pageOperationCheckpoints).values({
          id: checkpoint.id,
          pageId: page.pageId,
          workspaceId: this.deps.workspaceId,
          throughPageSequence: checkpoint.throughPageSequence,
          frontierEnvelopeId,
          snapshotEnvelopeId,
          snapshotDigest: checkpoint.snapshotDigest,
          canonicalDigest: checkpoint.canonicalDigest,
          revisionId: checkpoint.revisionId,
          verifiedBackupId: null,
          state: checkpoint.state,
          createdAt: new Date(checkpoint.createdAt),
          verifiedAt: checkpoint.verifiedAt === null ? null : new Date(checkpoint.verifiedAt),
        });
      }

      for (const update of page.updates) {
        const resultFrontierEnvelopeId = await this.deps.crypto.sealFrontier(
          tx,
          openArchivedFrontier(update.resultFrontier),
        );
        const baseFrontierEnvelopeId =
          update.baseFrontier === null
            ? null
            : await this.deps.crypto.sealFrontier(tx, openArchivedFrontier(update.baseFrontier));
        const updateEnvelopeId =
          update.updateBytes === null
            ? null
            : await this.deps.crypto.sealBytes(tx, "update", decoded(update.updateBytes));
        await tx.insert(schema.pageOperationUpdates).values({
          id: update.id,
          pageId: page.pageId,
          workspaceId: this.deps.workspaceId,
          pageSequence: update.pageSequence,
          authoredByDeviceId: update.authoredByDeviceId,
          baseFrontierEnvelopeId,
          resultFrontierEnvelopeId,
          updateEnvelopeId,
          updateDigest: update.updateDigest,
          status: update.status,
          failureCode: update.failureCode,
          acceptedAt: new Date(update.acceptedAt),
          compactedAt: update.compactedAt === null ? null : new Date(update.compactedAt),
        });
      }

      for (const frontier of page.deviceFrontiers) {
        const frontierEnvelopeId = await this.deps.crypto.sealFrontier(
          tx,
          openArchivedFrontier(frontier.frontier),
        );
        await tx.insert(schema.pageDeviceFrontiers).values({
          pageId: page.pageId,
          deviceId: frontier.deviceId,
          workspaceId: this.deps.workspaceId,
          frontierEnvelopeId,
          frontierDigest: frontier.frontierDigest,
          confirmedPageSequence: frontier.confirmedPageSequence,
          recordVersion: frontier.recordVersion,
          lastConfirmedAt: new Date(frontier.lastConfirmedAt),
          deviceState: frontier.deviceState,
        });
      }

      for (const ambiguity of page.ambiguities) {
        const detailsEnvelopeId = await this.deps.crypto.sealBytes(
          tx,
          "ambiguity",
          decoded(ambiguity.detailsBytes),
        );
        await tx.insert(schema.pageAmbiguities).values({
          id: ambiguity.id,
          pageId: page.pageId,
          workspaceId: this.deps.workspaceId,
          logicalKey: ambiguity.logicalKey,
          kind: ambiguity.kind,
          status: ambiguity.status,
          detailsEnvelopeId,
          sourceUpdateIds: [...ambiguity.sourceUpdateIds],
          openedAt: new Date(ambiguity.openedAt),
          resolvedAt: ambiguity.resolvedAt === null ? null : new Date(ambiguity.resolvedAt),
          resolutionRevisionId: ambiguity.resolutionRevisionId,
        });
      }

      for (const conversion of page.legacyBranchConversions) {
        const responseEnvelopeId =
          conversion.responseBytes === null
            ? null
            : await this.deps.crypto.sealBytes(
                tx,
                "legacyResponse",
                decoded(conversion.responseBytes),
              );
        await tx.insert(schema.pageLegacyBranchConversions).values({
          branchId: conversion.branchId,
          pageId: page.pageId,
          workspaceId: this.deps.workspaceId,
          requestDigest: conversion.requestDigest,
          status: conversion.status,
          responseEnvelopeId,
          checkpointId: conversion.checkpointId,
          conversionUpdateIds: [...conversion.conversionUpdateIds],
          localDocumentDigest: conversion.localDocumentDigest,
          createdAt: new Date(conversion.createdAt),
          convertedAt: conversion.convertedAt === null ? null : new Date(conversion.convertedAt),
        });
      }

      await tx
        .update(schema.pageOperationStates)
        .set({ status: page.status, currentCheckpointId: page.currentCheckpointId })
        .where(
          and(
            eq(schema.pageOperationStates.workspaceId, this.deps.workspaceId),
            eq(schema.pageOperationStates.pageId, page.pageId),
          ),
        );
    }
  }

  async checkpointIsInVerifiedBackup(
    tx: Transaction,
    context: PageCheckpointRetentionContext,
  ): Promise<boolean> {
    if (context.workspaceId !== this.deps.workspaceId) return false;
    return await pageOperationCheckpointHasVerifiedBackup(tx, context.checkpointId);
  }

  async #openCheckpoint(
    page: ArchivedPageOperationState,
    checkpoint: ArchivedPageOperationCheckpoint,
  ): Promise<OperationalPageDocument> {
    const frontier = openArchivedFrontier(checkpoint.frontier);
    const operational: OperationalPageCheckpoint = {
      operationalFormat: OPERATIONAL_FORMAT,
      operationalVersion: OPERATIONAL_FORMAT_VERSION,
      pageId: page.pageId,
      bytes: decoded(checkpoint.snapshotBytes),
      digest: checkpoint.snapshotDigest,
      versionVector: frontier.versionVector,
      frontiers: frontier.frontiers,
    };
    return await OperationalPageDocument.fromCheckpoint({
      pageId: page.pageId,
      checkpoint: operational,
    });
  }
}
