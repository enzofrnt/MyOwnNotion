import { describe, expect, it } from "vitest";
import {
  driverError,
  isCheckViolation,
  isSerializationFailure,
  isUniqueViolation,
  SQLSTATE,
} from "../src/repositories/security/repository-types.ts";

describe("PostgreSQL driver error classification", () => {
  it("unwraps a query error and matches the exact unique constraint", () => {
    const driver = {
      code: SQLSTATE.uniqueViolation,
      constraint: "rotation_operations_active_unique",
    };
    const query = new Error("Failed query", { cause: new Error("driver", { cause: driver }) });

    expect(driverError(query)).toBe(driver);
    expect(isUniqueViolation(query, driver.constraint)).toBe(true);
    expect(isUniqueViolation(query, "another_constraint")).toBe(false);
    expect(isUniqueViolation(query)).toBe(true);
    expect(isUniqueViolation({ code: SQLSTATE.checkViolation }, driver.constraint)).toBe(false);
  });

  it("distinguishes check constraints, serialization conflicts, and unrelated errors", () => {
    const check = { code: SQLSTATE.checkViolation, constraint: "installation_state_check" };
    expect(isCheckViolation(check, check.constraint)).toBe(true);
    expect(isCheckViolation(check, "another_constraint")).toBe(false);
    expect(isCheckViolation({ code: SQLSTATE.uniqueViolation }, check.constraint)).toBe(false);
    expect(isSerializationFailure({ code: SQLSTATE.serializationFailure })).toBe(true);
    expect(isSerializationFailure({ code: SQLSTATE.deadlockDetected })).toBe(true);
    expect(isSerializationFailure(check)).toBe(false);
  });

  it("stops unwrapping malformed or unbounded cause chains", () => {
    expect(driverError(null)).toBeNull();
    expect(driverError(new Error("no cause"))).toBeNull();
    expect(driverError({ cause: "not an error" })).toBeNull();

    const driver = { code: SQLSTATE.uniqueViolation };
    let cause: unknown = driver;
    for (let depth = 0; depth < 4; depth += 1) cause = { cause };
    expect(driverError(cause)).toBe(driver);
    expect(driverError({ cause })).toBeNull();
  });
});
