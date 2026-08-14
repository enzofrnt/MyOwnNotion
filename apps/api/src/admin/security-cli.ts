/**
 * The protected local CLI entry point (T086, US5, FR-019 – FR-021).
 *
 * Deliberately thin: parse, run, render, exit. Everything that could be got
 * wrong lives in the three modules beside this one, where it is testable
 * without spawning a process.
 *
 * The one thing this file owns is the guarantee that **nothing leaves except
 * through the renderer**. A command that printed directly would bypass
 * redaction, so none of them can print at all — they return a result.
 */

import process from "node:process";
import { createDatabase } from "@myownnotion/database";
import { loadSecurityConfig } from "../security/security-config.ts";
import { type CommandResult, EXIT_CODES, exitCodeFor, renderResult } from "./command-output.ts";
import { parseCommand, wantsJson } from "./command-parser.ts";
import { type CommandContext, runCommand } from "./security-commands.ts";

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

export const HELP = `myownnotion security — protected local administration

Runs on the host, as whoever can already read the mounted deployment key.
There is no remote equivalent: these commands are not exposed over HTTP.

  security status                     installation and rotation state
  security key check                  whether the deployment key is readable
  security rotation status            both rotation policies
  security rotation wrapping-key      --new-key-file PATH; rewraps one root
                                      key per workspace under a new deployment
                                      key. Both files must be mounted: the old
                                      key unwraps, the new one rewraps.
  security rotation data-key          re-encrypts every protected record under
                                      a new generation. Long, resumable, and
                                      readable throughout: the old generation
                                      stays decrypt-only until you revoke it
                                      with --revoke-generation N.
  security compatibility inspect      --target PATH --source PATH

  --json        machine-readable envelope
  --dry-run     describe without acting; wins over --yes
  --yes         perform a destructive action

Secrets are never accepted as arguments. Use --fd N and write the value to
that file descriptor.`;

/**
 * Runs one invocation and returns its exit code.
 *
 * Separated from `main` so a test can drive it without a process, and so the
 * only `process.exit` in the tool is in one place.
 */
export async function runCli(
  argv: readonly string[],
  // Writes to stdout directly rather than through `console`, which the lint
  // gate forbids for good reason elsewhere: this is the one place where
  // printing *is* the output, and a test replaces it entirely.
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    print(HELP);
    return EXIT_CODES.ok;
  }

  let json = false;
  try {
    const command = parseCommand(argv);
    json = wantsJson(command);

    const config = loadSecurityConfig();
    const database = createDatabase(process.env["DATABASE_URL"] ?? "");
    const context: CommandContext = {
      db: database.db,
      installationId: INSTALLATION_ID,
      deploymentKeyFile: config.deploymentKeyFile,
      now: () => new Date(),
    };

    try {
      const result = await runCommand(command, context);
      print(renderResult(result, { json }));
      return result.code;
    } finally {
      await database.close();
    }
  } catch (error) {
    const code = exitCodeFor(error);
    const failure: CommandResult = {
      code,
      message: error instanceof Error ? error.message : "command failed",
    };
    // Through the renderer, like everything else: a failure path that printed
    // the raw error is exactly where an unredacted value would escape.
    print(renderResult(failure, { json }));
    return code;
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isDirectRun) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = EXIT_CODES.unexpected;
    });
}
