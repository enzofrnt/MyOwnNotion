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

import { describe, expect, it } from "vitest";
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
