/**
 * Structured safe logging (T091, T123).
 *
 * Request logging never records private content: page-document bodies,
 * file bytes, item names, and payload fields are redacted. Only stable
 * identifiers, routes, status codes, and safe error codes are logged. Human
 * presentation is selected only for a TTY (or an explicit override); a
 * container receives newline-delimited JSON without ANSI decoration.
 */
import process from "node:process";
import type { Writable } from "node:stream";
import pino, { type Logger } from "pino";
import pinoPretty from "pino-pretty";

export const LOG_COLOR_MODES = ["auto", "always", "never"] as const;
export type LogColorMode = (typeof LOG_COLOR_MODES)[number];

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface RegisterLoggingOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  /** Test seam; production always defaults to process.stdout. */
  readonly destination?: Writable;
}

export interface SafeLoggerOptions {
  level: LogLevel;
  base: { service: "api"; environment: string };
  redact: { paths: string[]; censor: string };
  serializers: {
    req(request: { method: string; url: string; id?: unknown }): Record<string, unknown>;
    res(reply: { statusCode: number }): Record<string, unknown>;
  };
  stream?: Writable;
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
  "query",
  "title",
  "snippet",
  "results[*].title",
  "results[*].snippet",
  "err.config",
];

function configuredValue<T extends string>(
  variable: string,
  rawValue: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = rawValue ?? fallback;
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${variable} must be one of: ${allowed.join(", ")}`);
}

export function registerLogging(options: RegisterLoggingOptions = {}): SafeLoggerOptions {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const level = configuredValue(
    "MYOWNNOTION_LOG_LEVEL",
    env["MYOWNNOTION_LOG_LEVEL"],
    LOG_LEVELS,
    "info",
  );
  const colorMode = configuredValue(
    "MYOWNNOTION_LOG_COLOR",
    env["MYOWNNOTION_LOG_COLOR"],
    LOG_COLOR_MODES,
    "auto",
  );
  const humanOutput = colorMode === "always" || isTTY;
  const colorize = colorMode === "always" || (colorMode === "auto" && isTTY);

  const configuration: SafeLoggerOptions = {
    level,
    base: {
      service: "api",
      environment: env["NODE_ENV"] ?? "development",
    },
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[redacted]",
    },
    serializers: {
      req(request: { method: string; url: string; id?: unknown }) {
        // Query strings are never operational metadata. Dropping them here
        // also protects malformed or legacy GET attempts that never reach the
        // POST-only search route but would otherwise be logged by Fastify.
        return { method: request.method, url: request.url.split("?", 1)[0], id: request.id };
      },
      res(reply: { statusCode: number }) {
        return { statusCode: reply.statusCode };
      },
    },
  };

  if (humanOutput) {
    configuration.stream = pinoPretty({
      colorize,
      colorizeObjects: colorize,
      levelFirst: true,
      singleLine: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      destination: options.destination ?? process.stdout,
      sync: true,
    });
  } else if (options.destination) {
    configuration.stream = options.destination;
  }

  return configuration;
}

/**
 * Logger for API-owned processes that do not instantiate Fastify, such as the
 * one-shot Compose migration job. It deliberately shares every option with
 * request logging so a new entrypoint cannot drift into a second policy.
 */
export function createApplicationLogger(options: RegisterLoggingOptions = {}): Logger {
  const { stream, ...configuration } = registerLogging(options);
  return stream ? pino(configuration, stream) : pino(configuration);
}
