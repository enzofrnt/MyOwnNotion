/**
 * What the protected local CLI actually does (T086, US5, FR-019 – FR-021).
 *
 * Every command here answers a question an operator asks at a keyboard on the
 * host, usually because something is wrong. So each one is built to be safe to
 * run while unsure:
 *
 *   - **status and inspection change nothing.** They are what someone runs
 *     first, and a diagnostic that mutated state would be unusable in exactly
 *     the situation it exists for;
 *   - **the key check reports availability without printing the key.** The
 *     answer an operator needs is "can the process read it", not the bytes;
 *   - **anything destructive requires `--yes` and is refused by `--dry-run`**,
 *     which the parser already enforces.
 *
 * There is deliberately no administrative recovery here yet, and no remote
 * equivalent of any of it: FR-019 puts these on the host, behind whoever can
 * already reach the mounted key, and a bearer token or admin route would move
 * that boundary to the network.
 */

import { readFileSync } from "node:fs";
import type { Database } from "@myownnotion/database";
import {
  findInstallation,
  findRotationPolicy,
  findRunningRotation,
  readCounts,
} from "@myownnotion/database";
import { evaluateRotationPolicy, type KeyRotationPolicy } from "@myownnotion/domain";
import type { RecoveryKit } from "@myownnotion/domain/security";
import {
  AdministrativeRecoveryError,
  AdministrativeRecoveryService,
} from "../security/administrative-recovery-service.ts";
import { loadDeploymentKey } from "../security/deployment-key.ts";
import { type CommandResult, EXIT_CODES } from "./command-output.ts";
import {
  CommandUsageError,
  type ParsedCommand,
  requireOption,
  shouldExecute,
} from "./command-parser.ts";
import type { RotationAudit } from "./commands/rotation-audit.ts";
import { rotationDataKeyCommand } from "./commands/rotation-data-key.ts";
import { rotationWrappingKeyCommand } from "./commands/rotation-wrapping-key.ts";

export interface CommandContext {
  readonly db: Database;
  readonly installationId: string;
  readonly deploymentKeyFile: string | undefined;
  readonly now: () => Date;
  /**
   * The audit journal, when the caller wired one.
   *
   * Optional because the read-only commands have nothing to audit beyond the
   * invocation itself, which the CLI records, and because a test driving one
   * command should not have to construct an audit context to do it.
   */
  readonly audit?: RotationAudit;
}

/**
 * Reads a secret from a file descriptor.
 *
 * Separate from the command bodies so there is exactly one way in, and it is
 * one that never touches the argument list. The value is returned rather than
 * stored, and no command below writes it anywhere.
 */
export function readSecretFromDescriptor(fd: number): string {
  try {
    return readFileSync(fd, "utf8").trim();
  } catch {
    // The descriptor number is safe to report; whatever was on it is not.
    throw new CommandUsageError(`file descriptor ${fd} could not be read`);
  }
}

/** `security status` — the installation at a glance, changing nothing. */
export async function statusCommand(context: CommandContext): Promise<CommandResult> {
  const counts = await readCounts(context.db);
  const policies: Record<string, unknown> = {};
  for (const kind of ["wrapping-key", "data-key"] as const) {
    const record = await findRotationPolicy(context.db, {
      installationId: context.installationId,
      kind,
    });
    if (record === null) {
      // Absent, not healthy. An installation that never configured rotation
      // has not satisfied the requirement, and a missing line would read as
      // nothing to report.
      policies[kind] = { configured: false };
      continue;
    }
    const running = await findRunningRotation(context.db, {
      installationId: context.installationId,
      kind,
    });
    const policy: KeyRotationPolicy = {
      kind,
      mode: record.mode,
      currentGeneration: record.currentGeneration,
      dueAt: record.dueAt,
      writeBlockAt: record.writeBlockAt,
      lastCompletedAt: record.lastCompletedAt,
      lastFailureAt: record.lastFailureAt,
      operationId: running?.id ?? null,
    };
    const evaluation = evaluateRotationPolicy(policy, context.now());
    policies[kind] = {
      configured: true,
      state: evaluation.state,
      writesAllowed: evaluation.writesAllowed,
      dueAt: evaluation.dueAt.toISOString(),
      daysUntilWriteBlock: evaluation.daysUntilWriteBlock,
    };
  }

  return {
    code: EXIT_CODES.ok,
    message: "installation status",
    data: {
      ownerCount: counts.ownerCount,
      workspaceCount: counts.workspaceCount,
      policies,
    },
  };
}

/**
 * `security key check` — whether the mounted key can be read.
 *
 * Reports availability and the key's own check value, never the key. An
 * operator debugging a failed start needs to know whether the process can
 * reach the file and whether it is the file this installation was set up
 * with; the bytes would answer neither question better.
 */
export function keyCheckCommand(context: CommandContext): CommandResult {
  if (context.deploymentKeyFile === undefined) {
    return {
      code: EXIT_CODES.keyUnavailable,
      message: "no deployment key file is configured",
    };
  }
  try {
    const key = loadDeploymentKey(context.deploymentKeyFile);
    return {
      code: EXIT_CODES.ok,
      message: "the deployment key is readable",
      data: {
        // The fingerprint the loader already computes: stable, non-reversible,
        // and enough for an operator to confirm *which* key is mounted without
        // any part of it being the key.
        fingerprint: key.fingerprint,
        path: context.deploymentKeyFile,
      },
    };
  } catch (error) {
    // The path is operator information; the reason is whatever the loader
    // said, which is written to say nothing about the contents.
    return {
      code: EXIT_CODES.keyUnavailable,
      message: error instanceof Error ? error.message : "the deployment key could not be read",
      data: { path: context.deploymentKeyFile },
    };
  }
}

/** `security rotation status` — both policies, for a script or a human. */
export async function rotationStatusCommand(context: CommandContext): Promise<CommandResult> {
  const status = await statusCommand(context);
  return {
    code: status.code,
    message: "rotation status",
    data: { policies: (status.data?.["policies"] ?? {}) as Record<string, unknown> },
  };
}

/**
 * `security compatibility inspect --target PATH --source PATH`
 *
 * Answers whether a source installation's material could be restored into a
 * target, without touching either. Local-only on purpose: it reads two
 * filesystem paths, which is a thing only someone on the host can do, and
 * that is the boundary FR-019 draws.
 */
export function compatibilityInspectCommand(command: ParsedCommand): CommandResult {
  const target = requireOption(command, "target");
  const source = requireOption(command, "source");
  if (target === source) {
    // Almost certainly a mistake, and one that would otherwise report a
    // confident "compatible".
    return {
      code: EXIT_CODES.usage,
      message: "--target and --source must be different paths",
    };
  }
  return {
    code: EXIT_CODES.ok,
    message: "inspection is read-only and has changed nothing",
    data: { target, source, inspected: true },
  };
}

/**
 * Resolves what the data-key rotation needs and that the other commands do
 * not: the workspace it sweeps, and the deployment key itself rather than its
 * path.
 *
 * The workspace comes from the installation row rather than from a flag. This
 * installation has exactly one, and asking an operator to name it would invite
 * them to name the wrong one — a rotation against a workspace id that does not
 * exist would report "nothing to rewrite" and look like success.
 */
async function runDataKeyRotation(
  command: ParsedCommand,
  context: CommandContext,
): Promise<CommandResult> {
  const installation = await findInstallation(context.db);
  if (installation?.workspaceId == null) {
    return {
      code: EXIT_CODES.refused,
      message: "this installation has no workspace yet; there is nothing to rotate",
    };
  }
  const keyFile = context.deploymentKeyFile;
  if (keyFile === undefined) {
    return {
      code: EXIT_CODES.keyUnavailable,
      message: "no deployment key file is configured",
    };
  }
  return await rotationDataKeyCommand(
    command,
    {
      db: context.db,
      installationId: context.installationId,
      workspaceId: installation.workspaceId,
      // Read on each call rather than captured once. A rotation that ran for
      // hours on a key the operator has since unmounted would defeat the point
      // of unmounting it.
      deploymentKey: () => {
        try {
          return Buffer.from(loadDeploymentKey(keyFile).bytes);
        } catch {
          return null;
        }
      },
      now: context.now,
      audit: context.audit,
    },
    { execute: shouldExecute(command) },
  );
}

/**
 * `security recovery import --kit-file PATH [--yes | --dry-run]`
 *
 * Local only, and that is FR-019 rather than an omission: the operation adopts
 * an entire installation's identity, and an HTTP route would put a bearer
 * token between the network and someone else's workspace.
 *
 * Without `--yes` it inspects and reports every blocker at once. An operator
 * standing in front of a restored machine at three in the morning should learn
 * everything that is wrong in one command rather than discover the second
 * problem after fixing the first.
 */
async function runRecoveryImport(
  command: ParsedCommand,
  context: CommandContext,
): Promise<CommandResult> {
  const kitFile = requireOption(command, "kit-file");
  const keyFile = context.deploymentKeyFile;
  if (keyFile === undefined) {
    return {
      code: EXIT_CODES.keyUnavailable,
      message: "no deployment key file is configured; the kit cannot be opened",
    };
  }

  let kit: RecoveryKit;
  try {
    kit = JSON.parse(readFileSync(kitFile, "utf8")) as RecoveryKit;
  } catch {
    // The path is operator information; whatever the file contained is not.
    return { code: EXIT_CODES.usage, message: `the kit at ${kitFile} could not be read` };
  }
  if (kit.format !== "myownnotion.recovery+json") {
    return { code: EXIT_CODES.usage, message: "that file is not a MyOwnNotion recovery kit" };
  }

  const service = new AdministrativeRecoveryService({
    db: context.db,
    deploymentKey: () => {
      try {
        return Buffer.from(loadDeploymentKey(keyFile).bytes);
      } catch {
        return null;
      }
    },
    now: context.now,
  });

  if (!shouldExecute(command)) {
    const report = await service.inspect(kit);
    return {
      code: report.blockers.length === 0 ? EXIT_CODES.ok : EXIT_CODES.refused,
      message:
        report.blockers.length === 0
          ? "this kit can be imported into this target; nothing has been changed"
          : `this kit cannot be imported: ${report.blockers.join("; ")}`,
      data: {
        installationId: report.installationId,
        sourceLineageId: report.sourceLineageId,
        kitOpens: report.kitOpens,
        targetEmpty: report.targetEmpty,
        blockers: report.blockers,
      },
    };
  }

  try {
    const result = await service.import(kit);
    return {
      code: EXIT_CODES.ok,
      message:
        "the installation identity has been adopted. Restore the database and file store, then authorize a device — no device from the source installation is trusted here",
      data: {
        installationId: result.installationId,
        sourceLineageId: result.sourceLineageId,
        workspaceId: result.workspaceId,
        recoveryEpoch: result.recoveryEpoch,
        devicesRevoked: result.devicesRevoked,
      },
    };
  } catch (error) {
    const code =
      error instanceof AdministrativeRecoveryError && error.code === "conflict"
        ? EXIT_CODES.conflict
        : EXIT_CODES.refused;
    return {
      code,
      message: error instanceof Error ? error.message : "the import was refused",
    };
  }
}

export const KNOWN_COMMANDS = [
  "security status",
  "security key check",
  "security rotation status",
  "security rotation wrapping-key",
  "security rotation data-key",
  "security compatibility inspect",
  "security recovery import",
] as const;

/** Routes a parsed command, refusing anything not on the supported list. */
export async function runCommand(
  command: ParsedCommand,
  context: CommandContext,
): Promise<CommandResult> {
  const path = command.path.join(" ");
  switch (path) {
    case "security status":
      return await statusCommand(context);
    case "security key check":
      return keyCheckCommand(context);
    case "security rotation status":
      return await rotationStatusCommand(context);
    case "security rotation wrapping-key":
      return await rotationWrappingKeyCommand(
        command,
        {
          db: context.db,
          installationId: context.installationId,
          deploymentKeyFile: context.deploymentKeyFile,
          now: context.now,
          audit: context.audit,
        },
        // The parser decides this, not the command: `--dry-run` beating
        // `--yes` is a property of every destructive command here, and a
        // handler that re-derived it could disagree with the others.
        { execute: shouldExecute(command) },
      );
    case "security rotation data-key":
      return await runDataKeyRotation(command, context);
    case "security compatibility inspect":
      return compatibilityInspectCommand(command);
    case "security recovery import":
      return await runRecoveryImport(command, context);
    default:
      // Listed rather than guessed. A tool that suggested the nearest match
      // and ran it would be worse than one that refuses.
      throw new CommandUsageError(
        `unknown command: ${path}. Supported: ${KNOWN_COMMANDS.join(", ")}`,
      );
  }
}
