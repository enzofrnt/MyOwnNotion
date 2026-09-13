import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { validatePageDocument } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import { safeYaml } from "../src/imports/notion/markdown.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import {
  normalizeSourcePath,
  readImportSource,
  SOURCE_LIMITS,
} from "../src/imports/notion/source.ts";

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
    encrypted?: boolean;
    method?: number;
  }>,
): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      plain = Buffer.from(entry.text),
      bytes = entry.compress ? deflateRawSync(plain) : plain;
    const crc = crc32(plain) ^ (entry.corrupt ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    local.writeUInt16LE(entry.method ?? (entry.compress ? 8 : 0), 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, bytes);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.encrypted ? 1 : 0, 8);
    header.writeUInt16LE(entry.method ?? (entry.compress ? 8 : 0), 10);
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
it("bounds archive entry count even when entries are empty directories", async () => {
  const source = await fixture({
    "many.zip": zip(
      Array.from({ length: SOURCE_LIMITS.entries + 1 }, (_, index) => ({
        name: `${index}/`,
        text: "",
        mode: 0o040700,
      })),
    ),
  });
  await expect(readImportSource(join(source, "many.zip"))).rejects.toMatchObject({
    code: "import.too-many-entries",
  });
});
describe("Notion source preview", () => {
  it("blocks exact protected-storage placeholder names before apply", async () => {
    const root = await fixture({
      "Title.md": "# \uFFFD\n",
      "\uFFFD": new Uint8Array([1, 2, 3]),
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "import.invalid-name",
          sourcePath: "Title.md",
          blocking: true,
        }),
        expect.objectContaining({
          code: "import.invalid-name",
          sourcePath: "\uFFFD",
          blocking: true,
        }),
      ]),
    );
  });

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
    expect(() => safeYaml(`nested: ${"[".repeat(65)}0${"]".repeat(65)}`)).toThrow(
      "import.invalid-yaml",
    );
    expect(() =>
      safeYaml(
        `values:\n${Array.from({ length: 100_001 }, (_, index) => `  - ${index}`).join("\n")}`,
      ),
    ).toThrow("import.invalid-yaml");
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
  it("keeps distinct membership references separate and preserves each exported display order", async () => {
    const root = await fixture({
      "First.base":
        'filters: note.base == link("Shared")\nviews:\n  - type: table\n    name: First\n    order: [note.Owner, note.Status]\n',
      "Second.base":
        'filters: note.base == link("Shared")\nviews:\n  - type: table\n    name: Second\n    order: [note.Status, note.Owner]\n    limit: 20\n',
      "EmptyA.base": 'filters: note.base == link("Separate A")\nviews: []\n',
      "EmptyB.base": 'filters: note.base == link("Separate B")\nviews: []\n',
      "Entry.md": '---\nbase: "[[Shared]]"\nOwner: Person\nStatus: Done\n---\n# Entry',
      "Parent.md": "# Parent",
      "Parent/Child.md": "# Child",
      "Parent/picture.png": new Uint8Array([1, 2]),
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.databases).toHaveLength(3);
    const shared = plan.databases.find((source) => source.memberIds.length === 1);
    expect(shared?.definition.embeddings).toHaveLength(2);
    const names = shared?.definition.embeddings?.map((display) =>
      display.views[0]?.properties.map(
        (entry) =>
          shared.definition.properties.find((property) => property.id === entry.propertyId)?.name,
      ),
    );
    expect(names?.[0]?.slice(0, 2)).toEqual(["Owner", "Status"]);
    expect(names?.[1]?.slice(0, 2)).toEqual(["Status", "Owner"]);
    const parent = plan.pages.find((page) => page.path === "Parent.md");
    expect(plan.report.pages.find((page) => page.sourcePath === "Parent/Child.md")?.parentId).toBe(
      parent?.id,
    );
    expect(plan.report.files.find((file) => file.path === "Parent/picture.png")?.parentId).toBe(
      parent?.id,
    );
    expect(plan.report.databases).toHaveLength(4);
    expect(plan.report.databases.find((source) => source.members === 1)?.memberIds).toEqual(
      shared?.memberIds,
    );
    expect(
      plan.report.issues.some((issue) => issue.code === "import.base-settings-preserved-in-source"),
    ).toBe(true);
  });
  it("rejects oversized text before reading it and invalid encodings without a target", async () => {
    const root = await fixture({ "Huge.md": "", "invalid.md": new Uint8Array([255, 254, 255]) });
    await truncate(join(root, "Huge.md"), SOURCE_LIMITS.textBytes + 1);
    await expect(readImportSource(root)).rejects.toMatchObject({ code: "import.source-too-large" });
    await rm(join(root, "Huge.md"));
    expect(() =>
      planNotionImport({
        files: [{ path: "invalid.md", bytes: new Uint8Array([255]), sha256: "bad" }],
        totalBytes: 1,
        digest: "bad",
      }),
    ).toThrow("import.invalid-utf8");
  });
  it("refuses generated identity collisions and duplicate CSV bindings instead of merging pages", async () => {
    const root = await fixture({
      "Data.csv": "Name,Status\nEntry,Done\nEntry,Todo\n",
      "Entry.md": "# Entry",
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.issues).toContainEqual(
      expect.objectContaining({ code: "import.csv-row-ambiguous", blocking: true }),
    );
    const conflict = await fixture({
      "Data.base": 'filters: note.base == link("Data")\nviews: []',
      "Data.import-host.md": "# Existing source",
    });
    expect(() =>
      planNotionImport({
        files: [
          {
            path: "Data.base",
            bytes: Buffer.from('filters: note.base == link("Data")\nviews: []'),
            sha256: "a",
          },
          { path: "Data.import-host.md", bytes: Buffer.from("# Existing source"), sha256: "b" },
        ],
        totalBytes: 60,
        digest: "conflict",
      }),
    ).toThrow("import.duplicate-identity");
    expect(await readFile(join(conflict, "Data.import-host.md"), "utf8")).toContain(
      "Existing source",
    );
  });
  it("keeps wikilink examples literal inside code and preserves empty directories", async () => {
    const root = await fixture({
      "Code.md": "# Code\n\n```md\n[[Target]]\n![[Data.base]]\n```\n\n`[[Target]]`\n\n[[Target]]",
      "Target.md": "# Target",
      "Data.base": 'filters: note.base == link("Data")\nviews: []',
    });
    await mkdir(join(root, "Empty", "Nested"), { recursive: true });
    const plan = planNotionImport(await readImportSource(root));
    const code = plan.pages.find((page) => page.path === "Code.md");
    expect(JSON.stringify(code?.document)).toContain("[[Target]]");
    expect(plan.report.links.filter((link) => link.sourcePath === "Code.md")).toHaveLength(1);
    expect(plan.databases[0]?.hostPageId).not.toBe(code?.id);
    expect(plan.report.folders.some((folder) => folder.name === "Nested")).toBe(true);
    const before = plan.snapshot.digest;
    await mkdir(join(root, "New empty"));
    expect((await readImportSource(root)).digest).not.toBe(before);
  });
  it("preserves imprecise integers and invalid civil dates as text and reports cyclic memberships", async () => {
    const root = await fixture({
      "Data.base": 'filters: note.base == link("Data")\nviews: []',
      "Data.md": '---\nbase: "[[Data]]"\nHuge: 900719925474099312345\nDue: 2026-02-31\n---\n# Data',
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.pages[0]?.properties["Huge"]).toBe("900719925474099312345");
    expect(plan.report.properties).toContainEqual(
      expect.objectContaining({ name: "Due", representation: "text" }),
    );
    expect(plan.report.issues).toContainEqual(
      expect.objectContaining({ code: "import.cyclic-dependencies", blocking: true }),
    );
  });
  it("accounts for empty archives and directories and refuses incomplete or encrypted ZIP sources", async () => {
    const empty = await fixture({
      "empty.zip": zip([]),
      "bad.zip": "not a zip",
      "plain.md": "# Page",
    });
    expect(
      planNotionImport(await readImportSource(join(empty, "empty.zip"))).report.totals.sourceFiles,
    ).toBe(0);
    await expect(readImportSource(join(empty, "bad.zip"))).rejects.toMatchObject({
      code: "import.invalid-archive",
    });
    await expect(readImportSource(join(empty, "plain.md"))).rejects.toMatchObject({
      code: "import.unsupported-source",
    });
    const link = join(empty, "source-link");
    await symlink(empty, link);
    await expect(readImportSource(link)).rejects.toMatchObject({ code: "import.symlink-refused" });
    const directories = await fixture({
      "source.zip": zip([{ name: "empty/", text: "", mode: 0o040755 }]),
    });
    expect((await readImportSource(join(directories, "source.zip"))).directories).toEqual([
      "empty",
    ]);
    for (const entry of [
      { name: "encrypted.md", text: "secret", encrypted: true, compress: true },
      { name: "invalid/", text: "unexpected content", mode: 0o040755 },
      { name: "method.md", text: "unsupported", method: 99 },
    ]) {
      const root = await fixture({ "source.zip": zip([entry]) });
      await expect(readImportSource(join(root, "source.zip"))).rejects.toThrow(
        entry.encrypted ? "import.encrypted-archive-refused" : "import.invalid-archive",
      );
    }
    for (const path of ["", "a//b", ".", "a/./b", "a/".repeat(33), "bad\u007f"])
      expect(() => normalizeSourcePath(path)).toThrow();
  });
  it("retains frontmatter outside databases, reference links, inert inline HTML and unresolved embeds", async () => {
    const root = await fixture({
      "Standalone.md": `---
Owner: Someone
Nested: {target: "[[Peer]]"}
Infinity: .inf
---
# Standalone

#### Deep heading

Before **prefix [[Peer#heading|label]] suffix**.

[reference][peer]

[peer]: Peer.md

![image][picture]

[picture]: image.gif

[download](image.gif)

![missing](absent.png)

<span>inert</span> and a footnote[^note].

[^note]: Preserved definition

Line\x20\x20
break and **marked\x20\x20
break**.

- > quote first in list

\`\`\`
plain code
\`\`\`
`,
      "Peer.md": "# Peer",
      "image.gif": new Uint8Array([1, 2]),
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.properties).toContainEqual(
      expect.objectContaining({ name: "Nested", representation: "preserved-metadata" }),
    );
    expect(plan.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "import.heading-level-normalized" }),
        expect.objectContaining({ code: "import.link-anchor-preserved-in-source" }),
        expect.objectContaining({ code: "import.html-preserved-as-text" }),
      ]),
    );
    expect(plan.report.issues.some((issue) => issue.blocking)).toBe(false);
    expect(
      JSON.stringify(plan.pages.find((page) => page.path === "Standalone.md")?.document),
    ).toContain("Infinity");
    expect(() => safeYaml("---\na: [\n")).toThrow();
    for (const yaml of ["[value]", "string", "false"])
      expect(() =>
        planNotionImport({
          files: [{ path: "bad.md", bytes: Buffer.from(`---\n${yaml}\n---\nBody`), sha256: "bad" }],
          totalBytes: 30,
          digest: yaml,
        }),
      ).toThrow("import.invalid-frontmatter");
  });
  it("resolves exported Notion identifiers and reports unsafe, ambiguous and source-only configuration", async () => {
    const id = "abcdef0123456789abcdef0123456789";
    const root = await fixture({
      [`Target ${id}.md`]: "# Target",
      "a/Twin.md": "# First",
      "b/Twin.md": "# Second",
      "Mixed.md": `# ${"T".repeat(260)}\n[Notion](https://www.notion.so/Target-${id})\n[Mail](mailto:test@example.invalid)\n[Anchor](#section)\n[Escape](../outside)\n[Bad](%XX)\n[[Twin]]\n[[Unique]]\n`,
      "folder/Unique.md": "# Unique",
      "Data.base": `filters: note['base'] == link('Data')\nformulas: {calculated: '1 + 1'}\nviews:\n  - type: table\n    name: Table\n  - type: cards\n    name: Extra\n`,
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTarget: "../outside", status: "unsafe" }),
        expect.objectContaining({ sourceTarget: "%XX", status: "unsafe" }),
        expect.objectContaining({ sourceTarget: "Twin", status: "ambiguous" }),
        expect.objectContaining({ sourceTarget: "Unique", status: "resolved" }),
        expect.objectContaining({
          sourceTarget: `https://www.notion.so/Target-${id}`,
          status: "resolved",
        }),
      ]),
    );
    expect(plan.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "import.title-shortened" }),
        expect.objectContaining({ code: "import.additional-views-preserved-in-source" }),
        expect.objectContaining({ code: "import.base-formulas-preserved-in-source" }),
      ]),
    );
    for (const csv of ["", "Name,Name\nA,B\n", "Name,\nA,B\n"])
      expect(() =>
        planNotionImport({
          files: [{ path: "bad.csv", bytes: Buffer.from(csv), sha256: "bad" }],
          totalBytes: csv.length,
          digest: csv,
        }),
      ).toThrow("import.invalid-csv");
    expect(() =>
      planNotionImport({
        files: [{ path: "bad.base", bytes: Buffer.from("[]"), sha256: "bad" }],
        totalBytes: 2,
        digest: "bad",
      }),
    ).toThrow("import.invalid-base");
  });
  it("reports ambiguous native rows and invalid canonical definitions before application", async () => {
    const root = await fixture({
      "Data.csv": "Name,Status\nTwin,Done\n",
      "a/Twin.md": "# Twin",
      "b/Twin.md": "# Twin",
      "Invalid.csv": `Name,${"p".repeat(513)}\nRow,Value\n`,
      "Page.md": "# Page\n![table](Empty.base)\n![[missing.bin]]\n[bad](https://)\n",
      "Empty.base": 'filters: note.base == link("Empty")\n',
      "Unknown.bin": new Uint8Array([1, 2]),
      " .md": " ",
    });
    const plan = planNotionImport(await readImportSource(root));
    expect(plan.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "import.csv-row-ambiguous", blocking: true }),
        expect.objectContaining({ code: "import.invalid-definition", blocking: true }),
        expect.objectContaining({ code: "import.invalid-document", blocking: true }),
      ]),
    );
    expect(plan.files.find((file) => file.path === "Unknown.bin")?.mediaType).toBe(
      "application/octet-stream",
    );
    expect(plan.pages.find((page) => page.path === " .md")?.title).toBe("Sans titre");
    expect(plan.databases.find((source) => source.path === "Empty.base")?.hostPageId).toBe(
      plan.pages.find((page) => page.path === "Page.md")?.id,
    );
    for (const filters of ["[]", "{or: []}", "{and: [false]}"]) {
      const snapshot = await fixture({ "Bad.base": `filters: ${filters}\n` });
      expect(planNotionImport(await readImportSource(snapshot)).report.issues).toContainEqual(
        expect.objectContaining({ code: "import.base-filter-unsupported", blocking: true }),
      );
    }
  });
});

it("binds native CSV rows to their own exported subpages before unrelated same-title notes", async () => {
  const root = await fixture({
    "Tasks.csv": "Name,Status\nTask,Done\n",
    "Task.md": "# Task\nUnrelated root note\n",
    "Tasks/Task abcdef0123456789abcdef0123456789.md": "# Task\nReal entry\n",
    "Other.csv": "Name,Status\nTask,Todo\n",
    "Other/Task fedcba9876543210fedcba9876543210.md": "# Task\nOther entry\n",
  });
  const plan = planNotionImport(await readImportSource(root));
  expect(plan.report.issues.filter((issue) => issue.blocking)).toEqual([]);
  const page = (path: string) => plan.pages.find((page) => page.path === path);
  const task = page("Tasks/Task abcdef0123456789abcdef0123456789.md");
  const other = page("Other/Task fedcba9876543210fedcba9876543210.md");
  expect(plan.databases.find((database) => database.path === "Tasks.csv")?.memberIds).toEqual([
    task?.id,
  ]);
  expect(plan.databases.find((database) => database.path === "Other.csv")?.memberIds).toEqual([
    other?.id,
  ]);
  expect(task?.properties["Status"]).toBe("Done");
  expect(other?.properties["Status"]).toBe("Todo");
  expect(page("Task.md")?.databaseId).toBeUndefined();
  expect(page("Task.md")?.properties).toEqual({});
});

it("blocks ambiguous subpages even when a unique unrelated root title would resolve", async () => {
  const root = await fixture({
    "Tasks.csv": "Name,Status\nTask,Done\n",
    "Task.md": "# Task\nUnrelated\n",
    "Tasks/One.md": "# Task\nFirst\n",
    "Tasks/Two.md": "# Task\nSecond\n",
  });
  const plan = planNotionImport(await readImportSource(root));
  expect(plan.report.issues).toContainEqual(
    expect.objectContaining({ code: "import.csv-row-ambiguous", blocking: true }),
  );
  expect(plan.pages.find((page) => page.path === "Task.md")?.databaseId).toBeUndefined();
});

it("retains explicit native row paths when no local title matches", async () => {
  const root = await fixture({
    "Tasks.csv": "Name,Status\nElsewhere/Actual.md,Done\n",
    "Elsewhere/Actual.md": "# Actual\nExplicitly referenced entry\n",
  });
  const plan = planNotionImport(await readImportSource(root));
  expect(plan.report.issues.filter((issue) => issue.blocking)).toEqual([]);
  expect(plan.databases[0]?.memberIds).toEqual([
    plan.pages.find((page) => page.path === "Elsewhere/Actual.md")?.id,
  ]);
});
