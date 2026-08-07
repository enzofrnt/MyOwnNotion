/**
 * Structured safe logging (T091).
 *
 * Request logging never records private content: page-document bodies,
 * file bytes, item names, and payload fields are redacted. Only stable
 * identifiers, routes, status codes, and safe error codes are logged.
 */
export interface SafeLoggerOptions {
  level: string;
  redact: { paths: string[]; censor: string };
  serializers: {
    req(request: { method: string; url: string; id?: unknown }): Record<string, unknown>;
    res(reply: { statusCode: number }): Record<string, unknown>;
  };
}

export const REDACT_PATHS = [
  "req.body",
  "req.headers.authorization",
  "req.headers.cookie",
  "body",
  "payload",
  "document",
  "name",
  "snapshot",
  "err.config",
];

export function registerLogging(): SafeLoggerOptions {
  return {
    level: process.env["LOG_LEVEL"] ?? "info",
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[redacted]",
    },
    serializers: {
      req(request: { method: string; url: string; id?: unknown }) {
        return { method: request.method, url: request.url, id: request.id };
      },
      res(reply: { statusCode: number }) {
        return { statusCode: reply.statusCode };
      },
    },
  };
}
