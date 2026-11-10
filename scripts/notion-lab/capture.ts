import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  capturesDir,
  ensurePrivateDir,
  openNotionProfile,
  say,
  slug,
  timestamp,
  warn,
} from "./lib.ts";

/**
 * Captures one Notion page as evidence: screenshots, rendered DOM, computed
 * styles, running animations, console messages and network requests.
 *
 *   bun run notion:capture -- --url https://www.notion.so/... --theme dark
 *   bun run notion:capture -- --url ... --selector "table" --selector "[role=grid]"
 *   bun run notion:capture -- --url ... --headed --viewport-only
 *
 * The result is written under .notion-lab/captures/<slug>/ and is git-ignored.
 */
const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    theme: { type: "string" },
    selector: { type: "string", multiple: true },
    wait: { type: "string" },
    headed: { type: "boolean" },
    "viewport-only": { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (values.help || values.url === undefined) {
  say(
    [
      "Usage : bun run notion:capture -- --url <URL> [options]",
      "",
      "  --url <URL>            page Notion à capturer (obligatoire)",
      "  --out <dir>            dossier de sortie (défaut : .notion-lab/captures/…)",
      "  --width <px>           largeur (défaut 1440)",
      "  --height <px>          hauteur (défaut 1000)",
      "  --theme light|dark     préférence de thème (défaut light)",
      "  --selector <css>       élément à mesurer (répétable)",
      "  --wait <ms>            attente après chargement (défaut 2500)",
      "  --headed               afficher la fenêtre",
      "  --viewport-only        ne pas produire la capture pleine page",
      "",
      "Le profil de session vient de `bun run notion:login`.",
    ].join("\n"),
  );
  process.exit(values.url === undefined ? 1 : 0);
}

const url = values.url;
const width = Number(values.width ?? 1440);
const height = Number(values.height ?? 1000);
const theme = values.theme === "dark" ? "dark" : "light";
const waitMs = Number(values.wait ?? 2500);
const selectors = values.selector ?? ["body", "h1", "table", "[role=grid]"];
const outDir = values.out
  ? isAbsolute(values.out)
    ? values.out
    : resolve(process.cwd(), values.out)
  : join(capturesDir, `${slug(new URL(url).hostname + new URL(url).pathname)}-${timestamp()}`);

await ensurePrivateDir(outDir);

const context = await openNotionProfile({
  headless: values.headed !== true,
  width,
  height,
  theme,
});
const page = context.pages()[0] ?? (await context.newPage());

interface ConsoleEntry {
  readonly type: string;
  readonly text: string;
}
interface NetworkEntry {
  readonly phase: "request" | "response";
  readonly method?: string;
  readonly url: string;
  readonly status?: number;
  readonly resourceType?: string;
}
const consoleEntries: ConsoleEntry[] = [];
const network: NetworkEntry[] = [];

page.on("console", (message) => {
  if (consoleEntries.length < 500) {
    consoleEntries.push({ type: message.type(), text: message.text().slice(0, 2000) });
  }
});
page.on("pageerror", (error) => {
  consoleEntries.push({ type: "pageerror", text: String(error.message).slice(0, 2000) });
});
page.on("request", (request) => {
  if (network.length < 3000) {
    network.push({
      phase: "request",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
  }
});
page.on("response", (response) => {
  if (network.length < 3000) {
    network.push({ phase: "response", url: response.url(), status: response.status() });
  }
});

const startedAt = new Date().toISOString();
let status: number | null = null;
try {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  status = response?.status() ?? null;
} catch (error) {
  warn(`Chargement échoué : ${error instanceof Error ? error.message : String(error)}`);
}
await page.waitForTimeout(waitMs);

const manifest = {
  url,
  finalUrl: page.url(),
  title: await page.title().catch(() => ""),
  status,
  startedAt,
  finishedAt: new Date().toISOString(),
  viewport: { width, height },
  theme,
  selectors,
  userAgent: await page.evaluate(() => navigator.userAgent),
};

await mkdir(outDir, { recursive: true });
await page.screenshot({ path: join(outDir, "viewport.png") }).catch(() => undefined);
if (values["viewport-only"] !== true) {
  await page.screenshot({ path: join(outDir, "full.png"), fullPage: true }).catch(() => undefined);
}
await writeFile(join(outDir, "dom.html"), await page.content(), "utf8");
await writeFile(join(outDir, "console.json"), JSON.stringify(consoleEntries, null, 2), "utf8");
await writeFile(join(outDir, "network.json"), JSON.stringify(network, null, 2), "utf8");

const styleProperties = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "border-top-width",
  "border-top-color",
  "border-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "display",
  "align-items",
  "justify-content",
  "width",
  "height",
  "position",
  "box-shadow",
  "opacity",
  "transition-duration",
  "transition-timing-function",
];
const styles = await page.evaluate(
  ({ selectorList, properties }) => {
    const result: Array<Record<string, unknown>> = [];
    for (const selector of selectorList) {
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, 20);
      for (const element of elements) {
        const computed = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        result.push({
          selector,
          tag: element.tagName,
          text: (element.textContent ?? "").trim().slice(0, 160),
          rect: {
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          },
          styles: Object.fromEntries(
            properties.map((property) => [property, computed.getPropertyValue(property)]),
          ),
        });
      }
    }
    return result;
  },
  { selectorList: selectors, properties: styleProperties },
);
await writeFile(join(outDir, "styles.json"), JSON.stringify(styles, null, 2), "utf8");

const animations = await page.evaluate(() => {
  return document
    .getAnimations()
    .slice(0, 200)
    .map((animation, index) => {
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target ?? null;
      return {
        index,
        playState: animation.playState,
        currentTime: animation.currentTime,
        timing: effect?.getTiming() ?? null,
        keyframes: effect?.getKeyframes().slice(0, 20) ?? null,
        target: target
          ? {
              tag: target.tagName,
              id: target.id,
              className: String(target.className).slice(0, 160),
            }
          : null,
      };
    });
});
await writeFile(join(outDir, "animations.json"), JSON.stringify(animations, null, 2), "utf8");
await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

await context.close().catch(() => undefined);

say(
  [
    `Capture terminée : ${outDir}`,
    `  titre      : ${manifest.title}`,
    `  URL finale : ${manifest.finalUrl}`,
    `  styles     : ${styles.length} éléments mesurés`,
    `  animations : ${animations.length}`,
    `  réseau     : ${network.length} entrées`,
    `  console    : ${consoleEntries.length} messages`,
  ].join("\n"),
);
