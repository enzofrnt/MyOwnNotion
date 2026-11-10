import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const owner = "features/databases/column-property-menu.css";

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("column menu CSS ownership", () => {
  it("loads its single owner after the shared database stylesheet", () => {
    const global = readFileSync(join(sourceRoot, "global.css"), "utf8");
    expect(global.indexOf('"./features/databases/database.css"')).toBeGreaterThan(-1);
    expect(global.indexOf('"./features/databases/column-property-menu.css"')).toBeGreaterThan(
      global.indexOf('"./features/databases/database.css"'),
    );
  });

  it("does not let another stylesheet style the menu later", () => {
    const offenders = cssFiles(sourceRoot)
      .filter((file) => !file.endsWith(owner))
      .filter((file) => {
        const css = readFileSync(file, "utf8");
        return css.includes(".database-column-editor") || css.includes(".database-column-menu__");
      });
    expect(offenders).toEqual([]);
  });

  it("hides an empty action group so no separator is left behind", () => {
    const css = readFileSync(join(sourceRoot, owner), "utf8");
    expect(css).toMatch(/\.database-column-menu__section:empty\s*\{\s*display:\s*none;/);
  });

  it("owns the parent menu, flyout and portaled configuration variants", () => {
    const css = readFileSync(join(sourceRoot, owner), "utf8");
    for (const selector of [
      ".ui-popover.database-column-editor",
      ".database-column-editor__flyout",
      ".ui-popover.property-settings--column-menu",
      ".ui-menu.property-settings__menu--column-menu",
    ]) {
      expect(css).toContain(selector);
    }
  });
});
