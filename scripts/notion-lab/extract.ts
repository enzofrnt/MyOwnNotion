import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { say, warn } from "./lib.ts";

/**
 * Reads the Notion desktop bundle (Electron ASAR) without launching Notion.
 *
 *   bun run notion:extract -- --list
 *   bun run notion:extract -- --grep "keydown" --ext .js
 *   bun run notion:extract -- --out .notion-lab/notion-asar
 *
 * The renderer ships the web app separately; this archive is the Electron
 * shell and the bridge code, not the editor implementation itself.
 */
const { values } = parseArgs({
  options: {
    asar: { type: "string" },
    list: { type: "boolean" },
    grep: { type: "string" },
    ext: { type: "string" },
    out: { type: "string" },
    limit: { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  say(
    [
      "Usage : bun run notion:extract -- [options]",
      "",
      "  --asar <path>   archive (défaut : Notion.app/Contents/Resources/app.asar)",
      "  --list          lister les fichiers texte les plus gros",
      "  --grep <text>   chercher une chaîne dans les fichiers texte",
      "  --ext <.js>     filtrer l'extension pour --grep",
      "  --out <dir>     extraire tous les fichiers",
      "  --limit <n>     nombre de résultats (défaut 50)",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const asarPath = values.asar ?? "/Applications/Notion.app/Contents/Resources/app.asar";
const limit = Number(values.limit ?? 50);
const buffer = await readFile(asarPath).catch(() => {
  warn(`Archive introuvable : ${asarPath}`);
  process.exit(1);
});

if (buffer.length < 16) {
  warn("Archive ASAR invalide.");
  process.exit(1);
}

const headerSize = buffer.readUInt32LE(12);
const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString("utf8")) as {
  files?: Record<string, AsarNode>;
};
const dataStart = 16 + headerSize;

interface AsarNode {
  readonly files?: Record<string, AsarNode>;
  readonly size?: number;
  readonly offset?: string;
  readonly unpacked?: boolean;
}
interface AsarFile {
  readonly path: string;
  readonly size: number;
  readonly offset: number;
  readonly unpacked: boolean;
}

function flatten(node: AsarNode, prefix: string, result: AsarFile[]): void {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (child.files !== undefined) {
      flatten(child, path, result);
    } else {
      result.push({
        path,
        size: child.size ?? 0,
        offset: Number(child.offset ?? 0),
        unpacked: child.unpacked === true,
      });
    }
  }
}

const files: AsarFile[] = [];
flatten(header, "", files);
const textExtensions = [
  ".js",
  ".json",
  ".css",
  ".html",
  ".mjs",
  ".cjs",
  ".map",
  ".yml",
  ".yaml",
  ".txt",
];

function readText(file: AsarFile): string | null {
  if (file.unpacked) return null;
  const start = dataStart + file.offset;
  return buffer.subarray(start, start + file.size).toString("utf8");
}

if (values.list || (values.grep === undefined && values.out === undefined)) {
  const largest = files
    .filter((file) => textExtensions.some((extension) => file.path.endsWith(extension)))
    .sort((left, right) => right.size - left.size)
    .slice(0, limit);
  say(`Archive : ${asarPath}`);
  say(`Fichiers : ${files.length}`);
  say("Plus gros fichiers texte :");
  for (const file of largest) {
    say(`  ${String(file.size).padStart(9)}  ${file.path}`);
  }
}

if (values.grep !== undefined) {
  const pattern = values.grep;
  let matches = 0;
  for (const file of files) {
    if (matches >= limit) break;
    if (!textExtensions.some((extension) => file.path.endsWith(extension))) continue;
    if (values.ext !== undefined && !file.path.endsWith(values.ext)) continue;
    const text = readText(file);
    if (text === null || !text.includes(pattern)) continue;
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.includes(pattern)) {
        say(`${file.path}:${index + 1}: ${line.trim().slice(0, 240)}`);
        matches += 1;
        if (matches >= limit) break;
      }
    }
  }
  if (matches === 0) say(`Aucune occurrence de « ${pattern} ».`);
}

if (values.out !== undefined) {
  const target = resolve(process.cwd(), values.out);
  let written = 0;
  for (const file of files) {
    if (file.unpacked) continue;
    const start = dataStart + file.offset;
    const content = buffer.subarray(start, start + file.size);
    const destination = join(target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    written += 1;
  }
  say(`${written} fichiers extraits dans ${target}`);
}
