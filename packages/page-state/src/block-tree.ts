import {
  BLOCK_FIELD_ORDER_V3,
  type BlockDocumentV3,
  type CanonicalBlockV3,
  childrenOfV3,
  collectDocumentIdsV3,
  hasInlineContentV3,
  isKnownBlockTypeV3,
  isUnknownBlockV3,
  type JsonObject,
  type JsonValue,
  mayHaveChildrenV3,
  normaliseDocumentV3,
  serialiseDocumentV3,
  type TableColumnV3,
  type Uuid,
  validateDocumentV3,
} from "@myownnotion/domain";
import type { LoroDoc, LoroMap, LoroText, LoroTree, LoroTreeNode } from "loro-crdt";
import { initialiseRichText, projectRichText } from "./rich-text.ts";

const BLOCK_TREE_ROOT = "blocks";
const PROPS_KEY = "props";
const CONTENT_KEY = "content";
const EXTRA_PROPERTY_PREFIX = "extra:";
const NODE_SCHEMA_VERSION = 1;

type InternalNodeType = "tableRow" | "tableCell";
export type OperationalNodeType = CanonicalBlockV3["type"] | InternalNodeType;

export class BlockTreeOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockTreeOperationError";
  }
}

function jsonFromValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new BlockTreeOperationError(`${path} contains a non-finite number`);
  }
  if (value === undefined || value instanceof Uint8Array) {
    throw new BlockTreeOperationError(`${path} is not canonical JSON`);
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => jsonFromValue(child, `${path}[${index}]`));
  }
  if (typeof value !== "object") {
    throw new BlockTreeOperationError(`${path} is not canonical JSON`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BlockTreeOperationError(`${path} must be a plain JSON object`);
  }
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = jsonFromValue(child, `${path}.${key}`);
  }
  return result;
}

function jsonObjectFromValue(value: unknown, path: string): JsonObject {
  const json = jsonFromValue(value, path);
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    throw new BlockTreeOperationError(`${path} must be a JSON object`);
  }
  return json;
}

function nodeIdentity(node: LoroTreeNode): Uuid {
  const value = node.data.get("blockId");
  if (typeof value !== "string") {
    throw new BlockTreeOperationError(`tree node ${node.id} has no canonical identity`);
  }
  return value as Uuid;
}

function nodeType(node: LoroTreeNode): OperationalNodeType {
  const value = node.data.get("type");
  if (
    value === "unknown" ||
    value === "tableRow" ||
    value === "tableCell" ||
    isKnownBlockTypeV3(value)
  ) {
    return value;
  }
  throw new BlockTreeOperationError(`tree node ${nodeIdentity(node)} has an unsupported type`);
}

function liveNodes(tree: LoroTree): LoroTreeNode[] {
  return tree.nodes().filter((node) => !node.isDeleted());
}

function findNodesByIdentity(tree: LoroTree, blockId: Uuid): LoroTreeNode[] {
  return liveNodes(tree).filter((node) => nodeIdentity(node) === blockId);
}

export function findOperationalNode(tree: LoroTree, blockId: Uuid): LoroTreeNode {
  const matches = findNodesByIdentity(tree, blockId);
  if (matches.length === 0) {
    throw new BlockTreeOperationError(`block identity ${blockId} does not exist`);
  }
  if (matches.length > 1) {
    throw new BlockTreeOperationError(`block identity ${blockId} is duplicated`);
  }
  const match = matches[0];
  if (match === undefined) {
    throw new BlockTreeOperationError(`block identity ${blockId} does not exist`);
  }
  return match;
}

function assertUniqueOperationalIdentities(tree: LoroTree): void {
  const seen = new Set<Uuid>();
  for (const node of liveNodes(tree)) {
    const identity = nodeIdentity(node);
    if (seen.has(identity)) {
      throw new BlockTreeOperationError(`block identity ${identity} is duplicated`);
    }
    seen.add(identity);
  }
}

export function getOperationalBlockTree(doc: LoroDoc): LoroTree {
  const tree = doc.getTree(BLOCK_TREE_ROOT);
  tree.enableFractionalIndex(0);
  return tree;
}

function setKnownProperty(props: LoroMap, key: string, value: JsonValue): void {
  props.set(key, value);
}

function setExtraProperties(props: LoroMap, extra: JsonObject | undefined): void {
  if (extra === undefined) return;
  for (const key of Object.keys(extra).sort()) {
    const value = extra[key];
    if (value === undefined) {
      throw new BlockTreeOperationError(`opaque property ${key} is undefined`);
    }
    setKnownProperty(props, `${EXTRA_PROPERTY_PREFIX}${key}`, value);
  }
}

function setNodeHeader(node: LoroTreeNode, blockId: Uuid, type: OperationalNodeType): void {
  node.data.set("blockId", blockId);
  node.data.set("type", type);
  node.data.set("schemaVersion", NODE_SCHEMA_VERSION);
}

function initialiseKnownBlockPayload(
  node: LoroTreeNode,
  block: Exclude<CanonicalBlockV3, { type: "unknown" }>,
): void {
  const props = node.data.ensureMergeableMap(PROPS_KEY);
  setExtraProperties(props, block.rawExtraProperties);

  if (hasInlineContentV3(block)) {
    initialiseRichText(node.data.ensureMergeableText(CONTENT_KEY), block.content);
  }

  switch (block.type) {
    case "paragraph":
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
    case "toggle":
    case "divider":
      break;
    case "heading":
      setKnownProperty(props, "level", block.level);
      break;
    case "checkbox":
      setKnownProperty(props, "checked", block.checked);
      break;
    case "code":
      initialiseRichText(node.data.ensureMergeableText(CONTENT_KEY), [{ text: block.text }]);
      setKnownProperty(props, "language", block.language);
      break;
    case "callout":
      setKnownProperty(props, "icon", block.icon);
      setKnownProperty(props, "tone", block.tone);
      break;
    case "table":
      setKnownProperty(
        props,
        "columns",
        block.columns.map(({ id, width }) => ({ id, width })),
      );
      break;
    case "image":
      setKnownProperty(props, "fileItemId", block.fileItemId);
      setKnownProperty(props, "caption", block.caption);
      setKnownProperty(props, "altText", block.altText);
      setKnownProperty(props, "displayWidth", block.displayWidth);
      node.data.set("fileRefs", [block.fileItemId]);
      break;
    case "fileEmbed":
      setKnownProperty(props, "fileItemId", block.fileItemId);
      setKnownProperty(props, "caption", block.caption);
      node.data.set("fileRefs", [block.fileItemId]);
      break;
    case "embed":
      setKnownProperty(props, "provider", block.provider);
      setKnownProperty(props, "sourceUrl", block.sourceUrl);
      setKnownProperty(props, "caption", block.caption);
      break;
  }
}

function createCanonicalNode(
  tree: LoroTree,
  parent: LoroTreeNode | undefined,
  index: number | undefined,
  block: CanonicalBlockV3,
): LoroTreeNode {
  const node = tree.createNode(parent?.id, index);
  setNodeHeader(node, block.id, block.type);
  if (isUnknownBlockV3(block)) {
    node.data.set("declaredType", block.declaredType);
    node.data.set("syntheticId", block.syntheticId);
    node.data.set("rawUnknown", block.raw);
    return node;
  }

  initialiseKnownBlockPayload(node, block);
  if (block.type === "table") {
    for (const row of block.rows) {
      const rowNode = node.createNode();
      setNodeHeader(rowNode, row.id, "tableRow");
      for (const cell of row.cells) {
        const cellNode = rowNode.createNode();
        setNodeHeader(cellNode, cell.id, "tableCell");
        initialiseRichText(cellNode.data.ensureMergeableText(CONTENT_KEY), cell.content);
        for (const child of cell.children ?? []) {
          createCanonicalNode(tree, cellNode, undefined, child);
        }
      }
    }
    return node;
  }

  for (const child of childrenOfV3(block)) {
    createCanonicalNode(tree, node, undefined, child);
  }
  return node;
}

function validateInputDocument(document: BlockDocumentV3): BlockDocumentV3 {
  let result: ReturnType<typeof validateDocumentV3>;
  try {
    result = validateDocumentV3(serialiseDocumentV3(document));
  } catch (error) {
    throw new BlockTreeOperationError(
      error instanceof Error ? error.message : "the canonical document cannot be serialised",
    );
  }
  if (!result.ok) {
    const detail = result.problems.map(({ path, message }) => `${path}: ${message}`).join("; ");
    throw new BlockTreeOperationError(`invalid canonical document: ${detail}`);
  }
  // Keep synthetic unknown identities from the in-memory input. Their raw wire
  // object deliberately has no id, so reparsing it would mint a new session id.
  return normaliseDocumentV3(document);
}

export function initialiseOperationalBlockTree(doc: LoroDoc, document: BlockDocumentV3): void {
  const validated = validateInputDocument(document);
  const tree = getOperationalBlockTree(doc);
  if (liveNodes(tree).length > 0) {
    throw new BlockTreeOperationError("the operational block tree is already initialised");
  }
  for (const block of validated.blocks) {
    createCanonicalNode(tree, undefined, undefined, block);
  }
  assertUniqueOperationalIdentities(tree);
}

function requiredProperty(props: LoroMap, key: string, path: string): JsonValue {
  const value = props.get(key);
  if (value === undefined) {
    throw new BlockTreeOperationError(`${path}.${key} is missing`);
  }
  return jsonFromValue(value, `${path}.${key}`);
}

function extraProperties(
  props: LoroMap,
  type: Exclude<OperationalNodeType, InternalNodeType | "unknown">,
): JsonObject | undefined {
  const extra: JsonObject = {};
  for (const keyValue of props.keys()) {
    if (typeof keyValue !== "string" || !keyValue.startsWith(EXTRA_PROPERTY_PREFIX)) continue;
    const key = keyValue.slice(EXTRA_PROPERTY_PREFIX.length);
    if (BLOCK_FIELD_ORDER_V3[type].includes(key)) {
      throw new BlockTreeOperationError(`opaque property collides with ${type}.${key}`);
    }
    const value = props.get(keyValue);
    if (value === undefined) throw new BlockTreeOperationError(`opaque property ${key} is missing`);
    extra[key] = jsonFromValue(value, `props.${key}`);
  }
  return Object.keys(extra).length === 0 ? undefined : extra;
}

function withChildren(base: JsonObject, children: readonly CanonicalBlockV3[]): JsonObject {
  if (children.length > 0) base["children"] = children as unknown as JsonValue;
  return base;
}

function materialiseCanonicalChildren(node: LoroTreeNode): CanonicalBlockV3[] {
  const result: CanonicalBlockV3[] = [];
  for (const child of node.children() ?? []) {
    const type = nodeType(child);
    if (type === "tableRow" || type === "tableCell") {
      throw new BlockTreeOperationError(
        `internal ${type} ${nodeIdentity(child)} appears outside a table structure`,
      );
    }
    result.push(materialiseCanonicalNode(child));
  }
  return result;
}

function tableColumns(props: LoroMap, path: string): readonly TableColumnV3[] {
  const value = requiredProperty(props, "columns", path);
  if (!Array.isArray(value)) {
    throw new BlockTreeOperationError(`${path}.columns must be an array`);
  }
  return value.map((column, index) => {
    if (column === null || Array.isArray(column) || typeof column !== "object") {
      throw new BlockTreeOperationError(`${path}.columns[${index}] must be an object`);
    }
    return {
      id: column["id"] as Uuid,
      width: column["width"] as number | null,
    };
  });
}

function materialiseTableRows(node: LoroTreeNode): JsonValue[] {
  return (node.children() ?? []).map((rowNode, rowIndex) => {
    if (nodeType(rowNode) !== "tableRow") {
      throw new BlockTreeOperationError(`table row ${rowIndex} is not a tableRow node`);
    }
    const cells = (rowNode.children() ?? []).map((cellNode, cellIndex) => {
      if (nodeType(cellNode) !== "tableCell") {
        throw new BlockTreeOperationError(
          `table row ${nodeIdentity(rowNode)} child ${cellIndex} is not a tableCell node`,
        );
      }
      const content = projectRichText(cellNode.data.ensureMergeableText(CONTENT_KEY));
      const children = materialiseCanonicalChildren(cellNode);
      const cell: JsonObject = {
        id: nodeIdentity(cellNode),
        content: content as unknown as JsonValue,
      };
      return withChildren(cell, children);
    });
    return { id: nodeIdentity(rowNode), cells };
  });
}

function materialiseCanonicalNode(node: LoroTreeNode): CanonicalBlockV3 {
  const id = nodeIdentity(node);
  const type = nodeType(node);
  if (type === "tableRow" || type === "tableCell") {
    throw new BlockTreeOperationError(`internal ${type} ${id} cannot be projected as a block`);
  }
  if (type === "unknown") {
    const raw = jsonObjectFromValue(node.data.get("rawUnknown"), `block ${id}.rawUnknown`);
    const declaredType = node.data.get("declaredType");
    const syntheticId = node.data.get("syntheticId");
    if (typeof declaredType !== "string" || typeof syntheticId !== "boolean") {
      throw new BlockTreeOperationError(`unknown block ${id} has invalid metadata`);
    }
    return { type, id, declaredType, raw, syntheticId };
  }

  const props = node.data.ensureMergeableMap(PROPS_KEY);
  const rawExtraProperties = extraProperties(props, type);
  const extra = rawExtraProperties === undefined ? {} : { rawExtraProperties };
  const children = type === "table" ? [] : materialiseCanonicalChildren(node);
  const content = (): JsonValue =>
    projectRichText(node.data.ensureMergeableText(CONTENT_KEY)) as unknown as JsonValue;
  let candidate: JsonObject;

  switch (type) {
    case "paragraph":
      candidate = { type, id, content: content(), ...extra };
      break;
    case "heading":
      candidate = {
        type,
        id,
        level: requiredProperty(props, "level", `block ${id}`),
        content: content(),
        ...extra,
      };
      break;
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
    case "toggle":
      candidate = withChildren({ type, id, content: content(), ...extra }, children);
      break;
    case "checkbox":
      candidate = withChildren(
        {
          type,
          id,
          checked: requiredProperty(props, "checked", `block ${id}`),
          content: content(),
          ...extra,
        },
        children,
      );
      break;
    case "code":
      if (children.length > 0) throw new BlockTreeOperationError(`code block ${id} has children`);
      candidate = {
        type,
        id,
        text: node.data.ensureMergeableText(CONTENT_KEY).toString(),
        language: requiredProperty(props, "language", `block ${id}`),
        ...extra,
      };
      break;
    case "divider":
      if (children.length > 0) throw new BlockTreeOperationError(`divider ${id} has children`);
      candidate = { type, id, ...extra };
      break;
    case "callout":
      candidate = withChildren(
        {
          type,
          id,
          content: content(),
          icon: requiredProperty(props, "icon", `block ${id}`),
          tone: requiredProperty(props, "tone", `block ${id}`),
          ...extra,
        },
        children,
      );
      break;
    case "table":
      candidate = {
        type,
        id,
        columns: tableColumns(props, `block ${id}`) as unknown as JsonValue,
        rows: materialiseTableRows(node),
        ...extra,
      };
      break;
    case "image":
      if (children.length > 0) throw new BlockTreeOperationError(`image ${id} has children`);
      candidate = {
        type,
        id,
        fileItemId: requiredProperty(props, "fileItemId", `block ${id}`),
        caption: requiredProperty(props, "caption", `block ${id}`),
        altText: requiredProperty(props, "altText", `block ${id}`),
        displayWidth: requiredProperty(props, "displayWidth", `block ${id}`),
        ...extra,
      };
      break;
    case "fileEmbed":
      if (children.length > 0) throw new BlockTreeOperationError(`file block ${id} has children`);
      candidate = {
        type,
        id,
        fileItemId: requiredProperty(props, "fileItemId", `block ${id}`),
        caption: requiredProperty(props, "caption", `block ${id}`),
        ...extra,
      };
      break;
    case "embed":
      if (children.length > 0) throw new BlockTreeOperationError(`embed ${id} has children`);
      candidate = {
        type,
        id,
        provider: requiredProperty(props, "provider", `block ${id}`),
        sourceUrl: requiredProperty(props, "sourceUrl", `block ${id}`),
        caption: requiredProperty(props, "caption", `block ${id}`),
        ...extra,
      };
      break;
  }
  return candidate as unknown as CanonicalBlockV3;
}

export function materialiseOperationalDocument(doc: LoroDoc): BlockDocumentV3 {
  const tree = getOperationalBlockTree(doc);
  assertUniqueOperationalIdentities(tree);
  const candidate: BlockDocumentV3 = {
    blocks: tree.roots().map((node) => {
      const type = nodeType(node);
      if (type === "tableRow" || type === "tableCell") {
        throw new BlockTreeOperationError(`internal ${type} ${nodeIdentity(node)} is a tree root`);
      }
      return materialiseCanonicalNode(node);
    }),
  };
  const result = validateDocumentV3(serialiseDocumentV3(candidate));
  if (!result.ok) {
    const detail = result.problems.map(({ path, message }) => `${path}: ${message}`).join("; ");
    throw new BlockTreeOperationError(`operational projection is invalid: ${detail}`);
  }
  return normaliseDocumentV3(candidate);
}

function assertCanonicalNode(node: LoroTreeNode, action: string): void {
  const type = nodeType(node);
  if (type === "tableRow" || type === "tableCell") {
    throw new BlockTreeOperationError(`${action} cannot target internal ${type} identities`);
  }
}

function assertParentCanContain(parent: LoroTreeNode | undefined): void {
  if (parent === undefined) return;
  const type = nodeType(parent);
  if (type === "tableCell") return;
  if (
    type === "tableRow" ||
    type === "unknown" ||
    !isKnownBlockTypeV3(type) ||
    !mayHaveChildrenV3(type)
  ) {
    throw new BlockTreeOperationError(`${type} ${nodeIdentity(parent)} cannot contain blocks`);
  }
}

function actualParentId(node: LoroTreeNode): string | undefined {
  return node.parent()?.id;
}

function resolvePlacement(
  tree: LoroTree,
  parentBlockId: Uuid | null,
  beforeBlockId: Uuid | null,
): { parent: LoroTreeNode | undefined; before: LoroTreeNode | undefined } {
  const parent = parentBlockId === null ? undefined : findOperationalNode(tree, parentBlockId);
  assertParentCanContain(parent);
  const before = beforeBlockId === null ? undefined : findOperationalNode(tree, beforeBlockId);
  if (before !== undefined) {
    assertCanonicalNode(before, "placement");
    if (actualParentId(before) !== parent?.id) {
      throw new BlockTreeOperationError(
        `before block ${beforeBlockId} is not under the requested parent`,
      );
    }
  }
  return { parent, before };
}

function validateInsertedBlock(block: CanonicalBlockV3): CanonicalBlockV3 {
  const validated = validateInputDocument({ blocks: [block] }).blocks[0];
  if (validated === undefined) {
    throw new BlockTreeOperationError("the inserted block is missing after validation");
  }
  return validated;
}

export function insertOperationalBlock(
  doc: LoroDoc,
  block: CanonicalBlockV3,
  parentBlockId: Uuid | null,
  beforeBlockId: Uuid | null,
): void {
  const tree = getOperationalBlockTree(doc);
  const validatedBlock = validateInsertedBlock(block);
  const existingIds = new Set(collectDocumentIdsV3(materialiseOperationalDocument(doc)));
  for (const identity of collectDocumentIdsV3({ blocks: [validatedBlock] })) {
    if (existingIds.has(identity)) {
      throw new BlockTreeOperationError(`block identity ${identity} already exists`);
    }
  }
  const { parent, before } = resolvePlacement(tree, parentBlockId, beforeBlockId);
  const index = before?.index();
  if (before !== undefined && index === undefined) {
    throw new BlockTreeOperationError(`before block ${beforeBlockId} has no visible position`);
  }
  createCanonicalNode(tree, parent, index, validatedBlock);
  assertUniqueOperationalIdentities(tree);
}

export function moveOperationalBlock(
  doc: LoroDoc,
  blockId: Uuid,
  parentBlockId: Uuid | null,
  beforeBlockId: Uuid | null,
): void {
  const tree = getOperationalBlockTree(doc);
  const node = findOperationalNode(tree, blockId);
  assertCanonicalNode(node, "move");
  const { parent, before } = resolvePlacement(tree, parentBlockId, beforeBlockId);
  if (before?.id === node.id) {
    throw new BlockTreeOperationError("a block cannot be placed before itself");
  }
  for (let ancestor = parent; ancestor !== undefined; ancestor = ancestor.parent()) {
    if (ancestor.id === node.id) {
      throw new BlockTreeOperationError(`moving ${blockId} would create a cycle`);
    }
  }
  if (before !== undefined) node.moveBefore(before);
  else node.move(parent);
}

export function deleteOperationalBlock(doc: LoroDoc, blockId: Uuid): void {
  const tree = getOperationalBlockTree(doc);
  const node = findOperationalNode(tree, blockId);
  assertCanonicalNode(node, "delete");
  tree.delete(node.id);
}

const IMMUTABLE_PROPERTY_KEYS = new Set(["type", "id", "content", "children", "text", "rows"]);

export function setOperationalBlockProperty(
  doc: LoroDoc,
  blockId: Uuid,
  key: string,
  value: JsonValue,
): void {
  const tree = getOperationalBlockTree(doc);
  const node = findOperationalNode(tree, blockId);
  const type = nodeType(node);
  if (type === "unknown" || type === "tableRow" || type === "tableCell") {
    throw new BlockTreeOperationError(`properties cannot be set on ${type} ${blockId}`);
  }
  if (IMMUTABLE_PROPERTY_KEYS.has(key)) {
    throw new BlockTreeOperationError(`${key} is structural and cannot be set as a property`);
  }
  const props = node.data.ensureMergeableMap(PROPS_KEY);
  const knownFields = BLOCK_FIELD_ORDER_V3[type];
  setKnownProperty(
    props,
    knownFields.includes(key) ? key : `${EXTRA_PROPERTY_PREFIX}${key}`,
    value,
  );
  if ((type === "image" || type === "fileEmbed") && key === "fileItemId") {
    node.data.set("fileRefs", [value]);
  }
}

export function operationalTextForBlock(
  doc: LoroDoc,
  blockId: Uuid,
): {
  readonly text: LoroText;
  readonly allowsMarks: boolean;
  readonly allowsCodeControls: boolean;
} {
  const node = findOperationalNode(getOperationalBlockTree(doc), blockId);
  const type = nodeType(node);
  if (type === "code") {
    return {
      text: node.data.ensureMergeableText(CONTENT_KEY),
      allowsMarks: false,
      allowsCodeControls: true,
    };
  }
  if (
    type === "tableCell" ||
    (isKnownBlockTypeV3(type) &&
      type !== "divider" &&
      type !== "table" &&
      type !== "image" &&
      type !== "fileEmbed" &&
      type !== "embed")
  ) {
    return {
      text: node.data.ensureMergeableText(CONTENT_KEY),
      allowsMarks: true,
      allowsCodeControls: false,
    };
  }
  throw new BlockTreeOperationError(`${type} ${blockId} has no editable text`);
}

export function assertOperationalBlockTree(doc: LoroDoc): void {
  materialiseOperationalDocument(doc);
}
