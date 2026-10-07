import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { expect, it } from "vitest";
import { withEntryPresentation } from "../src/features/databases/database-page.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

it("restores hidden canonical fields for expanded editing without substituting an older revision", () => {
  const entryId = generateUuidV7();
  const revisionId = generateUuidV7();
  const hidden = generateUuidV7();
  const relation = generateUuidV7();
  const target = generateUuidV7();
  const entry = {
    entryId,
    revisionId,
    kind: "page",
    icon: null,
    document: null,
    values: { [hidden]: { kind: "instant", instant: "2026-10-08T07:00:00.000Z" } },
    relationTargets: { [relation]: [target] },
  } as unknown as DatabaseEntryDto;
  const page = {
    rows: [
      { entryId, revisionId, title: "Draft", values: {}, relationTargets: {}, syncState: "synced" },
    ],
  } as unknown as DatabaseViewPage;
  const enriched = withEntryPresentation(page, [entry]);
  expect(enriched.rows[0]?.values).toEqual(entry.values);
  expect(enriched.rows[0]?.relationTargets).toEqual(entry.relationTargets);
  const row = page.rows[0];
  if (row === undefined) throw new Error("Missing row");
  expect(
    withEntryPresentation({ ...page, rows: [{ ...row, revisionId: generateUuidV7() }] }, [entry])
      .rows[0]?.values,
  ).toEqual({});
});
