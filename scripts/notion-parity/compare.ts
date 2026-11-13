#!/usr/bin/env bun
/**
 * Compare two parity captures and report structure, geometry and style gaps.
 *
 *   bun scripts/notion-parity/compare.ts \
 *     --reference .notion-lab/parity/notion-property-menu/capture.json \
 *     --candidate .notion-lab/parity/myownnotion-property-menu/capture.json \
 *     --out .notion-lab/parity/property-menu/comparison.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SvgMetrics {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox: string | null;
  readonly className: string | null;
}

interface TextMetrics {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: string;
  readonly fontFamily?: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly color: string;
}

interface ItemContent {
  readonly svgs: readonly SvgMetrics[];
  readonly text: readonly TextMetrics[];
  readonly disabled?: boolean;
  readonly expanded?: string | null;
  readonly hasPopup?: string | null;
}

/** One measured menu entry from `capture.json`. */
interface CaptureItem {
  readonly text: string;
  readonly box: Box;
  readonly gapBefore: number | null;
  readonly styles: Readonly<Record<string, string>>;
  readonly content?: ItemContent;
  readonly hover?: { readonly styles: Readonly<Record<string, string>> } | null;
}

interface Occlusion {
  readonly occluded: boolean;
}

/** One `capture.json` snapshot written by `capture.ts`. */
interface ParityCapture {
  readonly url: string;
  readonly container: { readonly styles: Readonly<Record<string, string>> };
  readonly items: readonly CaptureItem[];
  readonly occlusion?: Occlusion | null;
}

/** `--flag value` yields the value; `--flag` alone yields `true`. */
type CliValue = string | true;
type CliArgs = Record<string, CliValue>;

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

const args = parseArgs(process.argv);
const referenceArg = args["reference"];
const candidateArg = args["candidate"];
if (
  referenceArg === undefined ||
  referenceArg === true ||
  referenceArg === "" ||
  candidateArg === undefined ||
  candidateArg === true ||
  candidateArg === ""
) {
  console.error("Missing --reference or --candidate");
  process.exit(2);
}
const reference = JSON.parse(await readFile(resolve(referenceArg), "utf8")) as ParityCapture;
const candidate = JSON.parse(await readFile(resolve(candidateArg), "utf8")) as ParityCapture;
const labels = (capture: ParityCapture): string[] => capture.items.map((item) => item.text);
const refLabels = labels(reference);
const candidateLabels = labels(candidate);
const outOfScopeArg = args["out-of-scope"];
const declaredOutOfScope = new Set(
  String(outOfScopeArg ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean),
);
const outOfScope = refLabels.filter((label) => declaredOutOfScope.has(label));
const missing = refLabels.filter(
  (label) => !candidateLabels.includes(label) && !declaredOutOfScope.has(label),
);
const extra = candidateLabels.filter((label) => !refLabels.includes(label));

const styleKeys = [
  "width",
  "height",
  "borderRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
];
const styleTable = (key: string): string => {
  const ref = reference.container.styles[key];
  const current = candidate.container.styles[key];
  return `| ${key} | ${ref} | ${current} | ${ref === current ? "✅" : "⚠️"} |`;
};

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseColor(value: string | undefined): Rgba | null {
  if (typeof value !== "string") return null;
  const rgba = /^rgba?\(([^)]+)\)$/u.exec(value.trim());
  if (rgba !== null) {
    const body = rgba[1];
    if (body === undefined) return null;
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    return {
      r: Number(r) / 255,
      g: Number(g) / 255,
      b: Number(b) / 255,
      a: Number(parts[3] ?? "1"),
    };
  }
  const srgb = /^color\(srgb ([^)]+)\)$/u.exec(value.trim());
  if (srgb !== null) {
    const body = srgb[1];
    if (body === undefined) return null;
    const [channels = "", alpha = "1"] = body.split("/").map((part) => part.trim());
    const [r, g, b] = channels.split(/\s+/u).map(Number);
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b, a: Number(alpha) };
  }
  return null;
}

function sameColor(left: string | undefined, right: string | undefined, tolerance = 0.02): boolean {
  const a = parseColor(left);
  const b = parseColor(right);
  if (a === null || b === null) return left === right;
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance &&
    Math.abs(a.a - b.a) <= tolerance
  );
}

interface IconMetrics {
  readonly icons: number;
  readonly iconBox: string;
  readonly chevronRightGap: string;
}

const iconMetrics = (item: CaptureItem): IconMetrics => {
  const svgs = item.content?.svgs ?? [];
  const first = svgs[0];
  const last = svgs.at(-1);
  return {
    icons: svgs.length,
    iconBox: first === undefined ? "—" : `${first.width}×${first.height} @ ${first.x},${first.y}`,
    chevronRightGap:
      last === undefined || last === first
        ? "—"
        : String(Math.round((item.box.width - (last.x + last.width)) * 100) / 100),
  };
};
const textMetrics = (item: CaptureItem): TextMetrics | null => item.content?.text?.[0] ?? null;
const common = refLabels.flatMap((label) => {
  const ref = reference.items.find((item) => item.text === label);
  const current = candidate.items.find((item) => item.text === label);
  if (ref === undefined || current === undefined) return [];
  return [{ label, ref, current }];
});
const metricRows = common.map(({ label, ref, current }) => {
  const refIcon = iconMetrics(ref);
  const itemIcon = iconMetrics(current);
  const refText = textMetrics(ref);
  const itemText = textMetrics(current);
  const refHover: Readonly<Record<string, string>> = ref.hover?.styles ?? {};
  const itemHover: Readonly<Record<string, string>> = current.hover?.styles ?? {};
  const row = {
    label,
    height: `${ref.box.height} / ${current.box.height}`,
    width: `${ref.box.width} / ${current.box.width}`,
    gapBefore: `${ref.gapBefore ?? "—"} / ${current.gapBefore ?? "—"}`,
    icons: `${refIcon.icons} / ${itemIcon.icons}`,
    iconBox: `${refIcon.iconBox} / ${itemIcon.iconBox}`,
    chevronGap: `${refIcon.chevronRightGap} / ${itemIcon.chevronRightGap}`,
    textX: `${refText?.x ?? "—"} / ${itemText?.x ?? "—"}`,
    font: `${refText?.fontSize ?? "—"} / ${itemText?.fontSize ?? "—"}`,
    weight: `${refText?.fontWeight ?? "—"} / ${itemText?.fontWeight ?? "—"}`,
    lineHeight: `${refText?.lineHeight ?? "—"} / ${itemText?.lineHeight ?? "—"}`,
    fontFamily: `${refText?.fontFamily ?? "—"} / ${itemText?.fontFamily ?? "—"}`,
    hoverBackground: `${refHover["backgroundColor"] ?? "—"} / ${itemHover["backgroundColor"] ?? "—"}`,
    hoverColor: `${refHover["color"] ?? "—"} / ${itemHover["color"] ?? "—"}`,
  };
  const number = (value: string): number => Number.parseFloat(value.split(" / ")[0] ?? "");
  const numberRight = (value: string): number => Number.parseFloat(value.split(" / ")[1] ?? "");
  const finiteMetric = (value: unknown): boolean =>
    typeof value === "number" && Number.isFinite(value);
  const textIncomplete =
    refText === null ||
    itemText === null ||
    [refText, itemText].some(
      (text) =>
        typeof text.fontFamily !== "string" ||
        text.fontFamily === "" ||
        ![text.fontSize, text.fontWeight, text.lineHeight].every((value) =>
          Number.isFinite(Number.parseFloat(value)),
        ),
    );
  const svgMetricKeys = ["x", "y", "width", "height"] as const;
  const svgMismatch = (ref.content?.svgs ?? []).some((icon, index) => {
    const actual = current.content?.svgs?.[index];
    return (
      actual === undefined ||
      svgMetricKeys.some(
        (key) =>
          !finiteMetric(icon[key]) ||
          !finiteMetric(actual[key]) ||
          Math.abs(icon[key] - actual[key]) > 1,
      )
    );
  });
  const mismatches = [
    textIncomplete,
    svgMismatch,
    ![ref.box.height, current.box.height, ref.box.width, current.box.width].every(finiteMetric),
    refText !== null && itemText !== null && refText.fontWeight !== itemText.fontWeight,
    Math.abs(number(row.height) - numberRight(row.height)) > 1,
    Math.abs(number(row.width) - numberRight(row.width)) > 1,
    refIcon.icons !== itemIcon.icons,
    refText !== null && itemText !== null && Math.abs(refText.x - itemText.x) > 2,
    refText !== null &&
      itemText !== null &&
      Math.abs(Number.parseFloat(refText.fontSize) - Number.parseFloat(itemText.fontSize)) > 1,
    refText !== null &&
      itemText !== null &&
      Math.abs(Number.parseFloat(refText.lineHeight) - Number.parseFloat(itemText.lineHeight)) > 1,
    refText !== null &&
      itemText !== null &&
      (refText.fontFamily ?? "").split(",")[0] !== (itemText.fontFamily ?? "").split(",")[0],
    refIcon.chevronRightGap !== "—" &&
      itemIcon.chevronRightGap !== "—" &&
      Math.abs(Number(refIcon.chevronRightGap) - Number(itemIcon.chevronRightGap)) > 2,
    ref.gapBefore !== null &&
      current.gapBefore !== null &&
      Math.abs(ref.gapBefore - current.gapBefore) > 2,
    // Ink tokens differ by a few RGB points between the products; the hover
    // veil itself is the interaction effect the gate must protect.
    !sameColor(refHover["backgroundColor"], itemHover["backgroundColor"]),
  ].filter(Boolean).length;
  return { ...row, mismatches };
});
const geometryMismatches = metricRows.reduce((sum, row) => sum + row.mismatches, 0);
const outArg = args["out"];
const out = typeof outArg === "string" ? outArg : resolve(dirname(candidateArg), "comparison.md");
const lines = [
  "# Comparaison de parité",
  "",
  `- Référence : ${reference.url}`,
  `- Candidat : ${candidate.url}`,
  `- Verdict structure : ${missing.length === 0 && extra.length === 0 ? "✅ alignée" : "⚠️ incomplète"}`,
  `- Verdict géométrie : ${geometryMismatches === 0 ? "✅ alignée" : `⚠️ ${geometryMismatches} écarts sur ${metricRows.length} items communs`}`,
  "",
  "## Structure",
  "",
  `- Items référence : ${refLabels.length}`,
  `- Items candidat : ${candidateLabels.length}`,
  `- Hors périmètre déclaré : ${outOfScope.length === 0 ? "aucun" : outOfScope.map((label) => `« ${label} »`).join(", ")}`,
  `- Manquants (hors périmètre exclu) : ${missing.length === 0 ? "aucun" : missing.map((label) => `« ${label} »`).join(", ")}`,
  `- En trop : ${extra.length === 0 ? "aucun" : extra.map((label) => `« ${label} »`).join(", ")}`,
  "",
  "### Ordre",
  "",
  "| # | Référence | Candidat |",
  "| --- | --- | --- |",
  ...Array.from(
    { length: Math.max(refLabels.length, candidateLabels.length) },
    (_, index) =>
      `| ${index + 1} | ${refLabels[index] ?? "—"} | ${candidateLabels[index] ?? "—"} |`,
  ),
  "",
  "## Conteneur",
  "",
  "| Propriété | Référence | Candidat | Écart |",
  "| --- | --- | --- | --- |",
  ...styleKeys.map(styleTable),
  "",
  "## Items communs — géométrie",
  "",
  "| Item | Hauteur ref/ours | Largeur ref/ours | Gap avant | Icônes | Icône | Chevron droit | Texte x | Police | Poids | Interligne | Survol fond | Survol texte | Écarts |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...metricRows.map(
    (row) =>
      `| ${row.label.replace(/\|/g, "\\|")} | ${row.height} | ${row.width} | ${row.gapBefore} | ${row.icons} | ${row.iconBox} | ${row.chevronGap} | ${row.textX} | ${row.font} | ${row.weight} | ${row.lineHeight} | ${row.hoverBackground} | ${row.hoverColor} | ${row.mismatches === 0 ? "✅" : `${row.mismatches} ⚠️`} |`,
  ),
  "",
  "## Occlusion",
  "",
  `- Référence : ${reference.occlusion?.occluded ? "OUI" : "non"}`,
  `- Candidat : ${candidate.occlusion?.occluded ? "OUI" : "non"}`,
  "",
  "## Checklist de clôture",
  "",
  "- [ ] Tous les items sont présents ou explicitement hors périmètre.",
  "- [ ] Ordre et sections alignés.",
  "- [ ] Hauteurs, largeurs, paddings, gaps et polices dans la tolérance.",
  "- [ ] Icônes au même emplacement et chevrons au même retrait droit.",
  "- [ ] Survol, focus, actif, désactivé, destructif vérifiés.",
  "- [ ] Thème clair et sombre, 320/390 px.",
  "- [ ] Captures et tests joints à la validation.",
  "",
  "## Verdict",
  "",
  missing.length === 0 && extra.length === 0 && geometryMismatches === 0
    ? "Mesures contrôlées dans la tolérance. Ce résultat ne valide pas à lui seul la forme : revue visuelle en contexte obligatoire."
    : "Parité incomplète : traiter les items manquants et les écarts de géométrie ci-dessus.",
];
await mkdir(dirname(out), { recursive: true });
await writeFile(out, lines.join("\n"));
process.stdout.write(`Comparison written to ${out}\n`);
if (
  args["fail-on-gap"] === true &&
  (missing.length > 0 || extra.length > 0 || geometryMismatches > 0)
) {
  process.exitCode = 1;
}
