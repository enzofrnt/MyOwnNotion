import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyThemeToRoot,
  normalizeThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveTheme,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  ThemeProvider,
  type ThemeRoot,
  type ThemeStorage,
  useTheme,
} from "../src/ui/theme-provider.tsx";

function memoryStorage(initial: string | null = null): ThemeStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === THEME_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === THEME_STORAGE_KEY) {
        this.value = value;
      }
    },
  };
}

function ThemeProbe() {
  const theme = useTheme();
  return createElement("output", {
    "data-preference": theme.preference,
    "data-resolved": theme.resolvedTheme,
  });
}

describe("theme provider", () => {
  it("resolves explicit and system themes without overriding the explicit choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(normalizeThemePreference("sepia")).toBe("system");
  });

  it("persists all three preferences and tolerates unavailable storage", () => {
    const storage = memoryStorage();
    expect(persistThemePreference(storage, "dark")).toBe(true);
    expect(readThemePreference(storage)).toBe("dark");
    expect(persistThemePreference(storage, "system")).toBe(true);
    expect(readThemePreference(storage)).toBe("system");
    expect(readThemePreference(null)).toBe("system");

    const unavailable: ThemeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readThemePreference(unavailable)).toBe("system");
    expect(persistThemePreference(unavailable, "light")).toBe(false);
  });

  it("applies matching dataset and browser color scheme values", () => {
    const root: ThemeRoot = { dataset: {}, style: { colorScheme: "" } };
    expect(applyThemeToRoot(root, "system", true)).toBe("dark");
    expect(root.dataset).toEqual({ themePreference: "system", theme: "dark" });
    expect(root.style.colorScheme).toBe("dark");
  });

  it("provides a deterministic initial value during server rendering", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeProvider, { initialTheme: "dark" }, createElement(ThemeProbe)),
    );
    expect(markup).toContain('data-preference="dark"');
    expect(markup).toContain('data-resolved="dark"');
  });

  it("runs the stored theme bootstrap before loading the application", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const bootstrapStart = html.indexOf("<script data-theme-bootstrap>");
    const applicationStart = html.indexOf('<script type="module" src="/src/main.tsx">');
    expect(bootstrapStart).toBeGreaterThan(-1);
    expect(bootstrapStart).toBeLessThan(applicationStart);
    expect(html).toContain(`const key = "${THEME_STORAGE_KEY}"`);
    expect(html).toContain(`window.matchMedia?.("${THEME_MEDIA_QUERY}")`);

    const script = html.match(/<script data-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const root = { dataset: {}, style: { colorScheme: "" } };
    runInNewContext(script ?? "", {
      document: { documentElement: root },
      window: {
        localStorage: { getItem: () => "dark" },
        matchMedia: () => ({ matches: false }),
      },
    });
    expect(root).toEqual({
      dataset: { themePreference: "dark", theme: "dark" },
      style: { colorScheme: "dark" },
    });
  });
});
