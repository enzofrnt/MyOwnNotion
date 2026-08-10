/**
 * Security artifact contract conformance (T008/T022, feature 002).
 *
 * `packages/contracts/src/security-artifacts.ts` is the executable form of
 * `specs/002-owner-security-foundation/contracts/security-artifacts.schema.json`.
 * The two drift silently otherwise: the JSON Schema is what reviewers read and
 * what the CLI validates against, the TypeBox module is what the running code
 * enforces. Everything asserted here is a place where a divergence would be
 * a security defect, not a cosmetic one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  B64_LENGTHS,
  ENVELOPE_ALGORITHM,
  ENVELOPE_FORMAT,
  EncryptedEnvelopeSchema,
  isLegalRecoveryStatePair,
  MIGRATION_FORMAT,
  MigrationCheckpointSchema,
  MigrationStates,
  RECOVERY_FORMAT,
  RECOVERY_KDF_COST_OPTIONS,
  RECOVERY_STATE_PAIRS,
  RecoveryAuthorizationStates,
  RecoveryDeliveryStates,
  ROTATION_FORMAT,
  RotationManifestSchema,
  RotationPhases,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const schemaPath = path.join(
  repoRoot,
  "specs/002-owner-security-foundation/contracts/security-artifacts.schema.json",
);

interface JsonSchemaNode {
  const?: unknown;
  enum?: unknown[];
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  oneOf?: JsonSchemaNode[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  $ref?: string;
}

interface ArtifactSchemaDocument {
  $defs: Record<string, JsonSchemaNode>;
}

const document = JSON.parse(readFileSync(schemaPath, "utf8")) as ArtifactSchemaDocument;

function definition(name: string): JsonSchemaNode {
  const node = document.$defs[name];
  expect(node, `$defs.${name} must exist in the contract`).toBeDefined();
  return node as JsonSchemaNode;
}

/** TypeBox stores object keys under `properties`, same shape as JSON Schema. */
function typeboxProperties(schema: unknown): Record<string, JsonSchemaNode> {
  return (schema as { properties?: Record<string, JsonSchemaNode> }).properties ?? {};
}

function typeboxRequired(schema: unknown): string[] {
  return [...((schema as { required?: string[] }).required ?? [])].sort();
}

describe("EncryptedEnvelope", () => {
  const contract = definition("EncryptedEnvelope");

  it("declares the same required fields as the contract", () => {
    expect(typeboxRequired(EncryptedEnvelopeSchema)).toEqual([...(contract.required ?? [])].sort());
  });

  it("pins the format and algorithm constants", () => {
    expect(contract.properties?.["format"]?.const).toBe(ENVELOPE_FORMAT);
    expect(contract.properties?.["algorithm"]?.const).toBe(ENVELOPE_ALGORITHM);
    expect(typeboxProperties(EncryptedEnvelopeSchema)["format"]?.const).toBe(ENVELOPE_FORMAT);
    expect(typeboxProperties(EncryptedEnvelopeSchema)["algorithm"]?.const).toBe(ENVELOPE_ALGORITHM);
  });

  it("keeps the fixed base64url widths, which encode byte counts", () => {
    const properties = typeboxProperties(EncryptedEnvelopeSchema);
    const widths: Array<[string, number]> = [
      ["salt", B64_LENGTHS.salt],
      ["nonce", B64_LENGTHS.nonce],
      ["tag", B64_LENGTHS.tag],
      ["aadDigest", B64_LENGTHS.digest],
    ];
    for (const [field, width] of widths) {
      expect(contract.properties?.[field]?.minLength, `contract ${field}`).toBe(width);
      expect(contract.properties?.[field]?.maxLength, `contract ${field}`).toBe(width);
      expect(properties[field]?.minLength, `typebox ${field}`).toBe(width);
      expect(properties[field]?.maxLength, `typebox ${field}`).toBe(width);
    }
  });

  it("forbids unknown properties, so stray metadata cannot ride along", () => {
    expect((contract as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect(
      (EncryptedEnvelopeSchema as { additionalProperties?: boolean }).additionalProperties,
    ).toBe(false);
  });
});

describe("RecoveryKit state axes", () => {
  const contract = definition("RecoveryKit");

  it("uses two independent axes and no mixed `state` field", () => {
    expect(contract.properties).not.toHaveProperty("state");
    expect(contract.properties).toHaveProperty("authorizationState");
    expect(contract.properties).toHaveProperty("deliveryState");
  });

  it("declares the same authorization and delivery vocabularies", () => {
    expect(contract.properties?.["authorizationState"]?.enum).toEqual([
      ...RecoveryAuthorizationStates,
    ]);
    expect(contract.properties?.["deliveryState"]?.enum).toEqual([...RecoveryDeliveryStates]);
  });

  it("encodes exactly the seven legal state pairs, in the contract's order", () => {
    const contractPairs = (contract.oneOf ?? []).map((variant) => ({
      authorizationState: variant.properties?.["authorizationState"]?.const,
      deliveryState: variant.properties?.["deliveryState"]?.const,
    }));
    expect(contractPairs).toHaveLength(7);
    expect(RECOVERY_STATE_PAIRS.map((pair) => ({ ...pair }))).toEqual(contractPairs);
  });

  it("rejects every combination the contract does not list", () => {
    for (const authorizationState of RecoveryAuthorizationStates) {
      for (const deliveryState of RecoveryDeliveryStates) {
        const legal = RECOVERY_STATE_PAIRS.some(
          (pair) =>
            pair.authorizationState === authorizationState && pair.deliveryState === deliveryState,
        );
        expect(
          isLegalRecoveryStatePair(authorizationState, deliveryState),
          `${authorizationState}/${deliveryState}`,
        ).toBe(legal);
      }
    }
  });

  it("never allows a provisional kit to be confirmed without the active axis", () => {
    // Skipping offline confirmation is the failure this pairing prevents.
    expect(isLegalRecoveryStatePair("provisional", "confirmed")).toBe(false);
    expect(isLegalRecoveryStatePair("active", "confirmed")).toBe(true);
  });

  it("keeps the scrypt cost options the contract permits", () => {
    expect(definition("Kdf").properties?.["N"]?.enum).toEqual([...RECOVERY_KDF_COST_OPTIONS]);
  });

  it("pins the recovery format constant", () => {
    expect(contract.properties?.["format"]?.const).toBe(RECOVERY_FORMAT);
  });
});

describe("RotationManifest", () => {
  const contract = definition("RotationManifest");

  it("declares the same required fields and phases", () => {
    expect(typeboxRequired(RotationManifestSchema)).toEqual([...(contract.required ?? [])].sort());
    expect(contract.properties?.["phase"]?.enum).toEqual([...RotationPhases]);
    expect(contract.properties?.["format"]?.const).toBe(ROTATION_FORMAT);
  });
});

describe("MigrationCheckpoint", () => {
  const contract = definition("MigrationCheckpoint");

  it("declares the same required fields and staged states, in order", () => {
    expect(typeboxRequired(MigrationCheckpointSchema)).toEqual(
      [...(contract.required ?? [])].sort(),
    );
    // Order is meaningful: plaintext writes stop before the read cutover, and
    // scrubbing follows the cutover.
    expect(contract.properties?.["state"]?.enum).toEqual([...MigrationStates]);
    expect(contract.properties?.["format"]?.const).toBe(MIGRATION_FORMAT);
  });

  it("places stop-plaintext-writes before the cutover and scrub", () => {
    const order = MigrationStates.indexOf.bind(MigrationStates);
    expect(order("stop-plaintext-writes")).toBeLessThan(order("encrypted-read-cutover"));
    expect(order("encrypted-read-cutover")).toBeLessThan(order("scrub-plaintext"));
  });
});
