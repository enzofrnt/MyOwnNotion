#!/usr/bin/env node
/**
 * Compare two parity captures and report structure, geometry and style gaps.
 *
 *   bun scripts/notion-parity/compare.mjs \
 *     --reference .notion-lab/parity/notion-property-menu/capture.json \
 *     --candidate .notion-lab/parity/myownnotion-property-menu/capture.json \
 *     --out .notion-lab/parity/property-menu/comparison.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const name = key.slice(2);
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) args[name] = true;
  else {
    args[name] = value;
    index += 1;
  }
}
if (!args.reference || !args.candidate) {
  console.error("Missing --reference or --candidate");
  process.exit(2);
}
const reference = JSON.parse(await readFile(resolve(args.reference), "utf8"));
const candidate = JSON.parse(await readFile(resolve(args.candidate), "utf8"));
const labels = (capture) => capture.items.map((item) => item.text);
const refLabels = labels(reference);
const candidateLabels = labels(candidate);
const declaredOutOfScope = new Set(
  String(args["out-of-scope"] ?? "")
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
const styleTable = (key) => {
  const ref = reference.container.styles[key];
  const current = candidate.container.styles[key];
  return `| ${key} | ${ref} | ${current} | ${ref === current ? "✅" : "⚠️"} |`;
};

function parseColor(value) {
  if (typeof value !== "string") return null;
  const rgba = /^rgba?\(([^)]+)\)$/u.exec(value.trim());
  if (rgba !== null) {
    const parts = rgba[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const [r, g, b, a = "1"] = parts;
    return {
      r: Number(r) / 255,
      g: Number(g) / 255,
      b: Number(b) / 255,
      a: Number(a),
    };
  }
  const srgb = /^color\(srgb ([^)]+)\)$/u.exec(value.trim());
  if (srgb !== null) {
    const [channels, alpha = "1"] = srgb[1].split("/").map((part) => part.trim());
    const [r, g, b] = channels.split(/\s+/u).map(Number);
    return { r, g, b, a: Number(alpha) };
  }
  return null;
}
function sameColor(left, right, tolerance = 0.02) {
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
const iconMetrics = (item) => {
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
const textMetrics = (item) => item.content?.text?.[0] ?? null;
const common = refLabels
  .map((label) => ({
    label,
    ref: reference.items.find((item) => item.text === label),
    candidate: candidate.items.find((item) => item.text === label),
  }))
  .filter(({ candidate: item }) => item !== undefined);
const metricRows = common.map(({ label, ref, candidate: item }) => {
  const refIcon = iconMetrics(ref);
  const itemIcon = iconMetrics(item);
  const refText = textMetrics(ref);
  const itemText = textMetrics(item);
  const refHover = ref.hover?.styles ?? {};
  const itemHover = item.hover?.styles ?? {};
  const row = {
    label,
    height: `${ref.box.height} / ${item.box.height}`,
    width: `${ref.box.width} / ${item.box.width}`,
    gapBefore: `${ref.gapBefore ?? "—"} / ${item.gapBefore ?? "—"}`,
    icons: `${refIcon.icons} / ${itemIcon.icons}`,
    iconBox: `${refIcon.iconBox} / ${itemIcon.iconBox}`,
    chevronGap: `${refIcon.chevronRightGap} / ${itemIcon.chevronRightGap}`,
    textX: `${refText?.x ?? "—"} / ${itemText?.x ?? "—"}`,
    font: `${refText?.fontSize ?? "—"} / ${itemText?.fontSize ?? "—"}`,
    weight: `${refText?.fontWeight ?? "—"} / ${itemText?.fontWeight ?? "—"}`,
    lineHeight: `${refText?.lineHeight ?? "—"} / ${itemText?.lineHeight ?? "—"}`,
    fontFamily: `${refText?.fontFamily ?? "—"} / ${itemText?.fontFamily ?? "—"}`,
    hoverBackground: `${refHover.backgroundColor ?? "—"} / ${itemHover.backgroundColor ?? "—"}`,
    hoverColor: `${refHover.color ?? "—"} / ${itemHover.color ?? "—"}`,
  };
  const number = (value) => Number.parseFloat(String(value).split(" / ")[0]);
  const numberRight = (value) => Number.parseFloat(String(value).split(" / ")[1]);
  const finiteMetric = (value) => typeof value === "number" && Number.isFinite(value);
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
  const svgMismatch = (ref.content?.svgs ?? []).some((icon, index) => {
    const actual = item.content?.svgs?.[index];
    return (
      actual === undefined ||
      ["x", "y", "width", "height"].some(
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
    ![ref.box.height, item.box.height, ref.box.width, item.box.width].every(finiteMetric),
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
      item.gapBefore !== null &&
      Math.abs(ref.gapBefore - item.gapBefore) > 2,
    // Ink tokens differ by a few RGB points between the products; the hover
    // veil itself is the interaction effect the gate must protect.
    !sameColor(refHover.backgroundColor, itemHover.backgroundColor),
  ].filter(Boolean).length;
  return { ...row, mismatches };
});
const geometryMismatches = metricRows.reduce((sum, row) => sum + row.mismatches, 0);
const out = args.out ?? resolve(dirname(args.candidate), "comparison.md");
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
