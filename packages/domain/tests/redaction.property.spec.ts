/**
 * Redaction invariants (T010, feature 002).
 *
 * The properties that keep secrets inside the process:
 *
 *   - a forbidden field is redacted at any depth, inside arrays, and inside a
 *     string that happens to be JSON;
 *   - the field name survives while the value does not, so a missing key never
 *     itself becomes a signal;
 *   - safe diagnostic fields such as `keyGeneration` are not collateral damage;
 *   - only allowlisted problem codes reach a client, and anything else
 *     collapses to `internal_error` with no detail.
 */
import {
  containsUnredactedField,
  FORBIDDEN_FIELD_NAMES,
  isForbiddenFieldName,
  isSafeProblemCode,
  REDACTED,
  redact,
  SAFE_PROBLEM_CODES,
  toSafeProblem,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const SECRET = "s3cr3t-material-do-not-emit";

describe("field-name matching", () => {
  it("matches every forbidden name regardless of casing or separators", () => {
    for (const name of FORBIDDEN_FIELD_NAMES) {
      for (const variant of [
        name,
        name.toUpperCase(),
        `${name[0]?.toUpperCase()}${name.slice(1)}`,
      ]) {
        expect(isForbiddenFieldName(variant), variant).toBe(true);
      }
    }
    expect(isForbiddenFieldName("deployment_key")).toBe(true);
    expect(isForbiddenFieldName("deployment-key")).toBe(true);
    expect(isForbiddenFieldName("Deployment.Key")).toBe(true);
  });

  it("keeps safe diagnostic fields that merely look sensitive", () => {
    for (const safe of [
      "keyGeneration",
      "keyKind",
      "credentialId",
      "capabilityDigest",
      "contentType",
      "supportedKeyGenerations",
    ]) {
      expect(isForbiddenFieldName(safe), safe).toBe(false);
    }
  });
});

describe("recursive redaction", () => {
  it("redacts a forbidden field at the top level", () => {
    expect(redact({ password: SECRET })).toEqual({ password: REDACTED });
  });

  it("keeps the key and replaces only the value", () => {
    // A deleted key would itself say "this installation has no password".
    const output = redact({ password: SECRET }) as Record<string, unknown>;
    expect(Object.keys(output)).toEqual(["password"]);
    expect(output["password"]).toBe(REDACTED);
  });

  it("redacts at arbitrary depth", () => {
    const nested = { a: { b: { c: { d: { deploymentKey: SECRET } } } } };
    expect(JSON.stringify(redact(nested))).not.toContain(SECRET);
    expect(containsUnredactedField(redact(nested))).toBe(false);
  });

  it("redacts inside arrays and arrays of objects", () => {
    const value = { sessions: [{ token: SECRET }, { token: SECRET }] };
    expect(JSON.stringify(redact(value))).not.toContain(SECRET);
  });

  it("redacts inside a string that is really JSON", () => {
    // "log the request body as a string" is the usual escape route.
    const value = { requestBody: JSON.stringify({ passphrase: SECRET }) };
    expect(JSON.stringify(redact(value))).not.toContain(SECRET);
  });

  it("leaves an ordinary string untouched", () => {
    expect(redact({ note: "a plain message" })).toEqual({ note: "a plain message" });
  });

  it("redacts raw bytes, which are almost always key or content material", () => {
    expect(redact({ blob: new Uint8Array([1, 2, 3]) })).toEqual({ blob: REDACTED });
  });

  it("redacts every owner-authored field in a nested structured projection", () => {
    const value = {
      databaseId: "018f2000-0000-7000-8000-000000000001",
      projection: {
        definition: {
          properties: [{ name: SECRET, config: { options: [{ label: SECRET }] } }],
          views: [{ title: SECRET, filter: { operand: { value: SECRET } }, sorts: [] }],
          taskRoles: { status: SECRET },
        },
        values: { property: { kind: "text", value: SECRET } },
        relationTargets: { property: [SECRET] },
        metadata: { note: SECRET },
      },
    };

    const output = JSON.stringify(redact(value));
    expect(output).not.toContain(SECRET);
    expect(output).toContain(value.databaseId);
    expect(containsUnredactedField(redact(value))).toBe(false);
  });

  it("keeps an error's name but never its message", () => {
    const output = redact(new Error(SECRET)) as { name: string; message: string };
    expect(output.name).toBe("Error");
    expect(output.message).toBe(REDACTED);
  });

  it("preserves safe scalars and timestamps", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(redact({ keyGeneration: 3, ready: true, at })).toEqual({
      keyGeneration: 3,
      ready: true,
      at: at.toISOString(),
    });
  });

  it("terminates on a cyclic structure instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });

  it("never leaves a forbidden field unredacted, for any generated shape", () => {
    const leafArbitrary = fc.oneof(
      fc.constant(SECRET),
      fc.integer(),
      fc.boolean(),
      fc.string({ maxLength: 12 }),
    );
    const objectArbitrary = fc.letrec((tie) => ({
      node: fc.oneof(
        { depthSize: "small" },
        leafArbitrary,
        fc.array(tie("node"), { maxLength: 3 }),
        fc.dictionary(
          fc.constantFrom(
            "password",
            "token",
            "deploymentKey",
            "recoveryKit",
            "keyGeneration",
            "label",
            "nested",
          ),
          tie("node"),
          { maxKeys: 4 },
        ),
      ),
    })).node;

    fc.assert(
      fc.property(objectArbitrary, (value) => {
        expect(containsUnredactedField(redact(value))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("safe problem codes", () => {
  it("accepts every declared code", () => {
    for (const code of SAFE_PROBLEM_CODES) {
      expect(isSafeProblemCode(code), code).toBe(true);
    }
  });

  it("collapses an unknown code to internal_error", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (code) => {
        const problem = toSafeProblem(code, "corr-1");
        expect(SAFE_PROBLEM_CODES).toContain(problem.code);
        if (!isSafeProblemCode(code)) {
          expect(problem.code).toBe("internal_error");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("omits detail unless the caller marked it safe", () => {
    expect(toSafeProblem("not_found", "corr-1")).toEqual({
      code: "not_found",
      correlationId: "corr-1",
    });
    expect(toSafeProblem("not_found", "corr-1", { safeDetail: "no such device" }).detail).toBe(
      "no such device",
    );
  });

  it("always carries a correlation ID so an operator can find the real log", () => {
    expect(toSafeProblem("internal_error", "corr-42").correlationId).toBe("corr-42");
  });

  it("does not distinguish credential failure modes", () => {
    // Unknown credential, wrong password, and failed assertion must be one code.
    expect(isSafeProblemCode("authentication_failed")).toBe(true);
    for (const oracle of ["unknown_user", "wrong_password", "credential_not_found"]) {
      expect(isSafeProblemCode(oracle), oracle).toBe(false);
      expect(toSafeProblem(oracle, "corr-1").code).toBe("internal_error");
    }
  });
});
