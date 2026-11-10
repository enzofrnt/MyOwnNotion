#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
/**
 * Capture a reference or candidate UI surface for the Notion parity workflow.
 *
 * Usage:
 *   bun scripts/notion-parity/capture.mjs \
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

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = value;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const url = args.url;
const selector = args.selector ?? "[role=menu]";
const itemSelector = args.item ?? "[role=menuitem]";
const out = args.out;
const profile = args.profile ?? ".notion-lab/profile";
const stepsPath = args.steps;
if (!url || !out) {
  console.error("Missing --url or --out");
  process.exit(2);
}

const stepsFile = stepsPath ? JSON.parse(await readFile(stepsPath, "utf8")) : [];
const steps = Array.isArray(stepsFile) ? stepsFile : (stepsFile.steps ?? []);
const viewport = args.viewport ? JSON.parse(args.viewport) : { width: 1440, height: 1000 };

const context = await chromium.launchPersistentContext(resolve(profile), {
  headless: true,
  ignoreHTTPSErrors: true,
  serviceWorkers: "block",
  viewport,
  locale: profile.includes("notion") && !profile.includes("app") ? "fr-FR" : "fr-FR",
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(args.wait ?? 3000));

async function locatorFor(step) {
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
    await page.mouse.move(step.x, step.y);
    await page.waitForTimeout(step.ms ?? 300);
  } else if (step.action === "mouseClick") {
    await page.mouse.click(step.x, step.y, { button: step.button ?? "left" });
    await page.waitForTimeout(step.ms ?? 500);
  } else if (step.action === "clickVisibleRole") {
    const candidates = page.getByRole(step.role, {
      name: step.name,
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
    await page.keyboard.press(step.key);
    await page.waitForTimeout(step.ms ?? 300);
  } else if (step.action === "evaluate") {
    await page.evaluate(step.script);
    await page.waitForTimeout(step.ms ?? 300);
  } else {
    throw new Error(`Unknown step ${step.action}`);
  }
}

const snapshotStyle = (element) => {
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
  ];
  const styles = {};
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

let surface;
if (selector === "auto") {
  const marked = await page.evaluate((itemsSelector) => {
    const visible = [...document.querySelectorAll(itemsSelector)].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (visible.length === 0) return false;
    const ancestors = (element) => {
      const chain = [];
      let current = element;
      while (current !== null) {
        chain.unshift(current);
        current = current.parentElement;
      }
      return chain;
    };
    let lca = ancestors(visible[0]);
    for (const element of visible.slice(1)) {
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
    const points = [
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
            : `${hit.tagName.toLowerCase()}.${hit.className.toString().split(" ")[0]}`,
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
const capturedItems = [];
for (let index = 0; index < itemCount; index += 1) {
  const item = items.nth(index);
  if (!(await item.isVisible())) continue;
  const base = await item.evaluate(snapshotStyle);
  let hover = null;
  try {
    await item.hover({ force: true });
    await page.waitForTimeout(300);
    hover = await item.evaluate(snapshotStyle);
  } catch {
    hover = null;
  }
  const content = await item.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const relative = (value) => Math.round(value * 100) / 100;
    const svgs = [...element.querySelectorAll("svg")].map((svg) => {
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
    const text = [];
    for (const node of element.querySelectorAll("*")) {
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
      if (content === "" || node.parentElement === null) continue;
      if (node.parentElement.children.length > 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(node.parentElement);
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
    const hover = item.hover?.styles;
    return `| ${index + 1} | ${item.text.replace(/\|/g, "\\|")} | ${item.role ?? ""} | ${item.box.width}×${item.box.height} | ${item.styles.backgroundColor} / ${item.styles.color} | ${hover?.backgroundColor ?? "—"} / ${hover?.color ?? "—"} |`;
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
