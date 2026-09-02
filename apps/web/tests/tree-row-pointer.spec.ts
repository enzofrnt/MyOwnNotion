import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTreeRowPointerAction,
  createFolderClickScheduler,
  FOLDER_SINGLE_CLICK_DELAY_MS,
  handleFolderRowPointerClick,
  resolveTreeRowPointerAction,
} from "../src/features/navigation/tree-row-pointer.ts";

describe("resolveTreeRowPointerAction", () => {
  it("toggles a folder on the first click without opening it", () => {
    expect(resolveTreeRowPointerAction("folder", "click")).toBe("toggle");
    expect(resolveTreeRowPointerAction("folder", "click", 1)).toBe("toggle");
  });

  it("ignores the second click of a double-click so the folder is not collapsed", () => {
    expect(resolveTreeRowPointerAction("folder", "click", 2)).toBeNull();
  });

  it("opens a folder on double-click while keeping it expanded", () => {
    expect(resolveTreeRowPointerAction("folder", "dblclick")).toBe("expand-and-open");
  });

  it("opens pages, files and databases on a single click", () => {
    expect(resolveTreeRowPointerAction("page", "click")).toBe("open");
    expect(resolveTreeRowPointerAction("file", "click")).toBe("open");
    expect(resolveTreeRowPointerAction("database", "click")).toBe("open");
  });

  it("ignores a double-click on a non-folder after the first click already opened", () => {
    expect(resolveTreeRowPointerAction("page", "dblclick")).toBeNull();
  });
});

describe("applyTreeRowPointerAction", () => {
  it("toggles, opens, or expands-and-opens without collapsing on open", () => {
    const toggle = vi.fn();
    const expand = vi.fn();
    const open = vi.fn();
    applyTreeRowPointerAction("toggle", { toggle, expand, open });
    expect(toggle).toHaveBeenCalledOnce();
    expect(expand).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    applyTreeRowPointerAction("open", { toggle, expand, open });
    expect(open).toHaveBeenCalledOnce();
    expect(expand).not.toHaveBeenCalled();

    applyTreeRowPointerAction("expand-and-open", { toggle, expand, open });
    expect(expand).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);

    applyTreeRowPointerAction(null, { toggle, expand, open });
    expect(toggle).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("createFolderClickScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a scheduled toggle only after the double-click window", () => {
    vi.useFakeTimers();
    const scheduler = createFolderClickScheduler();
    const toggle = vi.fn();
    scheduler.schedule(toggle);
    vi.advanceTimersByTime(FOLDER_SINGLE_CLICK_DELAY_MS - 1);
    expect(toggle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("cancels a pending toggle when a double-click arrives", () => {
    vi.useFakeTimers();
    const scheduler = createFolderClickScheduler();
    const toggle = vi.fn();
    scheduler.schedule(toggle);
    scheduler.cancel();
    vi.advanceTimersByTime(FOLDER_SINGLE_CLICK_DELAY_MS * 2);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("treats a second click inside the window as the double-click, not a native dblclick", () => {
    vi.useFakeTimers();
    const scheduler = createFolderClickScheduler();
    const toggle = vi.fn();
    const expand = vi.fn();
    const open = vi.fn();
    handleFolderRowPointerClick(scheduler, { toggle, expand, open });
    handleFolderRowPointerClick(scheduler, { toggle, expand, open });
    vi.advanceTimersByTime(FOLDER_SINGLE_CLICK_DELAY_MS * 2);
    expect(toggle).not.toHaveBeenCalled();
    expect(expand).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("collapses on a later click even if the engine would still fire dblclick", () => {
    vi.useFakeTimers();
    const scheduler = createFolderClickScheduler();
    const toggle = vi.fn();
    const expand = vi.fn();
    const open = vi.fn();
    handleFolderRowPointerClick(scheduler, { toggle, expand, open });
    vi.advanceTimersByTime(FOLDER_SINGLE_CLICK_DELAY_MS);
    expect(toggle).toHaveBeenCalledOnce();
    handleFolderRowPointerClick(scheduler, { toggle, expand, open });
    vi.advanceTimersByTime(FOLDER_SINGLE_CLICK_DELAY_MS);
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });
});
