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
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";

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
        title: "La cible doit être l’identifiant UUID stable d’un élément",
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
    <section className="panel" aria-label="Identité et relations" data-testid="item-details">
      <h2>Identité et relations</h2>
      <p className="muted">
        Identifiant stable <code data-testid="stable-id">{item.id}</code> — révision actuelle{" "}
        <code>{item.currentRevisionId}</code>. Un renommage ou un déplacement ne modifie jamais cet
        identifiant.
      </p>
      {problem !== null ? (
        <AsyncState compact kind="error" description={`${problem.code} : ${problem.title}`} />
      ) : null}
      {offline ? (
        <AsyncState
          compact
          kind="offline"
          description="Les relations détaillées nécessitent le serveur. Les données locales restent disponibles."
        />
      ) : (
        <>
          <div className="field-row">
            <Field
              id={`relation-target-${item.id}`}
              data-testid="relation-target"
              type="text"
              label="Identifiant de l’élément lié"
              value={targetId}
              placeholder="UUID de l’élément cible"
              onChange={(event) => setTargetId(event.target.value)}
            />
            <Button
              size="compact"
              type="button"
              data-testid="create-relation"
              onClick={() => void createRelationship()}
            >
              Lier
            </Button>
          </div>
          {relationships.length === 0 ? (
            <p className="muted">Aucune relation.</p>
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
                    <span className="muted">gérée dans le contenu de la page</span>
                  ) : (
                    <span className="tree-actions">
                      <Button
                        size="compact"
                        variant="ghost"
                        type="button"
                        aria-label="Retirer la relation"
                        onClick={() => void removeRelationship(relationship.id as Uuid)}
                      >
                        Délier
                      </Button>
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
