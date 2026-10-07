// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DATABASE_COPY } from "../src/features/databases/database-copy.ts";
import { ViewSettingsPanel } from "../src/features/databases/view-settings-panel.tsx";
import { reviewId, reviewProperties, reviewTable } from "../src/ui/ui-lab-review-fixtures.ts";

it("blocks the source action with its reason, then enables it when the lock is lifted", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const onScreen = vi.fn();
  const props = {
    screen: "root" as const,
    name: "Table",
    defaultName: "Tableau",
    type: reviewTable.type,
    view: reviewTable,
    properties: reviewProperties,
    sources: [{ sourceId: reviewId(11), name: "Projet", ownedHere: true, viewCount: 1 }],
    currentSourceId: reviewId(11),
    boardAvailable: true,
    calendarAvailable: true,
    revealOwnedSource: false,
    creatingSource: false,
    filterCount: 0,
    sortCount: 0,
    onScreen,
    onClose: vi.fn(),
    onExited: vi.fn(),
    onNameFocusHandled: vi.fn(),
    onCommitName: vi.fn(),
    onCommitIcon: vi.fn(),
    onChangeFormat: vi.fn(),
    onChangeView: vi.fn(),
    onChangeGrouping: vi.fn(async () => undefined),
    onToggleProperty: vi.fn(),
    onChangeSource: vi.fn(),
    onCreateSource: vi.fn(),
    onRevealOwnedSource: vi.fn(),
    onCreateProperty: vi.fn(async () => undefined),
    onEditProperty: vi.fn(async () => undefined),
    onDuplicateProperty: vi.fn(async () => undefined),
  };
  const sourceButton = () => {
    const button = Array.from(node.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.startsWith("SourceProjet"),
    );
    if (button === undefined) throw new Error("Missing source action");
    return button;
  };
  try {
    await act(async () => root.render(<ViewSettingsPanel {...props} sourceLocked />));
    expect(sourceButton().disabled).toBe(true);
    expect(sourceButton().getAttribute("aria-description")).toBe(DATABASE_COPY.common.sourceLocked);
    await act(async () => sourceButton().click());
    expect(onScreen).not.toHaveBeenCalled();
    await act(async () => root.render(<ViewSettingsPanel {...props} sourceLocked={false} />));
    expect(sourceButton().disabled).toBe(false);
    expect(sourceButton().hasAttribute("aria-description")).toBe(false);
    await act(async () => sourceButton().click());
    expect(onScreen).toHaveBeenCalledExactlyOnceWith("source");
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
