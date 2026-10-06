import { generateUuidV7 } from "@myownnotion/domain";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildCustomSlashMenuItems,
  createSubfolderFromSlash,
  createSubpageFromSlash,
  prepareLinkFromSlash,
  slashItemsWithHeading4,
} from "../src/features/editor/editor-menus/slash-menu.tsx";
import { FR_COPY } from "../src/ui/copy/fr.ts";

describe("the /page command", () => {
  it("uses the current block identity for an idempotent child and turns it into its link", async () => {
    const blockId = generateUuidV7();
    const editor = {
      getTextCursorPosition: () => ({
        block: { id: blockId, type: "paragraph", content: [{ type: "text", text: "/page" }] },
      }),
      updateBlock: vi.fn(),
    };
    const createSubpage = vi.fn(async () => ({ id: blockId, title: "Sans titre" }));
    const onCreated = vi.fn();

    await createSubpageFromSlash(editor, createSubpage, onCreated);

    expect(createSubpage).toHaveBeenCalledWith({ id: blockId, title: "Nouvelle page" });
    expect(editor.updateBlock).toHaveBeenCalledWith(blockId, {
      type: "paragraph",
      content: [
        {
          type: "pageLink",
          props: { targetItemId: blockId },
          content: [{ type: "text", text: "Sans titre", styles: {} }],
        },
      ],
    });
    expect(onCreated).toHaveBeenCalledWith({ id: blockId, title: "Sans titre" });
    expect(editor.updateBlock.mock.invocationCallOrder[0]).toBeLessThan(
      onCreated.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("leaves the current block untouched when the child could not be created", async () => {
    const blockId = generateUuidV7();
    const editor = {
      getTextCursorPosition: () => ({ block: { id: blockId, type: "paragraph", content: [] } }),
      updateBlock: vi.fn(),
    };

    await expect(
      createSubpageFromSlash(editor, async () => {
        throw new Error("création refusée");
      }),
    ).rejects.toThrow("création refusée");
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });
});

describe("the /dossier command", () => {
  it("creates a linked folder child from the current block identity", async () => {
    const blockId = generateUuidV7();
    const editor = {
      getTextCursorPosition: () => ({
        block: { id: blockId, type: "paragraph", content: [{ type: "text", text: "/dossier" }] },
      }),
      updateBlock: vi.fn(),
    };
    const createSubfolder = vi.fn(async () => ({ id: blockId, title: "Sans titre" }));
    const onCreated = vi.fn();

    await createSubfolderFromSlash(editor, createSubfolder, onCreated);

    expect(createSubfolder).toHaveBeenCalledWith({ id: blockId, title: "Nouveau dossier" });
    expect(editor.updateBlock).toHaveBeenCalledWith(blockId, {
      type: "paragraph",
      content: [
        {
          type: "pageLink",
          props: { targetItemId: blockId },
          content: [{ type: "text", text: "Sans titre", styles: {} }],
        },
      ],
    });
    expect(onCreated).toHaveBeenCalledWith({ id: blockId, title: "Sans titre" });
  });
});

describe("custom slash menu presentation", () => {
  it("gives every custom entry an icon and groups them logically", () => {
    const items = buildCustomSlashMenuItems({
      editor: {
        getTextCursorPosition: () => ({
          block: { id: generateUuidV7(), type: "paragraph", content: [] },
        }),
        updateBlock: vi.fn(),
        setTextCursorPosition: vi.fn(),
      },
      onCreatePageLink: () => undefined,
      onCreateWebBookmark: () => undefined,
      onCreateSubpage: async () => ({ id: generateUuidV7(), title: "Sans titre" }),
      onCreateSubfolder: async () => ({ id: generateUuidV7(), title: "Sans titre" }),
      onCreateFullPageDatabase: async () => ({ id: generateUuidV7(), title: "Base" }),
      onInsertInlineDatabase: () => undefined,
    });

    expect(items.every((item) => item.icon !== undefined)).toBe(true);
    expect(items.map((item) => item.title)).toEqual([
      FR_COPY.editor.slashMenu.page.title,
      FR_COPY.editor.slashMenu.folder.title,
      FR_COPY.editor.slashMenu.pageLink.title,
      FR_COPY.editor.slashMenu.webBookmark.title,
      FR_COPY.editor.slashMenu.fullPageDatabase.title,
      FR_COPY.editor.slashMenu.inlineDatabase.title,
      "Sommaire",
      "Équation",
      FR_COPY.editor.slashMenu.toggle.title,
      FR_COPY.editor.slashMenu.callout.title,
      FR_COPY.editor.slashMenu.table.title,
      FR_COPY.editor.slashMenu.embed.title,
    ]);
    expect(items.map((item) => item.group)).toEqual([
      FR_COPY.editor.slashMenu.organizationGroup,
      FR_COPY.editor.slashMenu.organizationGroup,
      FR_COPY.editor.slashMenu.linksGroup,
      FR_COPY.editor.slashMenu.linksGroup,
      FR_COPY.editor.slashMenu.databaseGroup,
      FR_COPY.editor.slashMenu.databaseGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
      FR_COPY.editor.slashMenu.advancedGroup,
    ]);
    expect(FR_COPY.editor.slashMenu.page.title).toBe("Page imbriquée");
    expect(FR_COPY.editor.slashMenu.folder.title).toBe("Dossier imbriqué");
    const iconMark = (icon: unknown): string | null => {
      if (!isValidElement(icon)) return null;
      const props = icon.props as { readonly name?: string; readonly kind?: string };
      return props.name ?? props.kind ?? null;
    };
    const marks = new Map(items.map((item) => [item.title, iconMark(item.icon)]));
    expect(marks.get(FR_COPY.editor.slashMenu.fullPageDatabase.title)).toBe("layersAdd");
    expect(marks.get(FR_COPY.editor.slashMenu.inlineDatabase.title)).toBe("layers");
    expect(marks.get(FR_COPY.editor.slashMenu.pageLink.title)).toBe("reference");
    expect(marks.get(FR_COPY.editor.slashMenu.table.title)).toBe("table");
  });
});

describe("/lien", () => {
  it("clears the slash query and reports the block used by either explicit link flow", () => {
    const calls: unknown[] = [];
    const editor = {
      getTextCursorPosition: () => ({
        block: { id: "block-id", type: "paragraph", content: [{ type: "text", text: "/lien" }] },
      }),
      updateBlock: (...args: unknown[]) => calls.push(["update", ...args]),
      setTextCursorPosition: (...args: unknown[]) => calls.push(["cursor", ...args]),
    };
    let openedFor: string | null = null;

    prepareLinkFromSlash(editor, (blockId) => {
      openedFor = blockId;
    });

    expect(calls).toEqual([
      ["update", "block-id", { type: "paragraph", content: [] }],
      ["cursor", "block-id", "start"],
    ]);
    expect(openedFor).toBe("block-id");
  });
});

describe("slash heading levels", () => {
  it("keeps Titre 4 in the same group as the other titles", () => {
    const item = (title: string, group: string) => ({
      title,
      group,
      onItemClick: () => undefined,
    });
    const heading4 = item("Titre 4", "Sous-titres");
    const items = slashItemsWithHeading4(
      [
        item("Paragraphe", "Blocs de base"),
        item("Titre 1", "Titres"),
        item("Titre 2", "Titres"),
        item("Titre 3", "Titres"),
        item("Citation", "Blocs de base"),
        heading4,
      ],
      heading4,
    );

    expect(items.map((entry) => entry.title)).toEqual([
      "Paragraphe",
      "Titre 1",
      "Titre 2",
      "Titre 3",
      "Titre 4",
      "Citation",
    ]);
    expect(items.find((entry) => entry.title === "Titre 4")?.group).toBe("Titres");
  });
});
