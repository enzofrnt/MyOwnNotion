import type {
  DatabaseProperty,
  DatabaseView,
  GroupCriterion,
  SortCriterion,
  Uuid,
} from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";

function draftSignature(sorts: readonly SortCriterion[], group: GroupCriterion | null): string {
  return JSON.stringify({ sorts, group });
}

export function SortGroupEditor({
  properties,
  view,
  onChange,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly onChange: (view: DatabaseView) => void | Promise<void>;
}) {
  const active = properties.filter(({ state }) => state === "active");
  const groupable = active.filter(
    ({ type }) => type === "status" || type === "select" || type === "checkbox",
  );
  const [sorts, setSorts] = useState(view.sorts);
  const [group, setGroup] = useState<GroupCriterion | null>(view.group);
  const [saving, setSaving] = useState(false);
  const sortsRef = useRef(sorts);
  const groupRef = useRef(group);
  const dirty = useRef(false);
  const pendingSignature = useRef<string | null>(null);
  const updateSorts = (update: (current: typeof sorts) => typeof sorts): void => {
    setSorts((current) => {
      const next = update(current);
      sortsRef.current = next;
      dirty.current = true;
      return next;
    });
  };
  const updateGroup = (next: GroupCriterion | null): void => {
    groupRef.current = next;
    dirty.current = true;
    setGroup(next);
  };
  useEffect(() => {
    const incomingSignature = draftSignature(view.sorts, view.group);
    if (pendingSignature.current !== null) {
      if (pendingSignature.current === incomingSignature) {
        pendingSignature.current = null;
        if (draftSignature(sortsRef.current, groupRef.current) === incomingSignature) {
          dirty.current = false;
        }
      }
      return;
    }
    if (dirty.current) return;
    sortsRef.current = view.sorts;
    groupRef.current = view.group;
    setSorts(view.sorts);
    setGroup(view.group);
  }, [view.group, view.sorts]);
  const updateSort = (index: number, change: Partial<SortCriterion>): void => {
    updateSorts((current) =>
      current.map((sort, position) => (position === index ? { ...sort, ...change } : sort)),
    );
  };
  const moveSort = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= sorts.length) return;
    updateSorts((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(target, 0, moved);
      return next;
    });
  };
  const unusedProperties = active.filter(
    (property) => !sorts.some((sort) => sort.propertyId === property.id),
  );

  return (
    <details className="database-rule-editor">
      <summary>
        Sort & group · {sorts.length} sort{sorts.length === 1 ? "" : "s"}
        {group === null ? "" : " · grouped"}
      </summary>
      <fieldset className="database-rule-controls" disabled={saving} aria-busy={saving}>
        <ol className="database-rules">
          {sorts.map((sort, index) => {
            const property = properties.find(({ id }) => id === sort.propertyId);
            return (
              <li key={sort.propertyId} className="database-rule">
                {property === undefined || property.state !== "active" ? (
                  <span role="alert">Unavailable property</span>
                ) : null}
                <label>
                  Sort property
                  <select
                    value={sort.propertyId}
                    onChange={(event) =>
                      updateSort(index, { propertyId: event.target.value as Uuid })
                    }
                  >
                    {active
                      .filter(
                        (candidate) =>
                          candidate.id === sort.propertyId ||
                          !sorts.some(
                            (other, otherIndex) =>
                              otherIndex !== index && other.propertyId === candidate.id,
                          ),
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Direction
                  <select
                    value={sort.direction}
                    onChange={(event) =>
                      updateSort(index, {
                        direction: event.target.value as SortCriterion["direction"],
                      })
                    }
                  >
                    <option value="ascending">Ascending</option>
                    <option value="descending">Descending</option>
                  </select>
                </label>
                <label>
                  Empty values
                  <select
                    value={sort.missing}
                    onChange={(event) =>
                      updateSort(index, {
                        missing: event.target.value as SortCriterion["missing"],
                      })
                    }
                  >
                    <option value="last">Last</option>
                    <option value="first">First</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateSorts((current) => current.filter((_, position) => position !== index))
                  }
                >
                  Remove sort
                </button>
                <button type="button" disabled={index === 0} onClick={() => moveSort(index, -1)}>
                  Move sort earlier
                </button>
                <button
                  type="button"
                  disabled={index === sorts.length - 1}
                  onClick={() => moveSort(index, 1)}
                >
                  Move sort later
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          disabled={unusedProperties.length === 0}
          onClick={() => {
            const property = unusedProperties[0];
            if (property === undefined) return;
            updateSorts((current) => [
              ...current,
              { propertyId: property.id, direction: "ascending", missing: "last" },
            ]);
          }}
        >
          Add sort
        </button>
        <label>
          Group by
          <select
            value={group?.propertyId ?? ""}
            onChange={(event) =>
              updateGroup(
                event.target.value === "" ? null : { propertyId: event.target.value as Uuid },
              )
            }
          >
            <option value="">No grouping</option>
            {groupable.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            pendingSignature.current = draftSignature(sorts, group);
            setSaving(true);
            void Promise.resolve(onChange({ ...view, sorts, group }))
              .catch(() => {
                pendingSignature.current = null;
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving sort and group…" : "Save sort and group"}
        </button>
      </fieldset>
    </details>
  );
}
