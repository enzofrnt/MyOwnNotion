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
import { type AuditContext, AuditService, newCorrelationId } from "../security/audit-service.ts";
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
  security recovery import            --kit-file PATH; adopts a source
                                      installation's identity into an EMPTY
                                      target. Refuses anything else. No device
                                      from the source is trusted afterwards.
  security compatibility inspect      --target PATH --source PATH

  --json        machine-readable envelope
  --dry-run     describe without acting; wins over --yes
  --yes         perform a destructive action

Secrets are never accepted as arguments. Use --fd N and write the value to
that file descriptor.`;

/**
 * Runs one invocation and returns its exit code.
 *
 * Kept as a side-effect-free command implementation so tests and the outer
 * admin dispatcher can drive it without starting a second CLI entrypoint.
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
    // One correlation ID for the whole invocation, so every row a command
    // writes — the rotation events as well as the command event itself —
    // joins back to the single moment an operator typed something.
    const correlationId = newCorrelationId();
    const audit = new AuditService(database.db);
    const auditContext: AuditContext = {
      installationId: INSTALLATION_ID,
      correlationId,
      // Never `owner`. These run on the host, as whoever can already read the
      // mounted key, and recording them otherwise would blur the one boundary
      // FR-019 draws.
      actorClass: "hosting-admin",
    };
    const context: CommandContext = {
      db: database.db,
      installationId: INSTALLATION_ID,
      deploymentKeyFile: config.deploymentKeyFile,
      now: () => new Date(),
      audit: { audit, context: auditContext },
    };

    try {
      const result = await runCommand(command, context);
      print(renderResult(result, { json }));
      // Best-effort and after the fact: the command has already run, and
      // failing to record it must not change its outcome. The command *path*
      // is recorded, never the arguments — a path is a fixed vocabulary,
      // arguments are whatever someone typed.
      await audit.record(auditContext, {
        eventType:
          result.code === EXIT_CODES.ok
            ? "admin.cli-command-executed"
            : "admin.cli-command-refused",
        outcome: result.code === EXIT_CODES.ok ? "success" : "refused",
        objectKind: "cli-command",
        objectId: command.path.join(" "),
        metadata: { exitCode: result.code },
      });
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
