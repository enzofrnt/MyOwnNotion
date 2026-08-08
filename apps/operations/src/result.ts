import { isOperationsCommand, type OperationsCommand } from "./cli.ts";

export type OperationState = "running" | "succeeded" | "failed";

export interface SafeOperationResult {
  readonly operationId: string;
  readonly command: OperationsCommand;
  readonly status: OperationState;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly snapshotId?: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly failureCode: string | null;
  readonly findings?: readonly SafeAuditFinding[];
}

export interface SafeAuditFinding {
  readonly kind: "referenced" | "missing" | "mismatched" | "temporary" | "unreferenced";
  readonly safeId: string;
  readonly lengthMatches?: boolean;
  readonly digestMatches?: boolean;
}

export interface SafeOperationResultInput {
  readonly operationId: unknown;
  readonly command: unknown;
  readonly status: unknown;
  readonly startedAt: unknown;
  readonly finishedAt: unknown;
  readonly snapshotId?: unknown;
  readonly counts: unknown;
  readonly failureCode: unknown;
  readonly findings?: unknown;
  readonly [privateField: string]: unknown;
}

function safeFindings(value: unknown): readonly SafeAuditFinding[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new RangeError("operation findings are invalid");
  }
  return value.map((finding) => {
    if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
      throw new TypeError("operation finding is invalid");
    }
    const candidate = finding as Record<string, unknown>;
    if (
      (candidate["kind"] !== "referenced" &&
        candidate["kind"] !== "missing" &&
        candidate["kind"] !== "mismatched" &&
        candidate["kind"] !== "temporary" &&
        candidate["kind"] !== "unreferenced") ||
      typeof candidate["safeId"] !== "string" ||
      !/^[a-f0-9]{24}$/.test(candidate["safeId"])
    ) {
      throw new TypeError("operation finding is invalid");
    }
    const lengthMatches = candidate["lengthMatches"];
    const digestMatches = candidate["digestMatches"];
    if (
      (lengthMatches !== undefined && typeof lengthMatches !== "boolean") ||
      (digestMatches !== undefined && typeof digestMatches !== "boolean")
    ) {
      throw new TypeError("operation finding comparison is invalid");
    }
    return {
      kind: candidate["kind"],
      safeId: candidate["safeId"],
      ...(lengthMatches === undefined ? {} : { lengthMatches }),
      ...(digestMatches === undefined ? {} : { digestMatches }),
    };
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9.-]{0,127}$/;
const SAFE_COUNT_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;

function isoDate(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) {
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("operation timestamp is invalid");
  }
  return new Date(value).toISOString();
}

function safeCounts(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("operation counts are invalid");
  }
  const entries = Object.entries(value);
  if (entries.length > 32) {
    throw new RangeError("operation counts are too large");
  }
  const result: Record<string, number> = {};
  for (const [key, count] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !SAFE_COUNT_PATTERN.test(key) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new TypeError("operation count is invalid");
    }
    result[key] = count;
  }
  return result;
}

/** Picks only contract-approved fields; arbitrary process/config fields are dropped. */
export function createSafeOperationResult(input: SafeOperationResultInput): SafeOperationResult {
  if (typeof input.operationId !== "string" || !UUID_PATTERN.test(input.operationId)) {
    throw new TypeError("operation identity is invalid");
  }
  if (typeof input.command !== "string" || !isOperationsCommand(input.command)) {
    throw new TypeError("operation command is invalid");
  }
  if (input.status !== "running" && input.status !== "succeeded" && input.status !== "failed") {
    throw new TypeError("operation state is invalid");
  }
  const status: OperationState = input.status;
  if (
    input.failureCode !== null &&
    (typeof input.failureCode !== "string" || !SAFE_CODE_PATTERN.test(input.failureCode))
  ) {
    throw new TypeError("operation failure code is invalid");
  }
  if (
    input.snapshotId !== undefined &&
    (typeof input.snapshotId !== "string" || !/^[a-f0-9]{8,64}$/.test(input.snapshotId))
  ) {
    throw new TypeError("snapshot identity is invalid");
  }
  const findings = safeFindings(input.findings);
  const common = {
    operationId: input.operationId,
    command: input.command,
    status,
    startedAt: isoDate(input.startedAt, false) as string,
    finishedAt: isoDate(input.finishedAt, true),
    counts: safeCounts(input.counts),
    failureCode: input.failureCode,
  };
  const result =
    input.snapshotId === undefined ? common : { ...common, snapshotId: input.snapshotId };
  return findings === undefined ? result : { ...result, findings };
}
