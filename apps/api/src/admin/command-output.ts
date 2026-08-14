/**
 * What the protected local CLI prints, and what it refuses to print
 * (T086, US5, FR-019 – FR-021, FR-023).
 *
 * This tool runs on the host, as whoever can already reach the mounted
 * deployment key. That makes it the most powerful surface in the system, and
 * its output the easiest place for key material to escape — into a terminal
 * scrollback, a CI log, a support ticket, a screenshot.
 *
 * So redaction lives here rather than at each call site. A command produces a
 * plain object; this module decides what leaves the process. A new command
 * cannot leak by forgetting to redact, because it never gets the chance.
 */

import { redact } from "@myownnotion/domain";

/**
 * Exit codes, fixed by contract.
 *
 * Distinct codes rather than a single failure, because the caller is usually a
 * script deciding what to do next: a misuse is worth failing a pipeline over,
 * an unavailable key is worth retrying, and a refusal is worth stopping for.
 */
export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  refused: 3,
  keyUnavailable: 4,
  integrityFailure: 5,
  conflict: 6,
  unexpected: 7,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface CommandResult {
  readonly code: ExitCode;
  /** Structured payload. Passed through redaction before it is printed. */
  readonly data?: Record<string, unknown>;
  /** One line for a human. Never carries values, only what happened. */
  readonly message?: string;
}

export interface RenderOptions {
  readonly json: boolean;
}

/**
 * Renders a result for printing.
 *
 * Both formats go through the same redaction. A JSON envelope that leaked what
 * the text form hid would be the worse failure of the two, because JSON is
 * what gets piped into a file and kept.
 */
export function renderResult(result: CommandResult, options: RenderOptions): string {
  const redacted =
    result.data === undefined ? undefined : (redact(result.data) as Record<string, unknown>);

  if (options.json) {
    return JSON.stringify({
      ok: result.code === EXIT_CODES.ok,
      code: result.code,
      ...(result.message === undefined ? {} : { message: result.message }),
      ...(redacted === undefined ? {} : { data: redacted }),
    });
  }

  const lines: string[] = [];
  if (result.message !== undefined) {
    lines.push(result.message);
  }
  if (redacted !== undefined) {
    for (const [key, value] of Object.entries(redacted)) {
      lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
  }
  return lines.join("\n");
}

/** The one place a failure becomes an exit code. */
export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof Error) {
    switch (error.name) {
      case "KeyUnavailableError":
        return EXIT_CODES.keyUnavailable;
      case "SecurityRepositoryError":
        return EXIT_CODES.integrityFailure;
      case "RotationRepositoryError":
        return EXIT_CODES.conflict;
      case "CommandUsageError":
        return EXIT_CODES.usage;
      default:
        return EXIT_CODES.unexpected;
    }
  }
  return EXIT_CODES.unexpected;
}
