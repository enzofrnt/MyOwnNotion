// @vitest-environment jsdom
import {
  openLocalDatabase,
  readWorkspacePresentationState,
  writeWorkspacePresentationState,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNavigationSettings } from "../src/features/settings/workspace-navigation-settings.tsx";

describe("workspace navigation settings", () => {
  const databases: ReturnType<typeof openLocalDatabase>[] = [];
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    await Promise.all(databases.splice(0).map(async (database) => await database.delete()));
  });

  it("changes only device-local shortcut visibility", async () => {
    const db = openLocalDatabase(`navigation-settings-${generateUuidV7()}`);
    databases.push(db);
    const initial = await readWorkspacePresentationState(db);
    await writeWorkspacePresentationState(db, {
      ...initial,
      favouritesExpanded: false,
    });

    await act(async () => {
      root.render(<WorkspaceNavigationSettings db={db} />);
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="navigation-settings"]')).not.toBeNull();
      });
    });
    const favourites = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (input) => input.getAttribute("aria-label") === "Afficher les favoris",
    );
    if (favourites === undefined) throw new Error("favourites setting missing");
    expect(favourites.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

    act(() => {
      favourites.click();
    });
    // The control acknowledges only durable state. Leaving settings after
    // aria-checked changes must therefore never race the IndexedDB write.
    expect(favourites.getAttribute("aria-checked")).toBe("true");
    expect(favourites.disabled).toBe(true);
    await act(async () => {
      await vi.waitFor(async () => {
        const state = await readWorkspacePresentationState(db);
        expect(state.favouritesVisible).toBe(false);
        expect(state.favouritesExpanded).toBe(false);
        expect(state.recentsVisible).toBe(true);
      });
    });
    expect(favourites.getAttribute("aria-checked")).toBe("false");
    expect(favourites.disabled).toBe(false);
  });
});
