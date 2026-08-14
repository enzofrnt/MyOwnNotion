/**
 * Parsing the protected local CLI's arguments (T086, US5, FR-019 – FR-021).
 *
 * Two rules shape this module, and both are about what an argument list is
 * allowed to contain.
 *
 * **A secret never arrives as an argument.** Process arguments are visible to
 * every other process on the host through `ps`, land in shell history, and are
 * captured by any supervisor that logs the command line. So a passphrase or a
 * key is read from stdin or a file descriptor, and a flag that looks like it
 * would accept one inline is refused rather than quietly honoured.
 *
 * **An unknown flag is an error, not something to ignore.** A tool that
 * silently drops `--dryrun` because it expected `--dry-run` would perform the
 * operation the operator was trying to preview.
 */

export class CommandUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandUsageError";
  }
}

export interface ParsedCommand {
  /** e.g. `["security", "compatibility", "inspect"]`. */
  readonly path: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
}

/** Flags that take a value; everything else is a boolean switch. */
const VALUE_FLAGS = new Set([
  "target",
  "source",
  "generation",
  "kind",
  "reason",
  "fd",
  // A *path*, not a key. The file is loaded under the same permission rules as
  // the mounted deployment key, which is the whole reason the new key arrives
  // as a file rather than as a value.
  "new-key-file",
  "revoke-generation",
]);

/** Flags a caller might reach for to pass a secret inline. Always refused. */
const SECRET_FLAGS = new Set(["password", "passphrase", "key", "secret", "token"]);

export function parseCommand(argv: readonly string[]): ParsedCommand {
  const path: string[] = [];
  const options: Record<string, string | boolean> = {};
  let index = 0;

  // Everything before the first flag is the command path.
  while (index < argv.length && !argv[index]?.startsWith("-")) {
    path.push(argv[index] as string);
    index += 1;
  }
  if (path.length === 0) {
    throw new CommandUsageError("a command is required");
  }

  while (index < argv.length) {
    const token = argv[index] as string;
    if (!token.startsWith("--")) {
      throw new CommandUsageError(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name.length === 0) {
      throw new CommandUsageError("empty flag");
    }
    if (SECRET_FLAGS.has(name)) {
      // Refused rather than accepted-and-warned. A warning still leaves the
      // secret in `ps` output and shell history, which is the whole problem.
      throw new CommandUsageError(
        `--${name} is not accepted: secrets are read from stdin or a file descriptor, never from the command line`,
      );
    }
    if (VALUE_FLAGS.has(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CommandUsageError(`--${name} requires a value`);
      }
      options[name] = value;
      index += 2;
      continue;
    }
    options[name] = true;
    index += 1;
  }

  return { path, options };
}

/** Whether the caller asked for machine-readable output. */
export function wantsJson(command: ParsedCommand): boolean {
  return command.options["json"] === true;
}

/**
 * Whether a destructive command may proceed.
 *
 * `--dry-run` wins over `--yes` when both are given. The pair is
 * contradictory, and the safe reading of a contradiction is the one that
 * changes nothing.
 */
export function shouldExecute(command: ParsedCommand): boolean {
  if (command.options["dry-run"] === true) {
    return false;
  }
  return command.options["yes"] === true;
}

export function requireOption(command: ParsedCommand, name: string): string {
  const value = command.options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new CommandUsageError(`--${name} is required`);
  }
  return value;
}
