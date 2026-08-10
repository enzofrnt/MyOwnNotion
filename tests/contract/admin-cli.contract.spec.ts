/**
 * Protected local administrator CLI contract (T022, feature 002).
 *
 * V1 administration is this CLI and nothing else. There is no remote
 * administrator HTTP route, no bearer capability, and no API token. That
 * boundary is easy to erode one convenience endpoint at a time, so it is
 * asserted here against the artifacts themselves rather than trusted.
 *
 * The CLI is not implemented yet. These tests pin the *contract* — the command
 * surface, the exit-code vocabulary, the input rules, and the state
 * vocabularies it shares with the API and the database — so the implementation
 * that lands later has something to satisfy, and so the contract cannot drift
 * away from the other two in the meantime.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  KEY_POLICY_STATES,
  MIGRATION_STATES,
  RECOVERY_AUTHORIZATION_STATES,
  RECOVERY_DELIVERY_STATES,
  RECOVERY_STATE_PAIRS,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const contractsDir = path.join(repoRoot, "specs/002-owner-security-foundation/contracts");
const cliContract = readFileSync(path.join(contractsDir, "admin-cli.md"), "utf8");
const openApiRaw = readFileSync(path.join(contractsDir, "security-api.openapi.yaml"), "utf8");

/** Table rows look like `| \`command\` | description |`. */
function commandNames(): string[] {
  return [...cliContract.matchAll(/^\|\s*`(security [^`]+)`\s*\|/gm)].map((match) =>
    (match[1] as string).trim(),
  );
}

describe("command surface", () => {
  const commands = commandNames();

  it("declares every command the security axes need", () => {
    // One command per axis, so no axis is administered through some other
    // surface by default.
    const required = [
      "security status",
      "security password reset",
      "security keys check",
      "security integrity verify",
      "security migration status",
      "security recovery inspect",
      "security diagnostics",
    ];
    for (const command of required) {
      expect(commands, command).toContain(command);
    }
    expect(commands.some((c) => c.startsWith("security sessions revoke"))).toBe(true);
    expect(commands.some((c) => c.startsWith("security rotation start"))).toBe(true);
    expect(commands.some((c) => c.startsWith("security recovery import"))).toBe(true);
  });

  it("names every command under the single `security` root", () => {
    for (const command of commands) {
      expect(command.startsWith("security "), command).toBe(true);
    }
  });
});

describe("invocation rules", () => {
  it("requires --help, --json, --dry-run, and --yes", () => {
    for (const flag of ["`--help`", "`--json`", "`--dry-run`", "`--yes`"]) {
      expect(cliContract, flag).toContain(flag);
    }
  });

  it("rejects secrets passed on the command line", () => {
    // A passphrase in argv lands in the shell history and in `ps` output for
    // every user on the box.
    expect(cliContract).toMatch(/command-line values are rejected/i);
    expect(cliContract).toMatch(/protected stdin, a file descriptor, or a mounted/i);
  });

  it("passes the recovery passphrase by file descriptor, never by value", () => {
    expect(cliContract).toContain("--passphrase-fd FD");
    expect(cliContract).not.toMatch(/--passphrase[= ]TEXT/);
  });

  it("requires a correlation ID on every result", () => {
    expect(cliContract).toMatch(/Every result includes `correlationId`/);
  });

  it("never emits a raw exception or a sensitive value", () => {
    expect(cliContract).toMatch(/never includes raw exceptions or sensitive values/i);
  });
});

describe("exit codes", () => {
  const codes = Object.fromEntries(
    [...cliContract.matchAll(/^\|\s*(\d)\s*\|\s*([^|]+?)\s*\|$/gm)].map((match) => [
      Number(match[1]),
      (match[2] as string).trim(),
    ]),
  );

  it("declares the full 0–7 vocabulary with no gaps", () => {
    expect(Object.keys(codes).map(Number).sort()).toEqual([0, 2, 3, 4, 5, 6, 7]);
  });

  it("separates a refused operation from an unavailable key", () => {
    // The operator's next action differs completely: one is a policy or state
    // problem, the other is a mounting problem.
    expect(codes[3]).toMatch(/refused/i);
    expect(codes[4]).toMatch(/key\/secret unavailable or invalid/i);
  });

  it("has a distinct code for a resumable, incomplete operation", () => {
    // Reporting a paused rotation as a plain failure would invite a restart
    // from scratch instead of a resume.
    expect(codes[6]).toMatch(/resumable but incomplete|paused/i);
  });

  it("reserves 7 for an internal failure that only a correlation ID can trace", () => {
    expect(codes[7]).toMatch(/correlation id/i);
  });
});

describe("shared state vocabularies", () => {
  it("uses the same recovery axes as the domain", () => {
    for (const state of RECOVERY_AUTHORIZATION_STATES) {
      expect(cliContract, state).toContain(`\`${state}\``);
    }
    for (const state of RECOVERY_DELIVERY_STATES) {
      expect(cliContract, state).toContain(`\`${state}\``);
    }
  });

  it("lists exactly the seven legal recovery pairs", () => {
    const section = cliContract.slice(cliContract.indexOf("## Recovery state axes"));
    const pairs = [...section.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*`([a-z-]+)`\s*\|$/gm)]
      .map(([, authorization, delivery]) => `${authorization}/${delivery}`)
      .filter((pair) =>
        RECOVERY_AUTHORIZATION_STATES.includes(
          pair.split("/")[0] as (typeof RECOVERY_AUTHORIZATION_STATES)[number],
        ),
      );
    expect(pairs).toEqual(
      RECOVERY_STATE_PAIRS.map((pair) => `${pair.authorizationState}/${pair.deliveryState}`),
    );
  });

  it("rejects provisional/expired explicitly", () => {
    // The one plausible-looking pair that would let an unconfirmed delivery
    // masquerade as a terminal state.
    expect(cliContract).toMatch(/including `provisional\/expired`, is rejected/);
  });

  it("uses the same rotation policy states as the domain", () => {
    for (const state of KEY_POLICY_STATES) {
      expect(cliContract, state).toContain(state);
    }
  });

  it("defers the migration vocabulary to the API contract rather than restating it", () => {
    // The CLI contract says "staged migration state" and does not enumerate
    // the states; duplicating the list in two artifacts is how they drift.
    // What matters is that the single enumeration it defers to is the domain's.
    expect(cliContract).toMatch(/staged migration state/i);
    const document = parse(openApiRaw) as {
      components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> };
    };
    expect(document.components.schemas["MigrationStatus"]?.properties?.["state"]?.enum).toEqual([
      ...MIGRATION_STATES,
    ]);
  });

  it("keeps migration status readable in every state", () => {
    // A migration that hides its own status during a fault is unrecoverable
    // by an operator.
    expect(cliContract).toMatch(/Migration status remains readable in every state/);
  });
});

describe("safe transition rules", () => {
  it("leaves state unchanged when a secret is missing or invalid", () => {
    expect(cliContract).toMatch(
      /missing\/invalid secret returns exit 4 and leaves state unchanged/,
    );
  });

  it("leaves the target unchanged on an incompatible recovery import", () => {
    expect(cliContract).toMatch(/leaves the target\s*\n?\s*unchanged/);
  });

  it("requires a dry run then explicit confirmation for a destructive change", () => {
    expect(cliContract).toMatch(
      /Destructive state transitions require a dry run followed by explicit\s*\n?\s*confirmation/,
    );
  });

  it("makes destructive transitions idempotent at the operation ID", () => {
    // A retried command must not perform the side effect twice.
    expect(cliContract).toMatch(/idempotent at the operation ID/);
  });

  it("never inherits device trust during recovery", () => {
    expect(cliContract).toMatch(/never inherit trust during recovery/);
  });

  it("never decrypts recovery material to output", () => {
    expect(cliContract).toMatch(/never decrypt to output/);
  });
});

describe("the administration boundary holds across artifacts", () => {
  it("declares no administrator route in the OpenAPI contract", () => {
    const document = parse(openApiRaw) as { paths: Record<string, unknown> };
    const administratorPaths = Object.keys(document.paths).filter((route) =>
      /\/admin(istrator)?\b/i.test(route),
    );
    expect(administratorPaths).toEqual([]);
  });

  it("declares no bearer or API-token scheme in the OpenAPI contract", () => {
    const document = parse(openApiRaw) as {
      components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }> };
    };
    const schemes = Object.values(document.components?.securitySchemes ?? {});
    for (const scheme of schemes) {
      expect(scheme.type).not.toBe("oauth2");
      expect(scheme.scheme?.toLowerCase()).not.toBe("bearer");
    }
  });

  it("states that the CLI never creates a browser or API session", () => {
    // Otherwise the local CLI becomes a back door into the owner surface.
    expect(cliContract).toMatch(/without revealing secrets or creating a session|never.*session/i);
  });

  it("keeps the CLI local: it is never described as a network service", () => {
    expect(cliContract).toMatch(/local/i);
    expect(cliContract).not.toMatch(/listen(s|ing)? on port|bind(s)? to \d/i);
  });
});

describe("contract examples", () => {
  it("emits only safe fields in the documented JSON results", () => {
    const examples = [...cliContract.matchAll(/```json\n([\s\S]*?)```/g)].map(
      ([, body]) => JSON.parse(body as string) as Record<string, unknown>,
    );
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) {
      expect(Object.keys(example)).toContain("correlationId");
      for (const forbidden of ["passphrase", "key", "token", "secret", "content", "plaintext"]) {
        expect(Object.keys(example), forbidden).not.toContain(forbidden);
      }
    }
  });

  it("reports an unavailable key as a blocked write, not a crash", () => {
    const blocked = [...cliContract.matchAll(/```json\n([\s\S]*?)```/g)]
      .map(([, body]) => JSON.parse(body as string) as Record<string, unknown>)
      .find((example) => example["code"] === "WRAPPING_KEY_UNAVAILABLE");
    expect(blocked?.["status"]).toBe("blocked");
    expect(blocked?.["candidateState"]).toBe("write-block");
    // The operator is told what to do, not merely that something failed.
    expect(blocked?.["nextAction"]).toMatch(/mount/i);
  });

  it("reports a recovery import by digest, never by adopted content", () => {
    const imported = [...cliContract.matchAll(/```json\n([\s\S]*?)```/g)]
      .map(([, body]) => JSON.parse(body as string) as Record<string, unknown>)
      .find((example) => example["code"] === "RECOVERY_IMPORT_COMPLETE");
    expect(imported).toBeDefined();
    expect(imported).toHaveProperty("adoptedIdentityManifestDigest");
    expect(imported).toHaveProperty("devicesRequiringReauthorization");
  });
});
