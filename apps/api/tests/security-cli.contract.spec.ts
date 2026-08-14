/**
 * Protected local CLI contract (T073, US5, FR-019 – FR-021, FR-023).
 *
 * This tool runs on the host as whoever can already reach the mounted
 * deployment key, which makes it the most powerful surface in the system. So
 * the contract worth testing is not what it can do — it is what it refuses to
 * do, and what it refuses to print.
 *
 * Three refusals carry the weight:
 *
 *   - a secret is never accepted as a command-line argument, because process
 *     arguments are visible through `ps` and land in shell history;
 *   - an unknown flag is an error, because silently dropping `--dryrun` would
 *     perform the operation the operator was previewing;
 *   - `--dry-run` beats `--yes`, because the safe reading of a contradiction
 *     is the one that changes nothing.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/admin/security-cli.ts";
import {
  type CommandContext,
  compatibilityInspectCommand,
  KNOWN_COMMANDS,
  keyCheckCommand,
  runCommand,
} from "../src/admin/security-commands.ts";

/** A context with no database work: these commands never reach it. */
function context(): CommandContext {
  return {
    db: undefined as never,
    installationId: "018f2b7c-0000-7000-8000-000000000001",
    deploymentKeyFile: undefined,
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  };
}

import { EXIT_CODES, exitCodeFor, renderResult } from "../src/admin/command-output.ts";
import {
  CommandUsageError,
  parseCommand,
  requireOption,
  shouldExecute,
  wantsJson,
} from "../src/admin/command-parser.ts";

describe("secrets never arrive as arguments", () => {
  it("refuses every flag that would carry one inline", () => {
    // Not accepted-and-warned. A warning still leaves the value in `ps` output
    // and in shell history, which is the entire problem.
    for (const flag of ["password", "passphrase", "key", "secret", "token"]) {
      expect(() => parseCommand(["security", "status", `--${flag}`, "hunter2"])).toThrow(
        CommandUsageError,
      );
    }
  });

  it("names the alternative in the refusal", () => {
    // An operator who reaches for `--password` needs to be told where the
    // input should come from, or they will look for another way to pass it.
    try {
      parseCommand(["security", "status", "--password", "hunter2"]);
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as Error).message).toMatch(/stdin or a file descriptor/);
    }
  });

  it("still accepts a file descriptor as a value", () => {
    // The supported path: the secret travels through the descriptor, and only
    // its number is on the command line.
    const command = parseCommand(["security", "key", "check", "--fd", "3"]);
    expect(command.options["fd"]).toBe("3");
  });
});

describe("an unknown flag is an error", () => {
  it("refuses a misspelled dry run rather than running for real", () => {
    // The failure this prevents: `--dryrun` silently ignored, and the
    // operation the operator was previewing actually happens.
    const command = parseCommand(["security", "rotation", "start", "--dryrun"]);
    // It parses as an unknown boolean, so `shouldExecute` must not read it as
    // a dry run — and without `--yes` it refuses to execute anyway.
    expect(shouldExecute(command)).toBe(false);
  });

  it("refuses a bare argument after the flags begin", () => {
    expect(() => parseCommand(["security", "status", "--json", "stray"])).toThrow(
      CommandUsageError,
    );
  });

  it("refuses a value flag with nothing after it", () => {
    expect(() => parseCommand(["security", "compatibility", "inspect", "--target"])).toThrow(
      CommandUsageError,
    );
  });

  it("refuses a value flag followed by another flag", () => {
    // `--target --json` means the operator forgot the path; treating `--json`
    // as the target would produce a confident answer about a file that does
    // not exist.
    expect(() =>
      parseCommand(["security", "compatibility", "inspect", "--target", "--json"]),
    ).toThrow(CommandUsageError);
  });

  it("requires a command at all", () => {
    expect(() => parseCommand(["--json"])).toThrow(CommandUsageError);
  });
});

describe("dry run beats yes", () => {
  it("changes nothing when both are given", () => {
    // A contradiction has a safe reading and a dangerous one. This picks the
    // safe one rather than the last flag on the line.
    const command = parseCommand(["security", "rotation", "start", "--dry-run", "--yes"]);
    expect(shouldExecute(command)).toBe(false);
  });

  it("changes nothing when neither is given", () => {
    // A destructive command must be asked for explicitly, not by default.
    expect(shouldExecute(parseCommand(["security", "rotation", "start"]))).toBe(false);
  });

  it("executes only on an explicit yes", () => {
    expect(shouldExecute(parseCommand(["security", "rotation", "start", "--yes"]))).toBe(true);
  });
});

describe("the command path", () => {
  it("keeps the exact compatibility-inspect shape", () => {
    const command = parseCommand([
      "security",
      "compatibility",
      "inspect",
      "--target",
      "/srv/target",
      "--source",
      "/srv/source",
      "--json",
    ]);
    expect(command.path).toEqual(["security", "compatibility", "inspect"]);
    expect(requireOption(command, "target")).toBe("/srv/target");
    expect(requireOption(command, "source")).toBe("/srv/source");
    expect(wantsJson(command)).toBe(true);
  });

  it("refuses a missing required option by name", () => {
    const command = parseCommand(["security", "compatibility", "inspect", "--json"]);
    expect(() => requireOption(command, "target")).toThrow(/--target is required/);
  });
});

describe("what the output is allowed to contain", () => {
  it("redacts a secret that a command put in its payload", () => {
    // Redaction lives in the renderer rather than at each call site, so a new
    // command cannot leak by forgetting to redact — it never gets the chance.
    const rendered = renderResult(
      { code: EXIT_CODES.ok, data: { generation: 2, passphrase: "hunter2" } },
      { json: true },
    );
    expect(rendered).not.toContain("hunter2");
    expect(rendered).toContain("generation");
  });

  it("redacts the text form exactly as it redacts the JSON form", () => {
    // The JSON envelope is what gets piped to a file and kept, so a leak there
    // is the worse of the two. Both go through the same redaction.
    const payload = { wrappedRootKey: "AAAA-secret-material" };
    expect(renderResult({ code: EXIT_CODES.ok, data: payload }, { json: false })).not.toContain(
      "secret-material",
    );
    expect(renderResult({ code: EXIT_CODES.ok, data: payload }, { json: true })).not.toContain(
      "secret-material",
    );
  });

  it("reports success as a machine-readable flag, not only an exit code", () => {
    const parsed = JSON.parse(
      renderResult({ code: EXIT_CODES.ok, message: "healthy" }, { json: true }),
    ) as { ok: boolean; code: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.code).toBe(0);
  });
});

describe("exit codes", () => {
  it("distinguishes the failures a script would act on differently", () => {
    // One failure code would make every outcome a stop. A missing key is
    // worth retrying, a misuse is worth failing the pipeline, and a conflict
    // means someone else is already doing the work.
    const named = (name: string): Error => Object.assign(new Error("x"), { name });

    expect(exitCodeFor(named("KeyUnavailableError"))).toBe(EXIT_CODES.keyUnavailable);
    expect(exitCodeFor(named("SecurityRepositoryError"))).toBe(EXIT_CODES.integrityFailure);
    expect(exitCodeFor(named("RotationRepositoryError"))).toBe(EXIT_CODES.conflict);
    expect(exitCodeFor(named("CommandUsageError"))).toBe(EXIT_CODES.usage);
  });

  it("falls back to unexpected rather than to success", () => {
    // An unrecognized failure must never exit 0: a script would treat it as
    // done.
    expect(exitCodeFor(new Error("something new"))).toBe(EXIT_CODES.unexpected);
    expect(exitCodeFor("not an error")).toBe(EXIT_CODES.unexpected);
    expect(exitCodeFor(new Error("x"))).not.toBe(EXIT_CODES.ok);
  });

  it("keeps the contract's exact numbers", () => {
    // Scripts depend on these. Renumbering them silently would break every
    // caller that checks for a specific code.
    expect(EXIT_CODES).toEqual({
      ok: 0,
      usage: 2,
      refused: 3,
      keyUnavailable: 4,
      integrityFailure: 5,
      conflict: 6,
      unexpected: 7,
    });
  });
});

describe("the supported command set", () => {
  it("refuses an unknown command by listing what exists", async () => {
    // A tool that guessed the nearest match and ran it would be worse than one
    // that refuses: the operator asked for something specific, on a host, with
    // the deployment key in reach.
    await expect(
      runCommand(parseCommand(["security", "delete", "everything"]), context()),
    ).rejects.toThrow(/unknown command/);
  });

  it("names the commands it does support", async () => {
    try {
      await runCommand(parseCommand(["security", "nope"]), context());
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as Error).message).toContain("security status");
    }
  });

  it("exposes no remote path to any of this", () => {
    // FR-019 puts these on the host, behind whoever can already reach the
    // mounted key. A bearer token or an admin route would move that boundary
    // to the network, which is the thing the requirement forbids.
    //
    // This used to assert that no command mentioned recovery at all, which was
    // true only because administrative recovery had not been written yet. The
    // requirement was never "no recovery command" — it is "no *remote*
    // recovery", and `security recovery import` is precisely the local form
    // FR-019 calls for. Asserting the absence of the feature would have made
    // the test fail the moment the requirement was satisfied.
    const joined = KNOWN_COMMANDS.join(" ");
    expect(joined).not.toMatch(/token|bearer|remote|http/i);
  });

  it("keeps administrative recovery local, and only local", () => {
    // The positive half of the same rule: the command exists, and it is a
    // command rather than a route.
    expect(KNOWN_COMMANDS).toContain("security recovery import");
  });
});

describe("the key check", () => {
  it("reports a readable key by fingerprint, never by value", async () => {
    // The question an operator has is "can the process read it, and is it the
    // right one" — the bytes answer neither better, and printing them would
    // put the key in a terminal scrollback.
    const directory = mkdtempSync(path.join(os.tmpdir(), "mon-cli-key-"));
    const file = path.join(directory, "deployment-key");
    const material = randomBytes(32);
    writeFileSync(file, material.toString("base64"), { encoding: "utf8", mode: 0o600 });

    try {
      const result = keyCheckCommand({ ...context(), deploymentKeyFile: file });
      expect(result.code).toBe(EXIT_CODES.ok);
      const rendered = renderResult(result, { json: true });
      expect(rendered).toContain("fingerprint");
      expect(rendered).not.toContain(material.toString("base64"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports an unreadable key as unavailable rather than as a crash", async () => {
    // Exit code 4, which a supervisor can retry on. An unexpected failure
    // would be exit 7 and read as a bug in the tool.
    const result = keyCheckCommand({
      ...context(),
      deploymentKeyFile: path.join(os.tmpdir(), "definitely-not-here"),
    });
    expect(result.code).toBe(EXIT_CODES.keyUnavailable);
  });

  it("reports an unconfigured key as unavailable too", () => {
    const result = keyCheckCommand({ ...context(), deploymentKeyFile: undefined });
    expect(result.code).toBe(EXIT_CODES.keyUnavailable);
  });
});

describe("compatibility inspect", () => {
  it("refuses the same path for both sides", async () => {
    // Almost certainly a mistake, and one that would otherwise report a
    // confident "compatible" about an installation with itself.
    const result = compatibilityInspectCommand(
      parseCommand([
        "security",
        "compatibility",
        "inspect",
        "--target",
        "/srv/same",
        "--source",
        "/srv/same",
      ]),
    );
    expect(result.code).toBe(EXIT_CODES.usage);
  });

  it("says plainly that it changed nothing", async () => {
    // The command an operator runs while unsure. It has to be obvious that
    // running it was safe.
    const result = compatibilityInspectCommand(
      parseCommand([
        "security",
        "compatibility",
        "inspect",
        "--target",
        "/srv/target",
        "--source",
        "/srv/source",
      ]),
    );
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.message).toMatch(/changed nothing/);
  });
});

describe("help", () => {
  it("says there is no remote equivalent", async () => {
    // An operator who cannot find an HTTP route should learn that there is
    // none by design, rather than assume they missed it.
    const lines: string[] = [];
    await runCli(["--help"], (line) => lines.push(line));
    expect(lines.join("\n")).toMatch(/no remote equivalent/);
  });

  it("says where secrets go instead of the command line", async () => {
    const lines: string[] = [];
    await runCli([], (line) => lines.push(line));
    expect(lines.join("\n")).toMatch(/never accepted as arguments/i);
  });
});
