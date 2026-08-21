import {
  BLOCK_FIELD_ORDER_V3,
  type CanonicalBlockV3,
  type InlineV3,
  isUnknownBlockV3,
  type JsonObject,
  type JsonValue,
  type MarkV3,
  type TableCellV3,
} from "./block.ts";
import {
  type BlockDocumentV3,
  DOCUMENT_FORMAT,
  DOCUMENT_FORMAT_VERSION_V3,
  normaliseDocumentV3,
} from "./document.ts";

type EncodedEntry = readonly [key: string, encodedValue: string];

function encodeScalar(value: string | number | boolean | null): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("canonical JSON cannot encode a non-finite number");
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("canonical JSON received a non-JSON value");
  return encoded;
}

function encodeArray(values: readonly string[]): string {
  return `[${values.join(",")}]`;
}

function encodeObject(entries: readonly EncodedEntry[]): string {
  return `{${entries
    .map(([key, encodedValue]) => `${encodeScalar(key)}:${encodedValue}`)
    .join(",")}}`;
}

/** Encodes opaque data without mutating it, recursively ordering its keys. */
function encodeOpaqueJson(value: JsonValue): string {
  if (Array.isArray(value)) return encodeArray(value.map(encodeOpaqueJson));
  if (value !== null && typeof value === "object") {
    return encodeObject(
      Object.keys(value)
        .sort()
        .map((key): EncodedEntry => {
          const child = value[key];
          if (child === undefined) {
            throw new TypeError(`canonical JSON cannot encode undefined at opaque key ${key}`);
          }
          return [key, encodeOpaqueJson(child)];
        }),
    );
  }
  return encodeScalar(value);
}

function encodeKnownObject(
  knownEntries: readonly EncodedEntry[],
  rawExtraProperties: JsonObject | undefined,
  reservedKeys: readonly string[],
): string {
  if (rawExtraProperties === undefined) return encodeObject(knownEntries);
  const reserved = new Set(reservedKeys);
  const extras = Object.keys(rawExtraProperties)
    .sort()
    .map((key): EncodedEntry => {
      if (reserved.has(key)) {
        throw new Error(`v3 opaque property collides with known field: ${key}`);
      }
      const value = rawExtraProperties[key];
      if (value === undefined) {
        throw new TypeError(`canonical JSON cannot encode undefined at opaque key ${key}`);
      }
      return [key, encodeOpaqueJson(value)];
    });
  return encodeObject([...knownEntries, ...extras]);
}

function encodeMark(mark: MarkV3): string {
  switch (mark.type) {
    case "unknown":
      return encodeOpaqueJson(mark.raw);
    case "link":
      return encodeObject([
        ["type", encodeScalar(mark.type)],
        ["href", encodeScalar(mark.href)],
      ]);
    case "pageLink":
      return encodeObject([
        ["type", encodeScalar(mark.type)],
        ["targetItemId", encodeScalar(mark.targetItemId)],
      ]);
    case "textColor":
    case "backgroundColor":
      return encodeObject([
        ["type", encodeScalar(mark.type)],
        ["color", encodeScalar(mark.color)],
      ]);
    default:
      return encodeObject([["type", encodeScalar(mark.type)]]);
  }
}

function encodeInline(node: InlineV3): string {
  const entries: EncodedEntry[] = [["text", encodeScalar(node.text)]];
  if (node.marks !== undefined && node.marks.length > 0) {
    entries.push(["marks", encodeArray(node.marks.map(encodeMark))]);
  }
  return encodeObject(entries);
}

function encodeChildren(children: readonly CanonicalBlockV3[] | undefined): EncodedEntry[] {
  return children === undefined || children.length === 0
    ? []
    : [["children", encodeArray(children.map(encodeBlock))]];
}

function encodeCell(cell: TableCellV3): string {
  return encodeObject([
    ["id", encodeScalar(cell.id)],
    ["content", encodeArray(cell.content.map(encodeInline))],
    ...encodeChildren(cell.children),
  ]);
}

function encodeBlock(block: CanonicalBlockV3): string {
  if (isUnknownBlockV3(block)) return encodeOpaqueJson(block.raw);

  const entries: EncodedEntry[] = [
    ["type", encodeScalar(block.type)],
    ["id", encodeScalar(block.id)],
  ];
  switch (block.type) {
    case "paragraph":
      entries.push(["content", encodeArray(block.content.map(encodeInline))]);
      break;
    case "heading":
      entries.push(
        ["level", encodeScalar(block.level)],
        ["content", encodeArray(block.content.map(encodeInline))],
      );
      break;
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
    case "toggle":
      entries.push(
        ["content", encodeArray(block.content.map(encodeInline))],
        ...encodeChildren(block.children),
      );
      break;
    case "checkbox":
      entries.push(
        ["checked", encodeScalar(block.checked)],
        ["content", encodeArray(block.content.map(encodeInline))],
        ...encodeChildren(block.children),
      );
      break;
    case "code":
      entries.push(["text", encodeScalar(block.text)], ["language", encodeScalar(block.language)]);
      break;
    case "divider":
      break;
    case "callout":
      entries.push(
        ["content", encodeArray(block.content.map(encodeInline))],
        ["icon", encodeScalar(block.icon)],
        ["tone", encodeScalar(block.tone)],
        ...encodeChildren(block.children),
      );
      break;
    case "table":
      entries.push(
        [
          "columns",
          encodeArray(
            block.columns.map((column) =>
              encodeObject([
                ["id", encodeScalar(column.id)],
                ["width", encodeScalar(column.width)],
              ]),
            ),
          ),
        ],
        [
          "rows",
          encodeArray(
            block.rows.map((row) =>
              encodeObject([
                ["id", encodeScalar(row.id)],
                ["cells", encodeArray(row.cells.map(encodeCell))],
              ]),
            ),
          ),
        ],
      );
      break;
    case "image":
      entries.push(
        ["fileItemId", encodeScalar(block.fileItemId)],
        ["caption", encodeScalar(block.caption)],
        ["altText", encodeScalar(block.altText)],
        ["displayWidth", encodeScalar(block.displayWidth)],
      );
      break;
    case "fileEmbed":
      entries.push(
        ["fileItemId", encodeScalar(block.fileItemId)],
        ["caption", encodeScalar(block.caption)],
      );
      break;
    case "embed":
      entries.push(
        ["provider", encodeScalar(block.provider)],
        ["sourceUrl", encodeScalar(block.sourceUrl)],
        ["caption", encodeScalar(block.caption)],
      );
      break;
  }
  return encodeKnownObject(entries, block.rawExtraProperties, BLOCK_FIELD_ORDER_V3[block.type]);
}

/** Stable UTF-8 JSON of the complete owned v3 envelope. */
export function canonicalDocumentJsonV3(document: BlockDocumentV3): string {
  const normalised = normaliseDocumentV3(document);
  return encodeObject([
    ["format", encodeScalar(DOCUMENT_FORMAT)],
    ["formatVersion", encodeScalar(DOCUMENT_FORMAT_VERSION_V3)],
    ["body", encodeObject([["blocks", encodeArray(normalised.blocks.map(encodeBlock))]])],
  ]);
}

export function canonicalDocumentBytesV3(document: BlockDocumentV3): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(canonicalDocumentJsonV3(document));
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
}

/** Lowercase SHA-256 hex over the complete canonical envelope bytes. */
export async function documentDigestV3(document: BlockDocumentV3): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    canonicalDocumentBytesV3(document),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
