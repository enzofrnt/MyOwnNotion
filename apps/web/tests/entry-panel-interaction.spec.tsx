// @vitest-environment jsdom
import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseEntryPeek } from "../src/features/databases/database-entry-peek.tsx";
import { EntryPanel } from "../src/features/databases/entry-panel.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function fixture() {
  const id = generateUuidV7(),
    notes = generateUuidV7(),
    owner = generateUuidV7(),
    check = generateUuidV7(),
    number = generateUuidV7();
  const definition: DatabaseDefinition = {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: id,
    properties: [
      {
        id: generateUuidV7(),
        name: "Title",
        type: "title",
        state: "active",
        positionKey: "a",
        config: {},
      },
      { id: notes, name: "Notes", type: "text", state: "active", positionKey: "b", config: {} },
      { id: owner, name: "Owner", type: "text", state: "active", positionKey: "c", config: {} },
      {
        id: check,
        name: "Checked",
        type: "checkbox",
        state: "active",
        positionKey: "d",
        config: {},
      },
      { id: number, name: "Number", type: "number", state: "active", positionKey: "e", config: {} },
    ],
    views: [],
    taskRoles: null,
  };
  const entry: DatabaseEntryDto = {
    databaseId: id,
    entryId: generateUuidV7(),
    revisionId: generateUuidV7(),
    lifecycle: "active",
    title: "Migration",
    document: null,
    values: {},
    relationTargets: {},
  };
  return { definition, entry, notes, owner, check, number };
}
describe("entry autosave and native draft durability", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const wait = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  };
  const field = (id: string) => {
    const input = container.querySelector<HTMLInputElement>(`#database-value-${id}`);
    if (input === null) throw new Error("field missing");
    return input;
  };
  it("cancels a keyboard property drag before Escape dismisses the side peek", async () => {
    const f = fixture();
    const close = vi.fn();
    const source = vi.fn().mockResolvedValue({ definition: f.definition });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const service = {
      getItem: async () => ({
        id: f.entry.entryId,
        kind: "page",
        lifecycle: "active",
        name: f.entry.title,
        currentRevisionId: f.entry.revisionId,
        pageDocument: null,
      }),
      getDatabaseEntry: async () => ({
        sourceId: f.definition.databaseId,
        databaseId: f.definition.databaseId,
        availability: "present",
        values: { values: {} },
      }),
      getDatabase: source,
      getDatabaseEntryRelationTargets: async () => ({}),
      subscribeProjection: () => () => {},
    } as unknown as LocalContentService;
    await act(async () =>
      root.render(
        <DatabaseEntryPeek
          request={{ entryId: f.entry.entryId, trigger: null }}
          service={service}
          drafts={new Map()}
          relationOptions={[]}
          renderHeader={() => <h1>Migration</h1>}
          renderContent={() => <p>Body</p>}
          onClose={close}
          onFullPage={() => {}}
        />,
      ),
    );
    await wait();
    const handle = document.querySelector<HTMLButtonElement>('button[aria-label="Déplacer Notes"]');
    const row = handle?.closest(".entry-property-row");
    if (!handle || !row) throw new Error("Missing property drag handle");
    const key = (code: string) =>
      act(() =>
        handle.dispatchEvent(
          new KeyboardEvent("keydown", { code, key: code === "Space" ? " " : code, bubbles: true }),
        ),
      );
    act(() => handle.focus());
    key("Space");
    await wait();
    expect(row.getAttribute("data-dragging")).toBe("true");
    key("Escape");
    await wait();
    expect(row.getAttribute("data-dragging")).toBeNull();
    expect(close).not.toHaveBeenCalled();
    // Editing the definition would start a second source read. Cancellation
    // leaves the original projection untouched and issues no edit command.
    expect(source).toHaveBeenCalledOnce();
    key("Escape");
    await wait();
    expect(close).toHaveBeenCalledOnce();
  });
  it("coalesces typing and automatically saves the final input without a save button", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    expect(container.textContent).not.toContain("Enregistrer les propriétés");
    act(() => {
      typeInto(field(f.notes), "one");
      typeInto(field(f.notes), "last edit");
      typeInto(field(f.owner), "owner");
    });
    expect(save).not.toHaveBeenCalled();
    await wait();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toEqual({
      [f.notes]: { kind: "text", value: "last edit" },
      [f.owner]: { kind: "text", value: "owner" },
    });
    expect(save.mock.calls[0]?.[2].propertyIds).toEqual([f.notes, f.owner]);
  });
  it("flushes the final native input on blur before the debounce", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    await act(async () => {
      const input = field(f.notes);
      input.focus();
      typeInto(input, "final native draft");
      input.blur();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0][f.notes].value).toBe("final native draft");
  });
  it("serializes a second edit received during an unfinished write", async () => {
    const f = fixture();
    let release: () => void = () => {};
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    act(() => typeInto(field(f.notes), "first"));
    await wait();
    expect(save).toHaveBeenCalledOnce();
    act(() => typeInto(field(f.notes), "second"));
    await wait();
    expect(save).toHaveBeenCalledOnce();
    await act(async () => release());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0][f.notes].value).toBe("second");
    expect(save.mock.calls[1]?.[2].previousValues[f.notes].value).toBe("first");
  });
  it("keeps failed drafts and retries only on an explicit retry or new edit", async () => {
    const f = fixture(),
      save = vi
        .fn()
        .mockRejectedValueOnce(new Error("storage unavailable"))
        .mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    act(() => typeInto(field(f.notes), "retained"));
    await wait();
    expect(field(f.notes).value).toBe("retained");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await wait();
    expect(save).toHaveBeenCalledOnce();
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Réessayer")?.click();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("hydrates untouched fields while retaining edited fields and their base", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    const render = (entry = f.entry) =>
      root.render(
        <EntryPanel
          entry={entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      );
    act(() => render());
    act(() => typeInto(field(f.notes), "local"));
    act(() =>
      render({
        ...f.entry,
        values: {
          [f.notes]: { kind: "text", value: "remote" },
          [f.owner]: { kind: "text", value: "remote owner" },
        },
      }),
    );
    expect(field(f.notes).value).toBe("local");
    expect(field(f.owner).value).toBe("remote owner");
    await wait();
    expect(save.mock.calls[0]?.[0]).toEqual({ [f.notes]: { kind: "text", value: "local" } });
    expect(save.mock.calls[0]?.[2].previousValues[f.notes]).toBeUndefined();
  });
  it("preserves undelivered native input through a projection refresh", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    const render = () =>
      root.render(
        <EntryPanel
          entry={{ ...f.entry, revisionId: generateUuidV7() }}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      );
    act(() => render());
    const input = field(f.notes);
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "undelivered",
    );
    act(() => render());
    expect(input.value).toBe("undelivered");
    act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    await wait();
    expect(save.mock.calls[0]?.[0][f.notes].value).toBe("undelivered");
  });
  it("does not block a valid field behind an invalid number", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    act(() => {
      typeInto(field(f.number), "12,5");
      typeInto(field(f.notes), "valid");
    });
    await wait();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toEqual({ [f.notes]: { kind: "text", value: "valid" } });
    expect(field(f.number).value).toBe("12,5");
    expect(container.textContent).toContain("Utilisez un point");
  });
  it("saves discrete choices immediately and flushes pending text on unmount", async () => {
    const f = fixture(),
      save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    await act(async () => field(f.check).click());
    expect(save.mock.calls[0]?.[0][f.check]).toEqual({ kind: "checkbox", checked: true });
    act(() => typeInto(field(f.notes), "before leaving"));
    await act(async () => root.render(<p>Another page</p>));
    expect(save.mock.calls[1]?.[0][f.notes].value).toBe("before leaving");
  });
  it("distinguishes unavailable values from an empty entry and keeps its document", () => {
    const f = fixture(),
      save = vi.fn();
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          valuesAvailable={false}
          pageContent={<p>Document conservé</p>}
          onSaveValues={save}
          onClose={() => {}}
        />,
      ),
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Ces propriétés ne sont pas présentes");
    expect(container.textContent).toContain("Document conservé");
    expect(save).not.toHaveBeenCalled();
  });
  it("does not clear a reopened page's newer draft when the departed panel's write finishes", async () => {
    const f = fixture();
    let finishOld: (() => void) | undefined;
    let retained: Readonly<Record<string, string | boolean | readonly string[]>> = {};
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementation(() => new Promise<void>(() => undefined));
    const renderPanel = (key: string) =>
      root.render(
        <EntryPanel
          key={key}
          entry={f.entry}
          definition={f.definition}
          initialDrafts={retained}
          onDraftsChange={(drafts) => {
            retained = drafts;
          }}
          onSaveValues={save}
          onClose={() => {}}
        />,
      );
    act(() => renderPanel("original"));
    act(() => typeInto(field(f.notes), "old write"));
    await wait();
    act(() => renderPanel("reopened"));
    act(() => typeInto(field(f.notes), "new draft"));
    await act(async () => finishOld?.());
    expect(retained[f.notes]).toBe("new draft");
    expect(field(f.notes).value).toBe("new draft");
  });
  it("supports the canonical header once without introducing a second title", () => {
    const f = fixture();
    act(() =>
      root.render(
        <EntryPanel
          entry={f.entry}
          definition={f.definition}
          renderHeader={() => <h1>Migration</h1>}
          pageContent={<p>Body</p>}
          onSaveValues={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector('[aria-label="Contenu de la page"]')?.textContent).toBe("Body");
  });
});
