/**
 * A reviewed migration owns its own version record.
 *
 * The runner applies each file and then consults `schema_migrations` to decide
 * what is pending; it never inserts the version itself. A file that forgets its
 * `INSERT` therefore moves the schema while the registry stays behind, so the
 * update guard refuses every later start ("reviewed migrations remain
 * unapplied") and a fresh installation cannot be created. That happened to
 * `0021_database_entry_numbers` before this check existed, which is why the
 * assertion is static: it needs no database and cannot be hidden by a test that
 * only asserts the columns a migration created.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(import.meta.dirname, "..", "migrations");

describe("reviewed migration registry", () => {
  it("records its own version inside its transaction", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const records = new RegExp(
        `INSERT\\s+INTO\\s+schema_migrations\\s*\\(\\s*version\\s*\\)\\s*VALUES\\s*\\(\\s*'${version}'\\s*\\)`,
        "iu",
      ).test(sql);
      if (!records) missing.push(version);
    }

    expect(missing).toEqual([]);
  });

  it("keeps one file per version, numbered without gaps", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const numbers = files.map((file) => Number.parseInt(file.slice(0, 4), 10));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
  });
});
