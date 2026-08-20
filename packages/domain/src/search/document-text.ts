import type {
  DatabaseDefinition,
  DatabaseProperty,
  EntryValues,
  NonRelationPropertyValue,
  TaskRole,
} from "../databases/types.ts";
import {
  type Block,
  type CanonicalBlockV3,
  childrenOf,
  childrenOfV3,
  hasInlineContent,
  hasInlineContentV3,
  type InlineV3,
  isUnknownBlock,
  isUnknownBlockV3,
} from "../document/block.ts";
import type { BlockDocument, BlockDocumentV3 } from "../document/document.ts";
import type { Uuid } from "../ids/uuid.ts";
import type { SearchPropertyText } from "./types.ts";

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu;
const INLINE_WHITESPACE = /\s+/gu;

function cleanVisibleText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(INLINE_WHITESPACE, " ").trim();
}

function textOf(block: Block): string {
  if (isUnknownBlock(block)) {
    return "";
  }
  if (hasInlineContent(block)) {
    return cleanVisibleText(block.content.map(({ text }) => text).join(""));
  }
  if (block.type === "code") {
    return cleanVisibleText(block.text);
  }
  if (block.type === "fileEmbed") {
    return block.caption === null ? "" : cleanVisibleText(block.caption);
  }
  return "";
}

/** Extracts only content a compatible client visibly renders. */
export function extractSearchableDocumentText(document: BlockDocument): string {
  const parts: string[] = [];
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      const text = textOf(block);
      if (text.length > 0) {
        parts.push(text);
      }
      visit(childrenOf(block));
    }
  };
  visit(document.blocks);
  return parts.join("\n");
}

function visibleInlineTextV3(content: readonly InlineV3[]): string {
  return cleanVisibleText(content.map(({ text }) => text).join(""));
}

function visibleBlockTextV3(block: CanonicalBlockV3): string[] {
  if (isUnknownBlockV3(block)) return [];
  if (hasInlineContentV3(block)) return [visibleInlineTextV3(block.content)];
  switch (block.type) {
    case "code":
      return [cleanVisibleText(block.text)];
    case "image":
      return [block.caption, block.altText]
        .filter((value): value is string => value !== null)
        .map(cleanVisibleText);
    case "fileEmbed":
      return block.caption === null ? [] : [cleanVisibleText(block.caption)];
    case "embed":
      return [block.caption, block.sourceUrl]
        .filter((value): value is string => value !== null)
        .map(cleanVisibleText);
    case "table":
      return block.rows.flatMap((row) =>
        row.cells.map((cell) => visibleInlineTextV3(cell.content)),
      );
    case "divider":
      return [];
  }
}

/** Extracts every visibly rendered v3 text field, including table cells. */
export function extractSearchableDocumentTextV3(document: BlockDocumentV3): string {
  const parts: string[] = [];
  const visit = (blocks: readonly CanonicalBlockV3[]): void => {
    for (const block of blocks) {
      parts.push(...visibleBlockTextV3(block).filter((text) => text.length > 0));
      if (!isUnknownBlockV3(block) && block.type === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) visit(cell.children ?? []);
        }
      }
      visit(childrenOfV3(block));
    }
  };
  visit(document.blocks);
  return parts.join("\n");
}

function taskRoleByProperty(definition: DatabaseDefinition): ReadonlyMap<Uuid, TaskRole> {
  const roles = definition.taskRoles;
  if (roles === null) return new Map();
  const byProperty = new Map<Uuid, TaskRole>([[roles.statusPropertyId, "status"]]);
  if (roles.dueDatePropertyId !== null) byProperty.set(roles.dueDatePropertyId, "dueDate");
  if (roles.priorityPropertyId !== null && !byProperty.has(roles.priorityPropertyId)) {
    byProperty.set(roles.priorityPropertyId, "priority");
  }
  return byProperty;
}

function optionText(
  property: Extract<DatabaseProperty, { type: "status" | "select" | "multi-select" }>,
  optionId: Uuid,
): string | null {
  const option = property.config.options.find(
    ({ id, state }) => id === optionId && state === "active",
  );
  return option === undefined ? null : cleanVisibleText(option.label);
}

function searchablePropertyValue(
  property: DatabaseProperty,
  value: NonRelationPropertyValue | undefined,
  taskRole: TaskRole | null,
): string | null {
  if (value === undefined) return null;
  if (property.type === "text" && value.kind === "text") {
    return cleanVisibleText(value.value);
  }
  if (taskRole === "dueDate" && property.type === "date") {
    if (value.kind === "date") return value.date;
    if (value.kind === "instant") return value.instant;
    return null;
  }
  if (
    (taskRole === "status" || taskRole === "priority") &&
    (property.type === "status" || property.type === "select") &&
    (value.kind === "status" || value.kind === "select")
  ) {
    return optionText(property, value.optionId);
  }
  return null;
}

/** Extracts only active text values and the configured task semantics. */
export function extractSearchablePropertyText(
  definition: DatabaseDefinition,
  values: EntryValues,
): SearchPropertyText[] {
  if (definition.databaseId !== values.databaseId) return [];
  const roleByProperty = taskRoleByProperty(definition);
  return definition.properties.flatMap((property): SearchPropertyText[] => {
    if (property.state !== "active") return [];
    const taskRole = roleByProperty.get(property.id) ?? null;
    if (property.type !== "text" && taskRole === null) return [];
    const text = searchablePropertyValue(property, values.values[property.id], taskRole);
    return text === null || text.length === 0
      ? []
      : [{ propertyId: property.id, propertyName: property.name, text, taskRole }];
  });
}
