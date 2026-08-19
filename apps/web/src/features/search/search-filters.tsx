import type { ItemKind, Uuid } from "@myownnotion/domain";

export const ALL_SEARCH_KINDS = ["page", "folder", "file"] as const satisfies readonly ItemKind[];

export interface SearchBranchOption {
  readonly itemId: Uuid;
  readonly label: string;
}

const KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  page: "Pages",
  folder: "Folders",
  file: "Files",
};

export function SearchFilters({
  kinds,
  branchRootItemId,
  branches,
  onKindsChange,
  onBranchChange,
  onReset,
}: {
  readonly kinds: readonly ItemKind[];
  readonly branchRootItemId: Uuid | null;
  readonly branches: readonly SearchBranchOption[];
  readonly onKindsChange: (kinds: readonly ItemKind[]) => void;
  readonly onBranchChange: (itemId: Uuid | null) => void;
  readonly onReset: () => void;
}) {
  const activeKinds = new Set(kinds);
  const hasActiveFilter = kinds.length !== ALL_SEARCH_KINDS.length || branchRootItemId !== null;

  return (
    <div className="search-filters">
      <fieldset>
        <legend>Filter by type</legend>
        <div className="search-filters__kinds">
          {ALL_SEARCH_KINDS.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={activeKinds.has(kind)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? new Set([...kinds, kind])
                    : new Set(kinds.filter((value) => value !== kind));
                  onKindsChange(ALL_SEARCH_KINDS.filter((value) => next.has(value)));
                }}
              />
              {KIND_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="search-filters__branch">
        Branch
        <select
          value={branchRootItemId ?? ""}
          onChange={(event) =>
            onBranchChange(event.target.value === "" ? null : (event.target.value as Uuid))
          }
        >
          <option value="">Whole workspace</option>
          {branches.map((branch) => (
            <option key={branch.itemId} value={branch.itemId}>
              {branch.label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" disabled={!hasActiveFilter} onClick={onReset}>
        Reset filters
      </button>
    </div>
  );
}
