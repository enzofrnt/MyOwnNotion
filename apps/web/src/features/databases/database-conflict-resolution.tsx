/** Three-way resolution for structured database definitions and entry values (T082). */

import type { ConflictRecordRow, StructuredConflictContext } from "@myownnotion/client-core";
import type {
  DatabaseDefinition,
  DatabaseImpactConfirmation,
  EntryValues,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { jsonValuesEqual } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import type { ConflictSide } from "../sync/conflict-resolution.tsx";
import { DATABASE_COPY } from "./database-copy.ts";

type Choice = ConflictSide;

function same(left: unknown, right: unknown): boolean {
  return jsonValuesEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifiedArray(value: readonly unknown[]): value is Array<Record<string, unknown>> {
  return value.every((item) => isRecord(item) && typeof item["id"] === "string");
}

function stablePath(path: string): string {
  return path.replace(/^(values\.[^.]+)\..+$/, "$1");
}

/**
 * Replays the same three-way rule as the domain merge, with an owner's choice
 * at every genuinely divergent leaf. Compatible changes from both devices are
 * retained; starting from one whole version would silently omit compatible
 * changes made only on the other device.
 */
function resolveNode(
  ancestor: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  choices: ReadonlyMap<string, Choice>,
): unknown {
  if (same(local, remote)) return local;
  if (same(local, ancestor)) return remote;
  if (same(remote, ancestor)) return local;

  const choose = () => (choices.get(stablePath(path)) === "remote" ? remote : local);
  if (ancestor !== undefined && (local === undefined || remote === undefined)) return choose();

  if (Array.isArray(ancestor) && Array.isArray(local) && Array.isArray(remote)) {
    if (isIdentifiedArray(ancestor) && isIdentifiedArray(local) && isIdentifiedArray(remote)) {
      const byId = (values: Array<Record<string, unknown>>) =>
        new Map(values.map((value) => [value["id"] as string, value]));
      const ancestorById = byId(ancestor);
      const localById = byId(local);
      const remoteById = byId(remote);
      const ids = [...new Set([...localById.keys(), ...remoteById.keys(), ...ancestorById.keys()])];
      return ids.flatMap((id) => {
        const value = resolveNode(
          ancestorById.get(id),
          localById.get(id),
          remoteById.get(id),
          path.length === 0 ? id : `${path}.${id}`,
          choices,
        );
        return value === undefined ? [] : [value];
      });
    }
    return choose();
  }

  if (isRecord(ancestor) && isRecord(local) && isRecord(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(ancestor), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = resolveNode(
        ancestor[key],
        local[key],
        remote[key],
        path.length === 0 ? key : `${path}.${key}`,
        choices,
      );
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  return choose();
}

function valueAt(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      current = current.find((value) => isRecord(value) && value["id"] === segment);
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function display(value: unknown): string {
  return value === undefined
    ? DATABASE_COPY.conflict.removed
    : (JSON.stringify(value, null, 2) ?? String(value));
}

function versionValue(
  context: StructuredConflictContext,
  version: "ancestor" | Choice,
  path: string,
) {
  if (context.kind === "database-entry-values" && path.startsWith("relations.")) {
    const relationKey =
      version === "ancestor"
        ? "ancestorRelationTargets"
        : version === "local"
          ? "localRelationTargets"
          : "remoteRelationTargets";
    return valueAt({ relations: context[relationKey] }, path);
  }
  return valueAt(context[version], path);
}

export type StructuredResolution =
  | { readonly kind: "database-definition"; readonly definition: DatabaseDefinition }
  | {
      readonly kind: "database-entry-values";
      readonly entryValues: EntryValues;
      readonly relationTargets: RelationTargets;
    };

export function assembleStructuredResolution(
  context: StructuredConflictContext,
  choices: ReadonlyMap<string, Choice>,
): StructuredResolution {
  if (context.kind === "database-definition") {
    return {
      kind: context.kind,
      definition: resolveNode(
        context.ancestor,
        context.local,
        context.remote,
        "",
        choices,
      ) as DatabaseDefinition,
    };
  }
  return {
    kind: context.kind,
    entryValues: resolveNode(
      context.ancestor,
      context.local,
      context.remote,
      "",
      choices,
    ) as EntryValues,
    relationTargets: resolveNode(
      context.ancestorRelationTargets,
      context.localRelationTargets,
      context.remoteRelationTargets,
      "relations",
      choices,
    ) as RelationTargets,
  };
}

export function StructuredConflictCard({
  row,
  service,
  onResolved,
}: {
  readonly row: ConflictRecordRow & { readonly structured: StructuredConflictContext };
  readonly service: LocalContentService;
  readonly onResolved: () => void;
}) {
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ readonly digest: string } | null>(null);
  const result = useMemo(
    () => assembleStructuredResolution(row.structured, choices),
    [row.structured, choices],
  );
  const payload = row.payload as { databaseId?: unknown; entryId?: unknown };
  // Resolution parents must be server-known revisions. The optimistic local
  // revision exists only in this browser; its content is carried by the chosen
  // resolution snapshot, while the common ancestor and remote head are the two
  // durable lineage nodes the server can reference.
  const localRevisionId = row.baseRevisionIds[0];
  const remoteRevisionId = row.competingRevisionIds[0];

  const finish = useCallback(
    async (impactConfirmation?: DatabaseImpactConfirmation) => {
      if (
        typeof payload.databaseId !== "string" ||
        localRevisionId === undefined ||
        remoteRevisionId === undefined
      ) {
        setFailure(DATABASE_COPY.conflict.missingVersions);
        return;
      }
      setSaving(true);
      setFailure(null);
      if (result.kind === "database-definition" && impactConfirmation === undefined) {
        const item = await service.getItem(payload.databaseId as Uuid);
        const impact =
          item === null
            ? null
            : await service.previewDatabaseDefinitionImpact(
                payload.databaseId as Uuid,
                item.currentRevisionId,
                result.definition,
              );
        if (impact?.destructive) {
          setConfirmation({ digest: impact.impactDigest });
          setSaving(false);
          return;
        }
      }
      const outcome =
        result.kind === "database-definition"
          ? await service.resolveDatabaseDefinitionConflict({
              conflictMutationId: row.mutationId,
              databaseId: payload.databaseId as Uuid,
              localRevisionId,
              remoteRevisionId,
              definition: result.definition,
              ...(impactConfirmation === undefined ? {} : { impactConfirmation }),
            })
          : typeof payload.entryId !== "string"
            ? {
                ok: false as const,
                error: {
                  code: "validation.invalid-payload",
                  title: DATABASE_COPY.conflict.missingEntry,
                },
              }
            : await service.resolveDatabaseEntryConflict({
                conflictMutationId: row.mutationId,
                databaseId: payload.databaseId as Uuid,
                entryId: payload.entryId as Uuid,
                localRevisionId,
                remoteRevisionId,
                entryValues: result.entryValues,
                relationTargets: result.relationTargets,
              });
      setSaving(false);
      if (!outcome.ok) {
        setFailure(`${outcome.error.code}: ${outcome.error.title}`);
        return;
      }
      setConfirmation(null);
      onResolved();
    },
    [payload, localRevisionId, remoteRevisionId, result, row.mutationId, service, onResolved],
  );

  return (
    <section
      className="panel"
      aria-label={DATABASE_COPY.conflict.region}
      data-testid={`database-conflict-${row.mutationId}`}
    >
      <h2>{DATABASE_COPY.conflict.heading}</h2>
      <p className="muted">{DATABASE_COPY.conflict.explanation}</p>
      <table className="conflict-columns">
        <caption className="muted">{DATABASE_COPY.conflict.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{DATABASE_COPY.conflict.field}</th>
            <th scope="col">{DATABASE_COPY.conflict.thisDevice}</th>
            <th scope="col">{DATABASE_COPY.conflict.ancestor}</th>
            <th scope="col">{DATABASE_COPY.conflict.otherDevice}</th>
            <th scope="col">{DATABASE_COPY.conflict.keep}</th>
          </tr>
        </thead>
        <tbody>
          {row.structured.conflicts.map((conflict) => {
            const choice = choices.get(conflict.path) ?? "local";
            return (
              <tr key={`${conflict.path}:${conflict.reason}`}>
                <th scope="row">{conflict.path}</th>
                {(["local", "ancestor", "remote"] as const).map((version) => (
                  <td key={version} data-column={version}>
                    <pre data-testid={`database-conflict-${version}-${conflict.path}`}>
                      {display(versionValue(row.structured, version, conflict.path))}
                    </pre>
                  </td>
                ))}
                <td data-column="Keep">
                  <fieldset>
                    <legend className="muted">
                      {DATABASE_COPY.conflict.keepFor(conflict.path)}
                    </legend>
                    {(["local", "remote"] as const).map((option) => (
                      <label key={option}>
                        <input
                          type="radio"
                          name={`${row.mutationId}-${conflict.path}`}
                          checked={choice === option}
                          onChange={() =>
                            setChoices((current) => new Map(current).set(conflict.path, option))
                          }
                        />
                        {option === "local"
                          ? DATABASE_COPY.conflict.thisDevice
                          : DATABASE_COPY.conflict.otherDevice}
                      </label>
                    ))}
                  </fieldset>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>{DATABASE_COPY.conflict.review}</h3>
      <pre data-testid="database-conflict-review">{display(result)}</pre>

      {confirmation !== null ? (
        <section
          className="database-impact"
          role="alertdialog"
          aria-label={DATABASE_COPY.conflict.confirmSchema}
        >
          <p>{DATABASE_COPY.conflict.schemaImpact}</p>
          <button
            type="button"
            onClick={() =>
              void finish({ digest: confirmation.digest, decision: "preserve-incompatible" })
            }
          >
            {DATABASE_COPY.common.preserveIncompatible}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              void finish({ digest: confirmation.digest, decision: "discard-confirmed" })
            }
          >
            {DATABASE_COPY.common.discardAffected}
          </button>
        </section>
      ) : null}
      {failure === null ? null : (
        <p className="status-banner" data-state="error" role="alert">
          {failure}
        </p>
      )}
      <button type="button" disabled={saving} onClick={() => void finish()}>
        {saving ? DATABASE_COPY.common.saving : DATABASE_COPY.conflict.save}
      </button>
    </section>
  );
}

export function DatabaseConflictResolution({
  service,
  itemId,
  onResolved,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  readonly onResolved: () => void;
}) {
  const [rows, setRows] = useState<
    Array<ConflictRecordRow & { readonly structured: StructuredConflictContext }>
  >([]);
  const refresh = useCallback(async () => {
    const conflicts = await service.outbox.conflicts();
    setRows(
      conflicts.filter(
        (row): row is ConflictRecordRow & { readonly structured: StructuredConflictContext } => {
          if (row.structured === undefined) return false;
          const payload = row.payload as { databaseId?: unknown; entryId?: unknown };
          return payload.databaseId === itemId || payload.entryId === itemId;
        },
      ),
    );
  }, [service, itemId]);

  useEffect(() => {
    void refresh();
    return service.subscribe(() => void refresh());
  }, [service, refresh]);

  return rows.map((row) => (
    <StructuredConflictCard
      key={row.mutationId}
      row={row}
      service={service}
      onResolved={() => {
        void refresh();
        onResolved();
      }}
    />
  ));
}
