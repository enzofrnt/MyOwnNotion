import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { validatePageDocument } from "@myownnotion/domain";
import { hash } from "bun";
import { afterEach, describe, expect, it } from "vitest";
import { safeYaml } from "../src/imports/notion/markdown.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import { normalizeSourcePath, readImportSource } from "../src/imports/notion/source.ts";

const roots: string[] = [];
async function fixture(files: Record<string, string | Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "notion-import-test-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
/** Minimal stored/deflated ZIP fixture; application parsing uses the reviewed library. */
function zip(
  entries: Array<{
    name: string;
    text: string;
    mode?: number;
    compress?: boolean;
    corrupt?: boolean;
  }>,
): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      plain = Buffer.from(entry.text),
      bytes = entry.compress ? deflateRawSync(plain) : plain;
    const crc = hash.crc32(plain) ^ (entry.corrupt ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.compress ? 8 : 0, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, bytes);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.compress ? 8 : 0, 10);
    header.writeUInt32LE(crc >>> 0, 16);
    header.writeUInt32LE(bytes.length, 20);
    header.writeUInt32LE(plain.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((entry.mode ?? 0o100600) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
describe("Notion source preview", () => {
  it("preserves converted notes, attachments, properties, member identities and available tables", async () => {
    const root = await fixture({
      "Projects.md": "---\n---\n# Projects\n![[Projects.base]]\n",
      "Projects.base":
        'filters:\n  and:\n    - note["base"] == link("Projects")\nviews:\n  - type: table\n    name: Source table\n    order: [Status, Title]\n',
      "Task.md":
        '---\nbase: "[[Projects]]"\nStatus: Done\nAssignee: [Alex]\nParent task: ["[[Parent]]"]\nDue date: 2026-09-05\n---\n# Task\n- [x] Completed\n\n**Bold** [[Parent|parent]]\n\n![[assets/picture.png]]\n\n[Missing](absent.md)\n',
      "Parent.md": "# Parent\nPlain text\n",
      "assets/picture.png": new Uint8Array([137, 80, 78, 71, 1]),
    });
    const snapshot = await readImportSource(root),
      plan = planNotionImport(snapshot);
    expect(plan.report.totals).toMatchObject({
      sourceFiles: 5,
      pages: 3,
      databases: 1,
      memberships: 1,
      attachments: 1,
      originals: 4,
    });
    expect(plan.databases[0]?.memberIds).toEqual([
      plan.pages.find((page) => page.title === "Task")?.id,
    ]);
    expect(plan.report.databases[0]?.presentation).toBe("exported-table");
    expect(plan.report.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Status", representation: "status" }),
        expect.objectContaining({ name: "Parent task", representation: "relation" }),
        expect.objectContaining({ name: "Assignee", representation: "text" }),
      ]),
    );
    expect(plan.report.links.some((link) => link.status === "missing")).toBe(true);
    expect(plan.report.issues.some((issue) => issue.blocking)).toBe(false);
    for (const page of plan.pages) expect(validatePageDocument(page.document).ok).toBe(true);
    expect(planNotionImport(await readImportSource(root)).fingerprint).toBe(plan.fingerprint);
    expect(await readFile(join(root, "Parent.md"), "utf8")).toBe("# Parent\nPlain text\n");
  });
  it("matches native CSV subpages and preserves multiline values and absent configurations", async () => {
    const root = await fixture({
      "source.zip": zip([
        {
          name: "Tasks.csv",
          text: 'Name,Status,Description\nTask,Done,"Line one\nLine two"\nMissing,Todo,Details\n',
        },
        { name: "Tasks/Task abcdef0123456789abcdef0123456789.md", text: "# Task\nBody\n" },
      ]),
    });
    const plan = planNotionImport(await readImportSource(join(root, "source.zip")));
    expect(plan.report.totals).toMatchObject({ sourceFiles: 2, databases: 1, memberships: 2 });
    expect(plan.pages.find((page) => page.title === "Task")?.properties["Description"]).toBe(
      "Line one\nLine two",
    );
    expect(plan.report.databases[0]).toMatchObject({
      presentation: "default-table",
      missing: expect.arrayContaining(["original-previews"]),
    });
    expect(
      plan.report.issues.some((issue) => issue.code === "import.csv-page-content-unavailable"),
    ).toBe(true);
  });
  it("preserves unsupported Markdown inertly and refuses executable links without loading them", async () => {
    const root = await fixture({
      "a.md":
        "# Page\n\n<script>alert(1)</script>\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[Unsafe](javascript:alert)\n[Remote](https://example.com/image.png)\n",
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(JSON.stringify(plan.pages[0]?.document)).toContain("<script>alert(1)</script>");
    expect(plan.report.links.map((link) => link.status)).toEqual(["unsafe", "external"]);
    expect(plan.report.issues.some((issue) => issue.code.includes("table-preserved"))).toBe(true);
  });
  it("refuses source symlinks, path escapes, normalization collisions and YAML aliases/tags", async () => {
    const root = await fixture({ "a.md": "text" });
    await symlink(join(root, "a.md"), join(root, "linked.md"));
    await expect(readImportSource(root)).rejects.toMatchObject({ code: "import.symlink-refused" });
    for (const path of ["../escape", "/absolute", "C:/drive", "a\\b", "a/../b", "a\u0000b"])
      expect(() => normalizeSourcePath(path)).toThrow();
    expect(() => safeYaml("a: &a [1]\nb: *a")).toThrow();
    expect(() => safeYaml("a: !execute echo")).toThrow();
    const duplicate = await fixture({
      "source.zip": zip([
        { name: "a.md", text: "A" },
        { name: "A.md", text: "B" },
      ]),
    });
    await expect(readImportSource(join(duplicate, "source.zip"))).rejects.toMatchObject({
      code: "import.duplicate-path",
    });
  });
  it("rejects archive traversal, symlink entries, corruption and expansion bombs", async () => {
    for (const entries of [
      [{ name: "../escape.md", text: "bad" }],
      [{ name: "link.md", text: "/outside", mode: 0o120777 }],
      [{ name: "broken.md", text: "incorrect crc", corrupt: true }],
      [{ name: "bomb.md", text: "a".repeat(100_000), compress: true }],
    ]) {
      const root = await fixture({ "source.zip": zip(entries) });
      await expect(readImportSource(join(root, "source.zip"))).rejects.toThrow();
    }
  });
  it("reports unsupported membership expressions as blocking and malformed CSV as invalid", async () => {
    const root = await fixture({
      "Data.base": 'filters: file.hasTag("anything")\nviews: []\n',
      "note.md": "# Note",
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "import.base-filter-unsupported", blocking: true }),
      ]),
    );
    const invalid = await fixture({ "Data.csv": 'Name,Status\n"unclosed\n' });
    expect(() =>
      planNotionImport({
        files: [
          { path: "Data.csv", bytes: Buffer.from('Name,Status\n"unclosed\n'), sha256: "test" },
        ],
        digest: "test",
        totalBytes: 25,
      }),
    ).toThrow("import.invalid-csv");
    expect(await readFile(join(invalid, "Data.csv"), "utf8")).toContain("unclosed");
  });
});
