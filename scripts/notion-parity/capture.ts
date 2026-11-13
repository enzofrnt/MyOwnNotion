#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
/**
 * Capture a reference or candidate UI surface for the Notion parity workflow.
 *
 * Usage:
 *   bun scripts/notion-parity/capture.ts \
 *     --profile .notion-lab/profile \
 *     --url https://app.notion.com/p/... \
 *     --steps scripts/notion-parity/recipes/notion-block-menu.json \
 *     --selector "[role=menu]" \
 *     --item "[role=menuitem]" \
 *     --out .notion-lab/parity/notion-block-menu
 *
 * The output is a JSON snapshot plus a Markdown report with default and hover
 * styles for every item. No user data is written outside the given directory.
 */
import { chromium } from "@playwright/test";

/** The ARIA role union Playwright accepts, without duplicating its list here. */
type AriaRole = Parameters<Page["getByRole"]>[0];

/** `--flag value` yields the value; `--flag` alone yields `true`. */
type CliValue = string | true;
type CliArgs = Record<string, CliValue>;

/** One interaction step read from a `recipes/<name>.json` file. */
interface Step {
  readonly action?: string;
  readonly selector?: string;
  readonly role?: AriaRole;
  readonly name?: string;
  readonly exact?: boolean;
  readonly ms?: number;
  readonly x?: number;
  readonly y?: number;
  readonly button?: "left" | "right" | "middle";
  readonly minX?: number;
  readonly force?: boolean;
  readonly key?: string;
  readonly script?: string;
}

interface Viewport {
  readonly width: number;
  readonly height: number;
}

interface SnapshotBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Computed geometry and styles of one DOM element, measured in the page. */
interface Snapshot {
  readonly tag: string;
  readonly role: string | null;
  readonly ariaLabel: string | null;
  readonly text: string;
  readonly box: SnapshotBox;
  readonly styles: Record<string, string>;
}

interface CapturedSvg {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox: string | null;
  readonly className: string | null;
}

interface CapturedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: string;
  readonly fontFamily: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly color: string;
}

interface CapturedContent {
  readonly svgs: CapturedSvg[];
  readonly text: CapturedText[];
  readonly disabled: boolean;
  readonly expanded: string | null;
  readonly hasPopup: string | null;
}

interface CapturedItem extends Snapshot {
  readonly gapBefore: number | null;
  readonly content: CapturedContent;
  readonly hover: Snapshot | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === undefined || !key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) parsed[name] = true;
    else {
      parsed[name] = value;
      index += 1;
    }
  }
  return parsed;
}

function stringArg(value: CliValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function parseViewport(value: CliValue | undefined): Viewport {
  const fallback: Viewport = { width: 1440, height: 1000 };
  if (typeof value !== "string") return fallback;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const record = parsed as Record<string, unknown>;
  const width = record["width"];
  const height = record["height"];
  return {
    width: typeof width === "number" ? width : fallback.width,
    height: typeof height === "number" ? height : fallback.height,
  };
}

function requireNumber(step: Step, key: "x" | "y"): number {
  const value = step[key];
  if (typeof value !== "number") {
    throw new Error(`Step ${step.action ?? "?"} needs a numeric "${key}": ${JSON.stringify(step)}`);
  }
  return value;
}

function requireString(step: Step, key: "key" | "script" | "name"): string {
  const value = step[key];
  if (typeof value !== "string") {
    throw new Error(`Step ${step.action ?? "?"} needs a "${key}": ${JSON.stringify(step)}`);
  }
  return value;
}

function requireRole(step: Step): AriaRole {
  if (step.role === undefined) {
    throw new Error(`Step ${step.action ?? "?"} needs a role: ${JSON.stringify(step)}`);
  }
  return step.role;
}

const args = parseArgs(process.argv);
const urlArg = args["url"];
const outArg = args["out"];
if (
  urlArg === undefined ||
  urlArg === true ||
  urlArg === "" ||
  outArg === undefined ||
  outArg === true ||
  outArg === ""
) {
  console.error("Missing --url or --out");
  process.exit(2);
}
const url = urlArg;
const out = outArg;
const selector = stringArg(args["selector"], "[role=menu]");
const itemSelector = stringArg(args["item"], "[role=menuitem]");
const profile = stringArg(args["profile"], ".notion-lab/profile");
const stepsPath = args["steps"];

const stepsFile: unknown =
  typeof stepsPath === "string" ? JSON.parse(await readFile(stepsPath, "utf8")) : [];
const steps: readonly Step[] = Array.isArray(stepsFile)
  ? (stepsFile as readonly Step[])
  : ((stepsFile as { readonly steps?: readonly Step[] }).steps ?? []);
const viewport = parseViewport(args["viewport"]);

const context = await chromium.launchPersistentContext(resolve(profile), {
  headless: true,
  ignoreHTTPSErrors: true,
  serviceWorkers: "block",
  viewport,
  locale: profile.includes("notion") && !profile.includes("app") ? "fr-FR" : "fr-FR",
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(args["wait"] ?? 3000));

async function locatorFor(step: Step): Promise<Locator> {
  if (step.selector) return page.locator(step.selector).first();
  if (step.role && step.name) {
    return page
      .getByRole(step.role, {
        name: step.name,
        exact: step.exact ?? false,
      })
      .first();
  }
  throw new Error(`Step needs selector or role+name: ${JSON.stringify(step)}`);
}

for (const step of steps) {
  if (step.action === "wait") {
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "mouseMove") {
    await page.mouse.move(requireNumber(step, "x"), requireNumber(step, "y"));
    await page.waitForTimeout(step.ms ?? 300);
  } else if (step.action === "mouseClick") {
    await page.mouse.click(requireNumber(step, "x"), requireNumber(step, "y"), {
      button: step.button ?? "left",
    });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "clickVisibleRole") {
    const candidates = page.getByRole(requireRole(step), {
      name: requireString(step, "name"),
      exact: step.exact ?? false,
    });
    const index = await candidates.evaluateAll(
      (elements, minX) =>
        elements.findIndex((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.x >= minX;
        }),
      step.minX ?? 0,
    );
    if (index < 0) throw new Error(`No visible ${step.role} named ${step.name}`);
    await candidates.nth(index).click({ force: true });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "click") {
    const target = await locatorFor(step);
    await target.click({ force: step.force ?? true });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "hover") {
    const target = await locatorFor(step);
    await target.hover({ force: step.force ?? true });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "rightClick") {
    const target = await locatorFor(step);
    await target.click({ button: "right", force: true });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "press") {
    await page.keyboard.press(requireString(step, "key"));
    await page.waitForTimeout(step.ms ?? 300);
  } else if (step.action === "evaluate") {
    await page.evaluate(requireString(step, "script"));
    await page.waitForTimeout(step.ms ?? 300);
  } else {
    throw new Error(`Unknown step ${step.action}`);
  }
}

const snapshotStyle = (element: Element): Snapshot => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const keys = [
    "display",
    "alignItems",
    "gap",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "height",
    "width",
    "color",
    "backgroundColor",
    "borderColor",
    "borderWidth",
    "borderRadius",
    "boxShadow",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "opacity",
    "transition",
  ] as const;
  const styles: Record<string, string> = {};
  for (const key of keys) styles[key] = style[key];
  return {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role"),
    ariaLabel: element.getAttribute("aria-label"),
    text: (element.textContent ?? "").trim().replace(/\s+/g, " "),
    box: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
    styles,
  };
};

let surface: Locator;
if (selector === "auto") {
  const marked = await page.evaluate((itemsSelector) => {
    const visible = Array.from(document.querySelectorAll(itemsSelector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const ancestors = (element: Element): Element[] => {
      const chain: Element[] = [];
      let current: Element | null = element;
      while (current !== null) {
        chain.unshift(current);
        current = current.parentElement;
      }
      return chain;
    };
    const [first, ...rest] = visible;
    if (first === undefined) return false;
    let lca = ancestors(first);
    for (const element of rest) {
      const chain = ancestors(element);
      let index = 0;
      while (index < lca.length && index < chain.length && lca[index] === chain[index]) {
        index += 1;
      }
      lca = lca.slice(0, index);
    }
    const candidate = lca.at(-1);
    if (candidate === undefined) return false;
    candidate.setAttribute("data-notion-parity-surface", "");
    return true;
  }, itemSelector);
  if (!marked) {
    await mkdir(resolve(out), { recursive: true });
    await page.screenshot({ path: resolve(out, "surface-missing.png") });
    throw new Error(`No visible items matched ${itemSelector}. Screenshot saved.`);
  }
  surface = page.locator("[data-notion-parity-surface]").first();
} else {
  surface = page.locator(selector).first();
}
const surfaceCount = await surface.count();
if (surfaceCount === 0) {
  await mkdir(resolve(out), { recursive: true });
  await page.screenshot({ path: resolve(out, "surface-missing.png") });
  throw new Error(`No surface matched ${selector}. Screenshot saved for diagnosis.`);
}
const occlusion = await page.evaluate(
  (surfaceSelector) => {
    const element = document.querySelector(surfaceSelector);
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    const points: ReadonlyArray<readonly [number, number]> = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + 16, rect.top + 16],
      [rect.right - 16, rect.top + 16],
      [rect.left + 16, rect.bottom - 16],
      [rect.right - 16, rect.bottom - 16],
    ];
    const results = points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return {
        x: Math.round(x),
        y: Math.round(y),
        inside: hit !== null && (hit === element || element.contains(hit)),
        hit:
          hit === null
            ? null
            : `${hit.tagName.toLowerCase()}.${hit.className.toString().split(" ")[0] ?? ""}`,
      };
    });
    return {
      occluded: results.some((point) => !point.inside),
      points: results,
      zIndex: getComputedStyle(element).zIndex,
    };
  },
  selector === "auto" ? "[data-notion-parity-surface]" : selector,
);

const container = await surface.evaluate(snapshotStyle);
const containerHtml = await surface.evaluate((element) => element.outerHTML);
const items = page.locator(itemSelector);
const itemCount = await items.count();
const capturedItems: CapturedItem[] = [];
for (let index = 0; index < itemCount; index += 1) {
  const item = items.nth(index);
  if (!(await item.isVisible())) continue;
  const base = await item.evaluate(snapshotStyle);
  let hover: Snapshot | null = null;
  try {
    await item.hover({ force: true });
    await page.waitForTimeout(300);
    hover = await item.evaluate(snapshotStyle);
  } catch {
    hover = null;
  }
  const content = await item.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const relative = (value: number): number => Math.round(value * 100) / 100;
    const svgs = Array.from(element.querySelectorAll("svg")).map((svg) => {
      const box = svg.getBoundingClientRect();
      return {
        x: relative(box.x - rect.x),
        y: relative(box.y - rect.y),
        width: relative(box.width),
        height: relative(box.height),
        viewBox: svg.getAttribute("viewBox"),
        className: svg.getAttribute("class"),
      };
    });
    const text: CapturedText[] = [];
    for (const node of Array.from(element.querySelectorAll("*"))) {
      if (node.children.length !== 0 || (node.textContent ?? "").trim() === "") continue;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      text.push({
        text: (node.textContent ?? "").trim(),
        x: relative(box.x - rect.x),
        y: relative(box.y - rect.y),
        width: relative(box.width),
        height: relative(box.height),
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
      });
    }
    // Leaf elements do not cover a button whose label is a raw text node.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const content = (node.textContent ?? "").trim();
      const parent = node.parentElement;
      if (content === "" || parent === null) continue;
      if (parent.children.length > 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(parent);
      text.push({
        text: content,
        x: relative(box.x - rect.x),
        y: relative(box.y - rect.y),
        width: relative(box.width),
        height: relative(box.height),
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
      });
    }
    text.sort((left, right) => left.y - right.y || left.x - right.x);
    return {
      svgs,
      text,
      disabled:
        element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled"),
      expanded: element.getAttribute("aria-expanded"),
      hasPopup: element.getAttribute("aria-haspopup"),
    };
  });
  const previous = capturedItems.at(-1);
  const gapBefore =
    previous === undefined
      ? null
      : Math.round((base.box.y - (previous.box.y + previous.box.height)) * 100) / 100;
  capturedItems.push({ ...base, gapBefore, content, hover });
}
await page.mouse.move(0, 0);

const outDir = resolve(out);
await mkdir(outDir, { recursive: true });
const screenshotPath = resolve(outDir, "surface.png");
await page.screenshot({ path: screenshotPath });
const screenshotItemsPath = resolve(outDir, "items.png");
if (itemCount > 0) await page.screenshot({ path: screenshotItemsPath });
const clip = {
  x: Math.max(0, Math.floor(container.box.x - 8)),
  y: Math.max(0, Math.floor(container.box.y - 8)),
  width: Math.min(
    viewport.width - Math.max(0, Math.floor(container.box.x - 8)),
    Math.ceil(container.box.width + 16),
  ),
  height: Math.min(
    viewport.height - Math.max(0, Math.floor(container.box.y - 8)),
    Math.ceil(container.box.height + 16),
  ),
};
const surfaceClipPath = resolve(outDir, "surface-clip.png");
await page.screenshot({ path: surfaceClipPath, clip });

const result = {
  url,
  selector,
  itemSelector,
  capturedAt: new Date().toISOString(),
  viewport,
  steps,
  container,
  occlusion,
  items: capturedItems,
  containerHtml,
  screenshot: screenshotPath,
  surfaceClip: surfaceClipPath,
  clip,
};
await writeFile(resolve(outDir, "capture.json"), JSON.stringify(result, null, 2));

const lines = [
  `# Parité UI — ${selector}`,
  "",
  `- URL : ${url}`,
  `- Capture : ${result.capturedAt}`,
  `- Surface : ${container.box.width}×${container.box.height} px`,
  `- Découpe : ${surfaceClipPath}`,
  `- Items visibles : ${capturedItems.length}`,
  `- Occlusion : ${occlusion === null ? "inconnue" : occlusion.occluded ? "OUI (un autre élément recouvre le menu)" : "aucune"}`,
  "",
  "## Conteneur",
  "",
  "| Propriété | Valeur |",
  "| --- | --- |",
  ...Object.entries(container.styles).map(([key, value]) => `| ${key} | ${value} |`),
  "",
  ...(occlusion === null
    ? []
    : [
        "## Occlusion",
        "",
        `- z-index : ${occlusion.zIndex}`,
        ...occlusion.points.map(
          (point) =>
            `- (${point.x}, ${point.y}) : ${point.inside ? "menu" : `recouvert par ${point.hit}`}`,
        ),
        "",
      ]),
  "## Items",
  "",
  "| # | Texte | Rôle | Taille | Repos (fond / texte) | Survol (fond / texte) |",
  "| --- | --- | --- | --- | --- | --- |",
  ...capturedItems.map((item, index) => {
    const hoverStyles = item.hover?.styles;
    return `| ${index + 1} | ${item.text.replace(/\|/g, "\\|")} | ${item.role ?? ""} | ${item.box.width}×${item.box.height} | ${item.styles["backgroundColor"]} / ${item.styles["color"]} | ${hoverStyles?.["backgroundColor"] ?? "—"} / ${hoverStyles?.["color"] ?? "—"} |`;
  }),
  "",
  "## HTML du conteneur",
  "",
  "```html",
  containerHtml.replace(/<script[\s\S]*?<\/script>/g, "").slice(0, 20000),
  "```",
];
await writeFile(resolve(outDir, "report.md"), lines.join("\n"));
process.stdout.write(`Captured ${capturedItems.length} items into ${outDir}\n`);
await context.close();
