// @vitest-environment jsdom
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useContainerView } from "../src/features/databases/use-container-view.ts";

function Context({ owner, view }: { owner: Uuid; view: Uuid }) {
  const [selected, select] = useContainerView(owner);
  return (
    <>
      <output>{selected ?? "none"}</output>
      <button type="button" onClick={() => select(view)}>
        Select
      </button>
      <button type="button" onClick={() => select(null)}>
        Clear
      </button>
    </>
  );
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const selected = () => container.querySelector("output")?.textContent;
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (button === undefined) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
it("restores the chosen view after remount and keeps container contexts independent", async () => {
  const owner = generateUuidV7();
  const other = generateUuidV7();
  const view = generateUuidV7();
  await act(async () => root.render(<Context owner={owner} view={view} />));
  click("Select");
  await act(async () => root.render(null));
  await act(async () => root.render(<Context owner={owner} view={view} />));
  expect(selected()).toBe(view);
  await act(async () => root.render(<Context owner={other} view={view} />));
  expect(selected()).toBe("none");
  await act(async () => root.render(<Context owner={owner} view={view} />));
  expect(selected()).toBe(view);
  click("Clear");
  await act(async () => root.render(null));
  await act(async () => root.render(<Context owner={owner} view={view} />));
  expect(selected()).toBe("none");
});
it("ignores corrupt stored identities and remains usable when browser storage is denied", async () => {
  const owner = generateUuidV7();
  const view = generateUuidV7();
  sessionStorage.setItem(`myOwnNotion.databaseContainerView.${owner}`, "invalid");
  await act(async () => root.render(<Context owner={owner} view={view} />));
  expect(selected()).toBe("none");
  await act(async () => root.render(null));
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  await act(async () => root.render(<Context owner={owner} view={view} />));
  click("Select");
  expect(selected()).toBe(view);
  click("Clear");
  expect(selected()).toBe("none");
});
