// @vitest-environment jsdom

import type { DatabaseEntryDto } from "@myownnotion/contracts";
import type { DatabaseDefinition, EntryValues } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EntryDrafts, EntryPanel } from "../src/features/databases/entry-panel.tsx";

function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function entryFixture() {
  const databaseId = generateUuidV7();
  const entryId = generateUuidV7();
  const titleId = generateUuidV7();
  const notesId = generateUuidV7();
  const ownerId = generateUuidV7();
  const definition: DatabaseDefinition = {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId,
    properties: [
      {
        id: titleId,
        name: "Title",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
      {
        id: notesId,
        name: "Notes",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: ownerId,
        name: "Owner",
        type: "text",
        positionKey: "c",
        state: "active",
        config: {},
      },
    ],
    views: [],
    taskRoles: null,
  };
  const entry: DatabaseEntryDto = {
    databaseId,
    entryId,
    revisionId: generateUuidV7(),
    lifecycle: "active",
    title: "Migration",
    document: null,
    values: {},
    relationTargets: {},
  };
  return { definition, entry, notesId, ownerId };
}

describe("entry panel interaction durability", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("submits the final property input when save follows it in the same interaction turn", async () => {
    const { definition, entry, notesId, ownerId } = entryFixture();
    const onSaveValues = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <EntryPanel
          entry={entry}
          definition={definition}
          onSaveValues={onSaveValues}
          onClose={vi.fn()}
        />,
      ),
    );

    const notes = container.querySelector<HTMLInputElement>(`#database-value-${notesId}`);
    const owner = container.querySelector<HTMLInputElement>(`#database-value-${ownerId}`);
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Enregistrer les propriétés",
    );
    expect(notes).not.toBeNull();
    expect(owner).not.toBeNull();
    expect(save).not.toBeUndefined();
    if (notes === null || owner === null || save === undefined) return;

    act(() => typeInto(notes, "common note"));
    await act(async () => {
      typeInto(owner, "common owner");
      save.click();
      await Promise.resolve();
    });

    expect(onSaveValues).toHaveBeenCalledOnce();
    expect(onSaveValues.mock.calls[0]?.[0] as EntryValues).toEqual({
      [notesId]: { kind: "text", value: "common note" },
      [ownerId]: { kind: "text", value: "common owner" },
    });
  });

  it("hydrates untouched fields without replacing an owner draft", () => {
    const { definition, entry, notesId, ownerId } = entryFixture();
    const onDraftsChange = vi.fn();
    const render = (currentEntry: DatabaseEntryDto) =>
      root.render(
        <EntryPanel
          entry={currentEntry}
          definition={definition}
          onDraftsChange={onDraftsChange}
          onSaveValues={vi.fn()}
          onClose={vi.fn()}
        />,
      );

    act(() => render(entry));
    const notes = container.querySelector<HTMLInputElement>(`#database-value-${notesId}`);
    if (notes === null) throw new Error("notes field missing");
    act(() => typeInto(notes, "owner draft"));

    act(() =>
      render({
        ...entry,
        revisionId: generateUuidV7(),
        values: {
          [notesId]: { kind: "text", value: "synchronized note" },
          [ownerId]: { kind: "text", value: "synchronized owner" },
        },
      }),
    );

    expect(container.querySelector<HTMLInputElement>(`#database-value-${notesId}`)?.value).toBe(
      "owner draft",
    );
    expect(container.querySelector<HTMLInputElement>(`#database-value-${ownerId}`)?.value).toBe(
      "synchronized owner",
    );
    expect(onDraftsChange).toHaveBeenLastCalledWith({ [notesId]: "owner draft" });

    act(() =>
      render({
        ...entry,
        entryId: generateUuidV7(),
        revisionId: generateUuidV7(),
        values: {
          [notesId]: { kind: "text", value: "next entry note" },
          [ownerId]: { kind: "text", value: "next entry owner" },
        },
      }),
    );
    expect(container.querySelector<HTMLInputElement>(`#database-value-${notesId}`)?.value).toBe(
      "next entry note",
    );
    expect(container.querySelector<HTMLInputElement>(`#database-value-${ownerId}`)?.value).toBe(
      "next entry owner",
    );
  });

  it("retains a property draft when projection churn remounts the entry surface", async () => {
    const { definition, entry, notesId, ownerId } = entryFixture();
    const onSaveValues = vi.fn().mockResolvedValue(undefined);

    function Harness({ surface }: { readonly surface: number }) {
      const [retainedDrafts, setRetainedDrafts] = useState<EntryDrafts>();
      return (
        <EntryPanel
          key={surface}
          entry={entry}
          definition={definition}
          {...(retainedDrafts === undefined ? {} : { initialDrafts: retainedDrafts })}
          onDraftsChange={setRetainedDrafts}
          onSaveValues={onSaveValues}
          onClose={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness surface={0} />));
    const notes = container.querySelector<HTMLInputElement>(`#database-value-${notesId}`);
    if (notes === null) throw new Error("notes field missing");
    act(() => typeInto(notes, "survives projection churn"));

    act(() => root.render(<Harness surface={1} />));
    const retainedNotes = container.querySelector<HTMLInputElement>(`#database-value-${notesId}`);
    const owner = container.querySelector<HTMLInputElement>(`#database-value-${ownerId}`);
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Enregistrer les propriétés",
    );
    expect(retainedNotes?.value).toBe("survives projection churn");
    if (owner === null || save === undefined) throw new Error("entry controls missing");

    await act(async () => {
      typeInto(owner, "still editable");
      save.click();
      await Promise.resolve();
    });

    expect(onSaveValues.mock.calls[0]?.[0] as EntryValues).toEqual({
      [notesId]: { kind: "text", value: "survives projection churn" },
      [ownerId]: { kind: "text", value: "still editable" },
    });
  });
});
