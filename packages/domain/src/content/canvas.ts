import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { DomainResult, SafeErrorCode } from "./types.ts";
import { err, ok } from "./types.ts";

export const CANVAS_STROKE_WIDTHS = [2, 4, 8] as const;

export const CANVAS_LIMITS = {
  cards: 500,
  connections: 1_000,
  strokes: 200,
  strokePoints: 1_000,
  coordinate: 1_000_000,
  minWidth: 160,
  maxWidth: 800,
  minHeight: 96,
  maxHeight: 600,
  textLength: 4_000,
  labelLength: 120,
  minZoom: 0.25,
  maxZoom: 4,
} as const;

export type CanvasStrokeWidth = (typeof CANVAS_STROKE_WIDTHS)[number];

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasViewport extends CanvasPoint {
  readonly zoom: number;
}

interface CanvasCardGeometry extends CanvasPoint {
  readonly cardId: Uuid;
  readonly width: number;
  readonly height: number;
}

export interface CanvasTextCard extends CanvasCardGeometry {
  readonly kind: "text";
  readonly text: string;
}

export interface CanvasPageCard extends CanvasCardGeometry {
  readonly kind: "page";
  readonly targetItemId: Uuid;
}

export type CanvasCard = CanvasTextCard | CanvasPageCard;

export interface CanvasConnection {
  readonly connectionId: Uuid;
  readonly sourceCardId: Uuid;
  readonly targetCardId: Uuid;
  readonly label: string;
}

export interface CanvasStroke {
  readonly strokeId: Uuid;
  readonly width: CanvasStrokeWidth;
  readonly points: readonly CanvasPoint[];
}

export interface CanvasBlockAttributes {
  readonly [key: string]: unknown;
  readonly canvasId: Uuid;
  readonly schemaVersion: 1;
  readonly cards: readonly CanvasCard[];
  readonly connections: readonly CanvasConnection[];
  readonly strokes: readonly CanvasStroke[];
  readonly viewport: CanvasViewport;
}

export interface ProjectedCanvasConnection extends CanvasConnection {
  readonly source: CanvasPoint;
  readonly target: CanvasPoint;
}

export interface CanvasPageCandidate {
  readonly id: Uuid;
  readonly name: string;
}

export interface ResolvedCanvasCardLabel {
  readonly label: string;
  readonly availability: "available" | "unavailable";
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function invalid(
  path: string,
  fieldCode: string,
  code: SafeErrorCode = "validation.invalid-payload",
): DomainResult<never> {
  return err(code, "Invalid canvas block structure", {
    invalidFields: [{ field: path, code: fieldCode }],
  });
}

function isBoundedCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= CANVAS_LIMITS.coordinate
  );
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function validateCard(value: unknown, path: string): DomainResult<CanvasCard> {
  if (!isRecord(value) || !isUuid(value["cardId"])) {
    return invalid(path, "invalid-card");
  }
  if (
    !isBoundedCoordinate(value["x"]) ||
    !isBoundedCoordinate(value["y"]) ||
    !isBoundedNumber(value["width"], CANVAS_LIMITS.minWidth, CANVAS_LIMITS.maxWidth) ||
    !isBoundedNumber(value["height"], CANVAS_LIMITS.minHeight, CANVAS_LIMITS.maxHeight)
  ) {
    return invalid(path, "invalid-card-geometry");
  }
  if (value["kind"] === "text") {
    if (
      !hasOnlyKeys(value, ["cardId", "kind", "x", "y", "width", "height", "text"]) ||
      typeof value["text"] !== "string" ||
      value["text"].trim().length === 0 ||
      value["text"].length > CANVAS_LIMITS.textLength
    ) {
      return invalid(path, "invalid-text-card");
    }
    return ok(value as unknown as CanvasTextCard);
  }
  if (value["kind"] === "page") {
    if (
      !hasOnlyKeys(value, ["cardId", "kind", "x", "y", "width", "height", "targetItemId"]) ||
      !isUuid(value["targetItemId"])
    ) {
      return invalid(path, "invalid-page-card");
    }
    return ok(value as unknown as CanvasPageCard);
  }
  return invalid(`${path}.kind`, "unsupported-card-kind", "document.unsupported-content");
}

function validateViewport(value: unknown, path: string): DomainResult<CanvasViewport> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["x", "y", "zoom"]) ||
    !isBoundedCoordinate(value["x"]) ||
    !isBoundedCoordinate(value["y"]) ||
    !isBoundedNumber(value["zoom"], CANVAS_LIMITS.minZoom, CANVAS_LIMITS.maxZoom)
  ) {
    return invalid(path, "invalid-viewport");
  }
  return ok(value as unknown as CanvasViewport);
}

function validateStroke(value: unknown, path: string): DomainResult<CanvasStroke> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["strokeId", "width", "points"]) ||
    !isUuid(value["strokeId"]) ||
    !(CANVAS_STROKE_WIDTHS as readonly unknown[]).includes(value["width"]) ||
    !Array.isArray(value["points"]) ||
    value["points"].length < 2 ||
    value["points"].length > CANVAS_LIMITS.strokePoints
  ) {
    return invalid(path, "invalid-stroke");
  }
  for (let index = 0; index < value["points"].length; index += 1) {
    const point = value["points"][index];
    if (
      !isRecord(point) ||
      !hasOnlyKeys(point, ["x", "y"]) ||
      !isBoundedCoordinate(point["x"]) ||
      !isBoundedCoordinate(point["y"])
    ) {
      return invalid(`${path}.points[${index}]`, "invalid-stroke-point");
    }
  }
  return ok(value as unknown as CanvasStroke);
}

export function validateCanvasBlockAttributes(
  value: unknown,
  path = "attrs",
): DomainResult<CanvasBlockAttributes> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "canvasId",
      "schemaVersion",
      "cards",
      "connections",
      "strokes",
      "viewport",
    ]) ||
    !isUuid(value["canvasId"]) ||
    value["schemaVersion"] !== 1 ||
    !Array.isArray(value["cards"]) ||
    value["cards"].length > CANVAS_LIMITS.cards ||
    !Array.isArray(value["connections"]) ||
    value["connections"].length > CANVAS_LIMITS.connections ||
    !Array.isArray(value["strokes"]) ||
    value["strokes"].length > CANVAS_LIMITS.strokes
  ) {
    return invalid(path, "invalid-canvas-attributes");
  }

  const cards: CanvasCard[] = [];
  const cardIds = new Set<string>();
  for (let index = 0; index < value["cards"].length; index += 1) {
    const result = validateCard(value["cards"][index], `${path}.cards[${index}]`);
    if (!result.ok) return result;
    if (cardIds.has(result.value.cardId)) {
      return invalid(`${path}.cards[${index}]`, "duplicate-card");
    }
    cardIds.add(result.value.cardId);
    cards.push(result.value);
  }

  const connections: CanvasConnection[] = [];
  const connectionIds = new Set<string>();
  const directedPairs = new Set<string>();
  for (let index = 0; index < value["connections"].length; index += 1) {
    const connection = value["connections"][index];
    const connectionPath = `${path}.connections[${index}]`;
    if (
      !isRecord(connection) ||
      !hasOnlyKeys(connection, ["connectionId", "sourceCardId", "targetCardId", "label"]) ||
      !isUuid(connection["connectionId"]) ||
      !isUuid(connection["sourceCardId"]) ||
      !isUuid(connection["targetCardId"]) ||
      typeof connection["label"] !== "string" ||
      connection["label"].length > CANVAS_LIMITS.labelLength
    ) {
      return invalid(connectionPath, "invalid-connection");
    }
    const pair = `${connection["sourceCardId"]}→${connection["targetCardId"]}`;
    if (
      connectionIds.has(connection["connectionId"]) ||
      directedPairs.has(pair) ||
      connection["sourceCardId"] === connection["targetCardId"] ||
      !cardIds.has(connection["sourceCardId"]) ||
      !cardIds.has(connection["targetCardId"])
    ) {
      return invalid(connectionPath, "invalid-connection-reference");
    }
    connectionIds.add(connection["connectionId"]);
    directedPairs.add(pair);
    connections.push(connection as unknown as CanvasConnection);
  }

  const strokes: CanvasStroke[] = [];
  const strokeIds = new Set<string>();
  for (let index = 0; index < value["strokes"].length; index += 1) {
    const result = validateStroke(value["strokes"][index], `${path}.strokes[${index}]`);
    if (!result.ok) return result;
    if (strokeIds.has(result.value.strokeId)) {
      return invalid(`${path}.strokes[${index}]`, "duplicate-stroke");
    }
    strokeIds.add(result.value.strokeId);
    strokes.push(result.value);
  }

  const viewport = validateViewport(value["viewport"], `${path}.viewport`);
  if (!viewport.ok) return viewport;
  return ok({
    canvasId: value["canvasId"],
    schemaVersion: 1,
    cards,
    connections,
    strokes,
    viewport: viewport.value,
  });
}

export function createEmptyCanvasAttributes(canvasId: Uuid): CanvasBlockAttributes {
  return {
    canvasId,
    schemaVersion: 1,
    cards: [],
    connections: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function cardCenter(card: CanvasCard): CanvasPoint {
  return { x: card.x + card.width / 2, y: card.y + card.height / 2 };
}

export function projectCanvasConnections(
  canvas: CanvasBlockAttributes,
): ProjectedCanvasConnection[] {
  const cards = new Map(canvas.cards.map((card) => [card.cardId, card]));
  return canvas.connections.flatMap((connection) => {
    const source = cards.get(connection.sourceCardId);
    const target = cards.get(connection.targetCardId);
    return source === undefined || target === undefined
      ? []
      : [{ ...connection, source: cardCenter(source), target: cardCenter(target) }];
  });
}

export function canvasPointToScreen(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function screenPointToCanvas(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function resolveCanvasCardLabel(
  card: CanvasCard,
  candidates: readonly CanvasPageCandidate[],
): ResolvedCanvasCardLabel {
  if (card.kind === "text") return { label: card.text, availability: "available" };
  const candidate = candidates.find((entry) => entry.id === card.targetItemId);
  return candidate === undefined
    ? { label: "Unavailable page", availability: "unavailable" }
    : { label: candidate.name, availability: "available" };
}
