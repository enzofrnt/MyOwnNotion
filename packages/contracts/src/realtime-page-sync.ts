/** Bounded transport envelopes for durable realtime page synchronization. */

import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  PAGE_OPERATION_PROTOCOL_VERSION,
  PageOperationUuidSchema,
  PageSyncRequestSchema,
  PageSyncResponseSchema,
  parsePageSyncRequest,
  parsePageSyncResponse,
} from "./page-operations.ts";

export const REALTIME_PAGE_SYNC_PROTOCOL_VERSION = 1 as const;
export const MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES = 2 * 1024 * 1024;
export const MAX_REALTIME_PAGE_SYNC_IN_FLIGHT = 8;
export const REALTIME_PAGE_SYNC_HELLO_TIMEOUT_MS = 5_000;
export const REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS = 20_000;
export const REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS = 60_000;
export const REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS = 30_000;

export const REALTIME_PAGE_SYNC_CLOSE_CODES = {
  messageTooLarge: 1009,
  invalidMessage: 4400,
  authenticationRequired: 4401,
  authorizationRefused: 4403,
  updateRequired: 4406,
  timeout: 4408,
  duplicateInFlight: 4409,
  rateLimited: 4429,
  internalError: 4500,
} as const;

const NonceSchema = Type.String({ minLength: 1, maxLength: 128 });
const SafeCodeSchema = Type.String({
  pattern: "^[a-z][a-z0-9._-]{0,127}$",
  minLength: 1,
  maxLength: 128,
});
const SafeMessageSchema = Type.String({ minLength: 1, maxLength: 1_000 });
const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const RealtimePageSyncHelloSchema = Type.Object(
  {
    type: Type.Literal("hello"),
    requestId: PageOperationUuidSchema,
    realtimeProtocolVersion: Type.Literal(REALTIME_PAGE_SYNC_PROTOCOL_VERSION),
    pageOperationProtocolVersion: Type.Literal(PAGE_OPERATION_PROTOCOL_VERSION),
    csrfToken: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const RealtimePageSyncRequestSchema = Type.Object(
  {
    type: Type.Literal("sync"),
    requestId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    request: PageSyncRequestSchema,
  },
  { additionalProperties: false },
);

const RealtimePingSchema = Type.Object(
  { type: Type.Literal("ping"), nonce: NonceSchema },
  { additionalProperties: false },
);
const RealtimePongSchema = Type.Object(
  { type: Type.Literal("pong"), nonce: NonceSchema },
  { additionalProperties: false },
);

export const RealtimePageSyncClientMessageSchema = Type.Union([
  RealtimePageSyncHelloSchema,
  RealtimePageSyncRequestSchema,
  RealtimePingSchema,
  RealtimePongSchema,
]);
export type RealtimePageSyncClientMessageDto = Static<typeof RealtimePageSyncClientMessageSchema>;

export const RealtimePageSyncReadySchema = Type.Object(
  {
    type: Type.Literal("ready"),
    requestId: PageOperationUuidSchema,
    connectionId: PageOperationUuidSchema,
    realtimeProtocolVersion: Type.Literal(REALTIME_PAGE_SYNC_PROTOCOL_VERSION),
    pageOperationProtocolVersion: Type.Literal(PAGE_OPERATION_PROTOCOL_VERSION),
    heartbeatIntervalMs: Type.Literal(REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS),
    requestTimeoutMs: Type.Literal(REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS),
    maxMessageBytes: Type.Literal(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES),
    maxInFlight: Type.Literal(MAX_REALTIME_PAGE_SYNC_IN_FLIGHT),
  },
  { additionalProperties: false },
);

export const RealtimePageSyncResultSchema = Type.Object(
  {
    type: Type.Literal("sync-result"),
    requestId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    response: PageSyncResponseSchema,
  },
  { additionalProperties: false },
);

export const RealtimePageSyncProblemSchema = Type.Object(
  {
    type: Type.Literal("sync-problem"),
    requestId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    offline: Type.Boolean(),
    retryable: Type.Boolean(),
    retryAfterMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
    problem: Type.Object(
      { code: SafeCodeSchema, message: SafeMessageSchema },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const RealtimePageAdvancedSchema = Type.Object(
  {
    type: Type.Literal("page-advanced"),
    pageId: PageOperationUuidSchema,
    latestPageSequence: SequenceSchema,
  },
  { additionalProperties: false },
);

export const RealtimePageSyncRefusedSchema = Type.Object(
  {
    type: Type.Literal("refused"),
    requestId: PageOperationUuidSchema,
    code: SafeCodeSchema,
    message: SafeMessageSchema,
  },
  { additionalProperties: false },
);

export const RealtimePageSyncServerMessageSchema = Type.Union([
  RealtimePageSyncReadySchema,
  RealtimePageSyncResultSchema,
  RealtimePageSyncProblemSchema,
  RealtimePageAdvancedSchema,
  RealtimePageSyncRefusedSchema,
  RealtimePingSchema,
  RealtimePongSchema,
]);
export type RealtimePageSyncServerMessageDto = Static<typeof RealtimePageSyncServerMessageSchema>;

export class RealtimePageSyncContractError extends TypeError {
  readonly code = "realtime-page-sync.invalid-contract" as const;
  readonly path: string;

  constructor(label: string, path = "/") {
    super(`${label} is invalid at ${path}`);
    this.name = "RealtimePageSyncContractError";
    this.path = path;
  }
}

function parseSchema<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const first = Value.Errors(schema, value).First();
    throw new RealtimePageSyncContractError(label, first?.path || "/");
  }
  return value as Static<T>;
}

export function parseRealtimePageSyncClientMessage(
  value: unknown,
): RealtimePageSyncClientMessageDto {
  const parsed = parseSchema(
    RealtimePageSyncClientMessageSchema,
    value,
    "realtime page-sync client message",
  );
  if (parsed.type === "sync") {
    const request = parsePageSyncRequest(parsed.request);
    if (request.requestId !== parsed.requestId) {
      throw new RealtimePageSyncContractError("realtime page-sync request identity");
    }
    return { ...parsed, request };
  }
  return parsed;
}

export function parseRealtimePageSyncServerMessage(
  value: unknown,
): RealtimePageSyncServerMessageDto {
  const parsed = parseSchema(
    RealtimePageSyncServerMessageSchema,
    value,
    "realtime page-sync server message",
  );
  if (parsed.type === "sync-result") {
    const response = parsePageSyncResponse(parsed.response);
    if (response.requestId !== parsed.requestId) {
      throw new RealtimePageSyncContractError("realtime page-sync response identity");
    }
    if (response.pageId !== parsed.pageId) {
      throw new RealtimePageSyncContractError("realtime page-sync page identity");
    }
    return { ...parsed, response };
  }
  return parsed;
}

function parseFrame<T>(frame: string, parse: (value: unknown) => T, label: string): T {
  if (new TextEncoder().encode(frame).byteLength > MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES) {
    throw new RealtimePageSyncContractError(`${label} frame bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(frame) as unknown;
  } catch {
    throw new RealtimePageSyncContractError(`${label} frame JSON`);
  }
  return parse(value);
}

export function parseRealtimePageSyncClientFrame(frame: string): RealtimePageSyncClientMessageDto {
  return parseFrame(frame, parseRealtimePageSyncClientMessage, "realtime page-sync client");
}

export function parseRealtimePageSyncServerFrame(frame: string): RealtimePageSyncServerMessageDto {
  return parseFrame(frame, parseRealtimePageSyncServerMessage, "realtime page-sync server");
}
