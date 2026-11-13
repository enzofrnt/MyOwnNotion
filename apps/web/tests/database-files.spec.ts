import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";
import { validateValueDraft } from "../src/features/databases/value-editor.tsx";

const property: DatabaseProperty = {
  id: "018f4000-0000-7000-8000-0000000000f1" as Uuid,
  name: "Pièces jointes",
  type: "files",
  positionKey: "z",
  state: "active",
  config: {},
};
const fileId = "018f4000-0000-7000-8000-0000000000f2" as Uuid;

describe("files property", () => {
  it("counts linked files in the grid", () => {
    const row = {
      entryId: "018f4000-0000-7000-8000-0000000000f3" as Uuid,
      revisionId: "018f4000-0000-7000-8000-0000000000f4" as Uuid,
      title: "Ligne",
      values: { [property.id]: { kind: "files", fileIds: [fileId] } },
      relationTargets: {},
      groupId: null,
    } as DatabaseQueryPageDto["rows"][number];
    expect(displayDatabaseValue(row, property)).toBe("1 fichier");
    expect(displayDatabaseValue({ ...row, values: {} } as typeof row, property)).toBe("—");
  });

  it("accepts canonical file identities and external links as a draft", () => {
    expect(validateValueDraft(property, [fileId])).toMatchObject({
      ok: true,
      value: { kind: "files", fileIds: [fileId] },
    });
    expect(validateValueDraft(property, [fileId, "https://exemple.fr/fichier.pdf"])).toMatchObject({
      ok: true,
      value: {
        kind: "files",
        fileIds: [fileId],
        externalUrls: ["https://exemple.fr/fichier.pdf"],
      },
    });
    expect(validateValueDraft(property, ["not-a-uuid"])).toMatchObject({ ok: false });
    expect(validateValueDraft(property, ["not a url"])).toMatchObject({ ok: false });
  });

  it("counts external links in the grid", () => {
    const row = {
      entryId: "018f4000-0000-7000-8000-0000000000f3" as Uuid,
      revisionId: "018f4000-0000-7000-8000-0000000000f4" as Uuid,
      title: "Ligne",
      values: {
        [property.id]: {
          kind: "files",
          fileIds: [],
          externalUrls: ["https://exemple.fr/fichier.pdf"],
        },
      },
      relationTargets: {},
      groupId: null,
    } as DatabaseQueryPageDto["rows"][number];
    expect(displayDatabaseValue(row, property)).toBe("1 fichier");
  });
});
