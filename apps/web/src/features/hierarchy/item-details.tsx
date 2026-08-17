/**
 * Stable identity and relationship diagnostics (T068, US3).
 *
 * Exposes the item's immutable UUID, current revision, and its typed
 * relationships with endpoint availability — unavailable targets are
 * reported explicitly, never silently redirected (FR-011/FR-014).
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { ProblemDto, RelationshipDto } from "@myownnotion/contracts";
import { generateUuidV7, isUuid, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";

export function ItemDetails({ item }: { readonly item: ProjectedItem }) {
  const api = useMemo(() => new ContentApi(), []);
  const [relationships, setRelationships] = useState<RelationshipDto[]>([]);
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [targetId, setTargetId] = useState("");
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api.listRelationships(item.id);
    if (!result.ok) {
      setOffline(result.offline);
      return;
    }
    setOffline(false);
    setRelationships(result.value.relationships);
  }, [api, item.id]);

  // `item` identity changes on every projection refresh: endpoint
  // availability (e.g. a freshly trashed target) must refetch too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `item` is intentionally tracked though unused in the body — see comment above.
  useEffect(() => {
    void refresh();
  }, [refresh, item]);

  const createRelationship = useCallback(async () => {
    setProblem(null);
    if (!isUuid(targetId)) {
      setProblem({
        type: "about:client",
        title: "Target must be a stable item UUID",
        status: 400,
        code: "validation.invalid-identifier",
      });
      return;
    }
    const result = await api.createRelationship(generateUuidV7(), {
      id: generateUuidV7(),
      sourceItemId: item.id,
      targetItemId: targetId,
      relationType: "link:references",
    });
    if (!result.ok) {
      setProblem(result.problem);
    }
    setTargetId("");
    await refresh();
  }, [api, item.id, targetId, refresh]);

  const removeRelationship = useCallback(
    async (relationshipId: Uuid) => {
      setProblem(null);
      const result = await api.removeRelationship(generateUuidV7(), relationshipId);
      if (!result.ok) {
        setProblem(result.problem);
      }
      await refresh();
    },
    [api, refresh],
  );

  return (
    <section className="panel" aria-label="Item details" data-testid="item-details">
      <h2>Identity & relationships</h2>
      <p className="muted">
        Stable ID <code data-testid="stable-id">{item.id}</code> — current revision{" "}
        <code>{item.currentRevisionId}</code>. Renames and moves never change this identity.
      </p>
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert">
          {problem.code}: {problem.title}
        </p>
      ) : null}
      {offline ? (
        <p className="muted">Relationship diagnostics need the server; working offline.</p>
      ) : (
        <>
          <div className="field-row">
            <label htmlFor={`relation-target-${item.id}`} className="muted">
              Relate to item ID
            </label>
            <input
              id={`relation-target-${item.id}`}
              data-testid="relation-target"
              type="text"
              value={targetId}
              placeholder="target item UUID"
              onChange={(event) => setTargetId(event.target.value)}
            />
            <button
              type="button"
              data-testid="create-relation"
              onClick={() => void createRelationship()}
            >
              Link
            </button>
          </div>
          {relationships.length === 0 ? (
            <p className="muted">No relationships.</p>
          ) : (
            <ul className="tree" data-testid="relationship-list">
              {relationships.map((relationship) => (
                <li key={relationship.id} className="tree-row">
                  <span className="tree-kind">{relationship.relationType}</span>
                  <span className="tree-name">
                    {relationship.sourceItemId === item.id ? "→" : "←"}{" "}
                    <code>
                      {relationship.sourceItemId === item.id
                        ? relationship.targetItemId
                        : relationship.sourceItemId}
                    </code>
                  </span>
                  <span className="muted" data-testid="relation-availability">
                    {relationship.sourceItemId === item.id
                      ? (relationship.targetAvailability ?? "active")
                      : (relationship.sourceAvailability ?? "active")}
                  </span>
                  {relationship.relationType === "page:link" ? (
                    <span className="muted">managed in the page document</span>
                  ) : (
                    <span className="tree-actions">
                      <button
                        type="button"
                        aria-label="Remove relationship"
                        onClick={() => void removeRelationship(relationship.id as Uuid)}
                      >
                        unlink
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
