/**
 * Security API contract conformance (T008/T022, feature 002).
 *
 * `packages/contracts/src/security-api.ts` is the executable form of
 * `contracts/security-api.openapi.yaml`. The YAML is what a reviewer reads;
 * the TypeBox module is what the running server enforces. Without this suite
 * they drift, and the drift is invisible until a route accepts something the
 * contract forbids.
 *
 * The assertions concentrate on the places where a divergence would be a
 * security defect rather than a cosmetic one: the committed-count constants,
 * the response-only material, the nullable device timestamps, and the seven
 * recovery state pairs.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AuditEventSchema,
  BOOTSTRAP_CAPABILITY_HEADER,
  BootstrapConfirmationResultSchema,
  BootstrapOfflineConfirmationSchema,
  BootstrapProgressSchema,
  BootstrapStartedSchema,
  BrowserDeviceClaimSchema,
  CSRF_TOKEN_HEADER,
  DeviceSchema,
  InitializedInstallationStatusSchema,
  MigrationStatusSchema,
  RECOVERY_VIEW_STATE_PAIRS,
  RotationPolicyViewSchema,
  SecurityProblemSchema,
  SessionViewSchema,
  UninitializedInstallationStatusSchema,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(
  repoRoot,
  "specs/002-owner-security-foundation/contracts/security-api.openapi.yaml",
);

interface SchemaNode {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  format?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, SchemaNode> };
}

interface OpenApiOperation {
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
}

const document = parse(readFileSync(contractPath, "utf8")) as OpenApiDocument;

function schema(name: string): SchemaNode {
  const node = document.components.schemas[name];
  expect(node, `components.schemas.${name} must exist`).toBeDefined();
  return node as SchemaNode;
}

function typeboxRequired(node: unknown): string[] {
  return [...((node as { required?: string[] }).required ?? [])].sort();
}

function typeboxProperties(node: unknown): Record<string, SchemaNode> {
  return (node as { properties?: Record<string, SchemaNode> }).properties ?? {};
}

/** Flattens an `allOf` composition into the effective property map. */
function effectiveProperties(node: SchemaNode): Record<string, SchemaNode> {
  if (node.allOf === undefined) {
    return node.properties ?? {};
  }
  const merged: Record<string, SchemaNode> = {};
  for (const part of node.allOf) {
    const resolved = part.$ref === undefined ? part : schema(refName(part.$ref));
    Object.assign(merged, effectiveProperties(resolved));
  }
  return merged;
}

function refName(reference: string): string {
  return reference.replace("#/components/schemas/", "");
}

function operationAt(pathName: string, method: string): OpenApiOperation {
  const operation = document.paths[pathName]?.[method] as OpenApiOperation | undefined;
  expect(operation, `${method.toUpperCase()} ${pathName}`).toBeDefined();
  return operation as OpenApiOperation;
}

function responseRef(operation: OpenApiOperation, status: string): string | undefined {
  return operation.responses[status]?.content?.["application/json"]?.schema?.$ref;
}

describe("document shape", () => {
  it("is OpenAPI 3.1", () => {
    expect(document.openapi.startsWith("3.1")).toBe(true);
  });

  it("declares the owner-facing security paths and no administrator route", () => {
    const paths = Object.keys(document.paths);
    expect(paths).toContain("/v1/installation/status");
    expect(paths).toContain("/v1/bootstrap");
    expect(paths).toContain("/v1/auth/passkeys/enrollment/options");
    expect(paths).toContain("/v1/auth/passkeys/enrollment/complete");
    expect(paths).toContain("/v1/auth/login/passkey/options");
    expect(paths).toContain("/v1/auth/passkeys");
    expect(paths).toContain("/v1/auth/password");
    expect(paths).toContain("/v1/auth/sessions");
    expect(paths).toContain("/v1/security/recovery-kits");
    expect(paths).toContain("/v1/security/recovery-kits/{kitId}/download");
    expect(paths).toContain("/v1/security/recovery-kits/{kitId}/confirm");
    expect(paths).toContain("/v1/security/recovery-kits/revoke");
    expect(paths).not.toContain("/v1/security/recovery");
    expect(paths).toContain("/v1/security/rotations");
    expect(paths).toContain("/v1/security/rotations/policies");
    expect(paths).toContain("/v1/security/rotations/{operationId}");
    expect(paths).toContain("/v1/security/audit");

    // V1 administration is the protected local CLI only. A remote
    // administrator route here would be a transport the design excludes.
    const administratorPaths = paths.filter((entry) => /\/admin(istrator)?\b/i.test(entry));
    expect(administratorPaths).toEqual([]);
  });
});

describe("authenticated recovery-kit replacement", () => {
  it("describes the bodyless preparation/revocation and explicit confirmation", () => {
    const collection = operationAt("/v1/security/recovery-kits", "post");
    const confirm = operationAt("/v1/security/recovery-kits/{kitId}/confirm", "post");
    const revoke = operationAt("/v1/security/recovery-kits/revoke", "post");

    expect(collection.requestBody).toBeUndefined();
    expect(responseRef(collection, "201")).toBe("#/components/schemas/PreparedRecoveryKit");
    expect(confirm.requestBody?.required).toBe(true);
    expect(confirm.requestBody?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/OfflineConfirmation",
    );
    expect(responseRef(confirm, "200")).toBe("#/components/schemas/ConfirmedRecoveryKit");
    expect(revoke.requestBody).toBeUndefined();
    expect(responseRef(revoke, "200")).toBe("#/components/schemas/RevokedRecoveryKit");
    expect(schema("RecoveryKitStatus").required).toEqual(["active", "pending", "notice"]);
  });

  it("declares every recovery operation refusal that the route can emit", () => {
    const expectedPost = ["400", "401", "403", "404", "409", "428", "500"];
    const download = operationAt("/v1/security/recovery-kits/{kitId}/download", "post");
    const confirm = operationAt("/v1/security/recovery-kits/{kitId}/confirm", "post");
    const revoke = operationAt("/v1/security/recovery-kits/revoke", "post");
    for (const operation of [download, confirm]) {
      expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining([...expectedPost]));
      expect(Object.keys(operation.responses)).toContain("503");
    }
    expect(Object.keys(revoke.responses)).toEqual(
      expect.arrayContaining(["401", "403", "404", "409", "428", "500", "503"]),
    );
    const prepare = operationAt("/v1/security/recovery-kits", "post");
    expect(Object.keys(prepare.responses)).toEqual(
      expect.arrayContaining(["401", "403", "409", "428", "500", "503"]),
    );
  });
});

describe("installation status counts", () => {
  it("pins uninitialized statuses to 0/0", () => {
    for (const name of [
      "UninitializedInstallationStatus",
      "BootstrapInProgressInstallationStatus",
    ]) {
      const properties = effectiveProperties(schema(name));
      expect(properties["ownerCount"]?.const, name).toBe(0);
      expect(properties["workspaceCount"]?.const, name).toBe(0);
    }
    // The TypeBox mirror must be equally incapable of expressing anything else.
    expect(typeboxProperties(UninitializedInstallationStatusSchema)["ownerCount"]?.const).toBe(0);
    expect(typeboxProperties(UninitializedInstallationStatusSchema)["workspaceCount"]?.const).toBe(
      0,
    );
  });

  it("pins every initialized status to 1/1, degraded included", () => {
    const properties = effectiveProperties(schema("InitializedInstallationStatus"));
    expect(properties["ownerCount"]?.const).toBe(1);
    expect(properties["workspaceCount"]?.const).toBe(1);
    expect(properties["state"]?.enum).toContain("degraded");

    expect(typeboxProperties(InitializedInstallationStatusSchema)["ownerCount"]?.const).toBe(1);
    expect(typeboxProperties(InitializedInstallationStatusSchema)["workspaceCount"]?.const).toBe(1);
  });

  it("offers no status shape that mixes an owner with no workspace", () => {
    // Every variant fixes both counts to the same constant, so a partial
    // installation has no representation in the contract at all.
    for (const name of [
      "UninitializedInstallationStatus",
      "BootstrapInProgressInstallationStatus",
      "InitializedInstallationStatus",
    ]) {
      const properties = effectiveProperties(schema(name));
      expect(properties["ownerCount"]?.const, name).toBe(properties["workspaceCount"]?.const);
    }
  });
});

describe("bootstrap", () => {
  it("marks the capability response-only and never accepts it in a body", () => {
    const started = schema("BootstrapStarted");
    expect(started.properties?.["capability"]?.readOnly).toBe(true);

    // No request schema may carry it. A body or query field would place the
    // capability in logs and history.
    for (const [name, node] of Object.entries(document.components.schemas)) {
      if (name === "BootstrapStarted") {
        continue;
      }
      expect(Object.keys(effectiveProperties(node)), name).not.toContain("capability");
    }
  });

  it("echoes the capability only through the X-Bootstrap-Capability header", () => {
    expect(BOOTSTRAP_CAPABILITY_HEADER).toBe("x-bootstrap-capability");
    const raw = readFileSync(contractPath, "utf8");
    expect(raw).toContain("X-Bootstrap-Capability");
  });

  it("keeps every pre-confirmation response at 0/0 and uninitialized", () => {
    for (const name of ["BootstrapStarted", "BootstrapProgress"]) {
      const properties = effectiveProperties(schema(name));
      expect(properties["ownerCount"]?.const, name).toBe(0);
      expect(properties["workspaceCount"]?.const, name).toBe(0);
      expect(properties["installationState"]?.const, name).toBe("uninitialized");
    }
  });

  it("pairs each bootstrap state with its legal delivery states", () => {
    const variants = schema("BootstrapProgress").oneOf ?? [];
    expect(variants).toHaveLength(2);
    const consumed = variants.find(
      (variant) => variant.properties?.["bootstrapState"]?.const === "download-consumed",
    );
    // A consumed download cannot report itself as still downloadable; that
    // pairing is what makes the one-time download observable.
    expect(consumed?.properties?.["deliveryState"]?.const).toBe("download-consumed");
  });

  it("requires an explicit offline confirmation", () => {
    expect(schema("OfflineConfirmation").properties?.["storedOffline"]?.const).toBe(true);
    expect(schema("BootstrapOfflineConfirmation").required?.sort()).toEqual([
      "device",
      "storedOffline",
    ]);
    expect(typeboxRequired(BootstrapOfflineConfirmationSchema)).toEqual([
      "device",
      "storedOffline",
    ]);
    expect(typeboxRequired(BrowserDeviceClaimSchema)).toEqual([
      "deviceBindingId",
      "name",
      "platform",
    ]);
  });

  it("lets only a fully promoted bootstrap produce a confirmation result", () => {
    const properties = schema("BootstrapConfirmationResult").properties ?? {};
    expect(properties["bootstrapState"]?.const).toBe("confirmed");
    expect(properties["installationState"]?.const).toBe("ready");
    expect(properties["ownerCount"]?.const).toBe(1);
    expect(properties["workspaceCount"]?.const).toBe(1);
    expect(properties["authorizationState"]?.const).toBe("active");
    expect(properties["deliveryState"]?.const).toBe("confirmed");

    const mirrored = typeboxProperties(BootstrapConfirmationResultSchema);
    expect(mirrored["ownerCount"]?.const).toBe(1);
    expect(mirrored["authorizationState"]?.const).toBe("active");
  });

  it("declares the same required fields as the contract", () => {
    expect(typeboxRequired(BootstrapStartedSchema)).toEqual(
      [...(schema("BootstrapStarted").required ?? [])].sort(),
    );
    expect(typeboxRequired(BootstrapConfirmationResultSchema)).toEqual(
      [...(schema("BootstrapConfirmationResult").required ?? [])].sort(),
    );
    // The union variants share the contract's required set.
    const progressRequired = [...(schema("BootstrapProgress").required ?? [])].sort();
    for (const variant of (BootstrapProgressSchema as { anyOf?: unknown[] }).anyOf ?? []) {
      expect(typeboxRequired(variant)).toEqual(progressRequired);
    }
  });
});

describe("sessions and CSRF", () => {
  it("marks the CSRF token response-only at exactly 32 bytes", () => {
    const csrf = schema("AuthenticatedSession").properties?.["csrfToken"];
    expect(csrf?.readOnly).toBe(true);
    // 43 unpadded base64url characters is 32 bytes.
    expect(csrf?.minLength).toBe(43);
    expect(csrf?.maxLength).toBe(43);
  });

  it("echoes the CSRF token only through the X-CSRF-Token header", () => {
    expect(CSRF_TOKEN_HEADER).toBe("x-csrf-token");
    expect(readFileSync(contractPath, "utf8")).toContain("X-CSRF-Token");
  });

  it("never lets the local CLI be an authentication method", () => {
    const methods = schema("SessionView").properties?.["authMethod"]?.enum ?? [];
    expect(methods).toEqual(["passkey", "password"]);
    expect(typeboxProperties(SessionViewSchema)["authMethod"]).toBeDefined();
  });

  it("never returns a password", () => {
    // The password appears only in `writeOnly` request fields.
    expect(schema("PasswordChange").properties?.["newPassword"]?.writeOnly).toBe(true);
    expect(schema("PasswordLogin").properties?.["password"]?.writeOnly).toBe(true);
    expect(Object.keys(schema("PasswordView").properties ?? {})).not.toContain("password");
  });
});

describe("device timestamps", () => {
  it("requires lastActivityAt and lastSyncAt, and allows null", () => {
    const device = schema("Device");
    expect(device.required).toContain("lastActivityAt");
    expect(device.required).toContain("lastSyncAt");
    // Nullable, not optional: omitting the field would be indistinguishable
    // from "not implemented", and a synthesized value would claim activity
    // that never happened.
    expect(device.properties?.["lastActivityAt"]?.type).toEqual(["string", "null"]);
    expect(device.properties?.["lastSyncAt"]?.type).toEqual(["string", "null"]);
  });

  it("mirrors both as required and nullable in TypeBox", () => {
    const required = typeboxRequired(DeviceSchema);
    expect(required).toContain("lastActivityAt");
    expect(required).toContain("lastSyncAt");
    expect(required).toEqual([...(schema("Device").required ?? [])].sort());
  });
});

describe("security route response statuses", () => {
  const responsesOf = (path: string, method: string): Record<string, unknown> => {
    const operation = document.paths[path]?.[method] as { responses: Record<string, unknown> };
    expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
    return operation.responses;
  };

  it("documents device validation, authentication, CSRF, and server failures", () => {
    expect(Object.keys(responsesOf("/v1/devices", "get"))).toEqual(
      expect.arrayContaining(["200", "401", "500"]),
    );
    for (const [path, method, expected] of [
      ["/v1/devices/{deviceId}", "get", ["200", "400", "401", "404", "500"]],
      ["/v1/devices/{deviceId}/revoke", "post", ["200", "400", "401", "403", "404", "428", "500"]],
      [
        "/v1/devices/{deviceId}/reauthorize",
        "post",
        ["200", "400", "401", "403", "404", "428", "500"],
      ],
    ] as const) {
      expect(Object.keys(responsesOf(path, method))).toEqual(expect.arrayContaining([...expected]));
    }
    expect(Object.keys(responsesOf("/v1/devices/{deviceId}", "patch"))).toEqual(
      expect.arrayContaining(["200", "400", "401", "403", "404", "500"]),
    );
  });

  it("documents passkey refusal statuses without a nonexistent 404", () => {
    expect(Object.keys(responsesOf("/v1/auth/passkeys/enrollment/options", "post"))).toEqual(
      expect.arrayContaining(["200", "401", "403", "428", "500"]),
    );
    expect(Object.keys(responsesOf("/v1/auth/passkeys/enrollment/complete", "post"))).toEqual(
      expect.arrayContaining(["201", "400", "401", "403", "428", "500"]),
    );
    const remove = responsesOf("/v1/auth/passkeys/{credentialId}", "delete");
    expect(Object.keys(remove)).toEqual(
      expect.arrayContaining(["204", "400", "401", "403", "409", "428", "500"]),
    );
    expect(remove).not.toHaveProperty("404");
  });

  it("keeps inline response wrappers closed and query validation documented", () => {
    const devices = (
      responsesOf("/v1/devices", "get")["200"] as {
        content: { "application/json": { schema: SchemaNode } };
      }
    ).content["application/json"].schema;
    const policies = (
      responsesOf("/v1/security/rotations/policies", "get")["200"] as {
        content: { "application/json": { schema: SchemaNode } };
      }
    ).content["application/json"].schema;
    const audit = (
      responsesOf("/v1/security/audit", "get")["200"] as {
        content: { "application/json": { schema: SchemaNode } };
      }
    ).content["application/json"].schema;
    expect(devices.additionalProperties).toBe(false);
    expect(policies.additionalProperties).toBe(false);
    expect(audit.additionalProperties).toBe(false);
    expect(
      (
        responsesOf("/v1/security/audit", "get")["200"] as {
          headers?: Record<string, { required?: boolean; schema?: { const?: unknown } }>;
        }
      ).headers?.["Cache-Control"]?.required,
    ).toBe(true);
    expect(
      (
        responsesOf("/v1/security/audit", "get")["200"] as {
          headers?: Record<string, { schema?: { const?: unknown } }>;
        }
      ).headers?.["Cache-Control"]?.schema?.const,
    ).toBe("no-store");
    expect(Object.keys(responsesOf("/v1/security/audit", "get"))).toContain("400");
  });
});

describe("recovery views", () => {
  it("encodes exactly the seven legal state pairs, in the contract's order", () => {
    const contractPairs = (schema("RecoveryKitView").oneOf ?? []).map((variant) => ({
      authorizationState: variant.properties?.["authorizationState"]?.const,
      deliveryState: variant.properties?.["deliveryState"]?.const,
    }));
    expect(contractPairs).toHaveLength(7);
    expect(RECOVERY_VIEW_STATE_PAIRS.map((pair) => ({ ...pair }))).toEqual(contractPairs);
  });

  it("never exposes a provisional kit as confirmed", () => {
    // Asserted against the contract rather than the TypeScript constant: the
    // literal union already makes the pair unrepresentable in TypeScript, so a
    // check there is a tautology the compiler rejects. The YAML is what could
    // actually drift.
    const contractPairs = (schema("RecoveryKitView").oneOf ?? []).map(
      (variant) =>
        `${String(variant.properties?.["authorizationState"]?.const)}/${String(
          variant.properties?.["deliveryState"]?.const,
        )}`,
    );
    expect(contractPairs).not.toContain("provisional/confirmed");
    expect(contractPairs).toContain("active/confirmed");
  });

  it("never returns kit key material in a view", () => {
    for (const name of ["RecoveryKitView"]) {
      const properties = Object.keys(effectiveProperties(schema(name)));
      for (const forbidden of ["ciphertext", "encryption", "kdf", "passphrase", "key"]) {
        expect(properties, `${name}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("uses the complete canonical recovery artifact for a download", () => {
    const download = operationAt("/v1/security/recovery-kits/{kitId}/download", "post");
    expect(responseRef(download, "200")).toBe("#/components/schemas/RecoveryKitArtifact");
    expect(schema("RecoveryKitArtifact").oneOf).toHaveLength(7);
    expect(schema("RecoveryKitArtifactBase").properties?.["kdf"]?.oneOf).toHaveLength(2);
    expect(schema("RecoveryKitArtifactBase").properties).toHaveProperty("encryption");
    expect(schema("RecoveryKitArtifactBase").properties).toHaveProperty("supportedKeyGenerations");
  });
});

describe("rotation and migration", () => {
  it("shares the policy state vocabulary with the domain", () => {
    expect(schema("RotationPolicyView").properties?.["state"]?.enum).toEqual([
      "pre-due",
      "due",
      "overdue-within-grace",
      "emergency",
      "write-block",
      "in-progress",
      "complete",
      "failed",
    ]);
    expect(typeboxRequired(RotationPolicyViewSchema)).toEqual(
      [...(schema("RotationPolicyView").required ?? [])].sort(),
    );
  });

  it("keeps the staged migration order", () => {
    const states = (schema("MigrationStatus").properties?.["state"]?.enum ?? []) as string[];
    expect(states.indexOf("stop-plaintext-writes")).toBeLessThan(
      states.indexOf("encrypted-read-cutover"),
    );
    expect(states.indexOf("encrypted-read-cutover")).toBeLessThan(
      states.indexOf("scrub-plaintext"),
    );
    expect(typeboxRequired(MigrationStatusSchema)).toEqual(
      [...(schema("MigrationStatus").required ?? [])].sort(),
    );
  });

  it("requires an explicit confirmation to start a rotation", () => {
    expect(schema("RotationStart").required).toContain("confirmation");
    expect(schema("RotationStart").required).toContain("dryRun");
  });
});

describe("audit and problems", () => {
  it("exposes only safe audit fields", () => {
    const properties = Object.keys(schema("AuditEvent").properties ?? {});
    for (const forbidden of ["metadata", "content", "payload", "objectName"]) {
      expect(properties).not.toContain(forbidden);
    }
    expect(typeboxRequired(AuditEventSchema)).toEqual(
      [...(schema("AuditEvent").required ?? [])].sort(),
    );
  });

  it("requires a correlation ID on every problem", () => {
    expect(schema("Problem").required).toContain("correlationId");
    expect(typeboxRequired(SecurityProblemSchema)).toEqual(
      [...(schema("Problem").required ?? [])].sort(),
    );
  });

  it("caps problem detail so a message cannot smuggle content", () => {
    expect(schema("Problem").properties?.["detail"]?.maxLength).toBe(256);
    expect(schema("Problem").additionalProperties).toBe(false);
  });
});

describe("the one-time recovery download", () => {
  const download = document.paths["/v1/bootstrap/{attemptId}/recovery/download"]?.["post"] as
    | {
        requestBody?: unknown;
        parameters?: { $ref?: string }[];
        responses?: Record<string, unknown>;
      }
    | undefined;

  it("is specified with no request body", () => {
    // The client holds exactly one secret for the whole ceremony: the
    // capability. A second client-held token would have to be stored
    // somewhere, and the only storage a browser has outlives the attempt.
    expect(download).toBeDefined();
    expect(download?.requestBody).toBeUndefined();
  });

  it("is authorized by the capability header alone", () => {
    const refs = (download?.parameters ?? []).map((parameter) => parameter.$ref);
    expect(refs).toContain("#/components/parameters/BootstrapCapability");
  });

  it("tells the client the download is spent, in the response that carries it", () => {
    // Otherwise a client that fails to save the file retries the download,
    // gets a refusal, and has no way to know regeneration is the way forward.
    const ok = download?.responses?.["200"] as
      | { headers?: Record<string, { schema?: { const?: unknown } }> }
      | undefined;
    expect(ok?.headers?.["X-Recovery-Download-Consumed"]?.schema?.const).toBe("true");
  });
});
