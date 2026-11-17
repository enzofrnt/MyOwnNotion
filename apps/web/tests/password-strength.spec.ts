import { describe, expect, it } from "vitest";
import {
  assessPassword,
  PASSWORD_CRITERIA,
  PASSWORD_MINIMUM_LENGTH,
} from "../src/features/auth/password-strength.ts";
import { FR_COPY } from "../src/ui/copy/index.ts";

describe("password strength meter (feature 059)", () => {
  it("shows the five criteria Giftlist's meter uses", () => {
    expect(PASSWORD_CRITERIA.map((criterion) => criterion.id)).toEqual([
      "length",
      "lowercase",
      "uppercase",
      "digit",
      "special",
    ]);
    // Only the contract's minimum gates submission.
    expect(PASSWORD_CRITERIA.filter((criterion) => criterion.required).map((c) => c.id)).toEqual([
      "length",
    ]);
  });

  it("starts neutral on an empty field", () => {
    const empty = assessPassword("");
    expect(empty.isEmpty).toBe(true);
    expect(empty.passed).toBe(0);
    expect(empty.level).toBe(0);
    expect(empty.meetsMinimum).toBe(false);
  });

  it("counts the criteria the value satisfies", () => {
    expect(assessPassword("abc").passed).toBe(1);
    expect(assessPassword("abc").meetsMinimum).toBe(false);
    expect(assessPassword("a".repeat(PASSWORD_MINIMUM_LENGTH)).passed).toBe(2);
    expect(assessPassword("a".repeat(PASSWORD_MINIMUM_LENGTH)).meetsMinimum).toBe(true);
    expect(assessPassword("Correct horse battery staple 1!").passed).toBe(5);
  });

  it("maps the count onto Giftlist's four strength levels", () => {
    expect(assessPassword("abc").level).toBe(0);
    expect(assessPassword("abcdefghijkl").level).toBe(1);
    expect(assessPassword("abcdefghijkl1").level).toBe(2);
    expect(assessPassword("Abcdefghijkl1").level).toBe(3);
    expect(assessPassword("Abcdefghijkl1!").level).toBe(4);
  });

  it("keeps the level inside the copy's scale", () => {
    for (const value of ["", "abc", "Correct horse battery staple 1!"]) {
      const { level } = assessPassword(value);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(4);
      expect(FR_COPY.auth.password.levelLabels[level]).toBeTypeOf("string");
    }
  });

  it("never relies on a passphrase-only length as a composition rule", () => {
    // A long passphrase meets the contract without uppercase/digit/symbol: it
    // must stay submittable.
    const passphrase = assessPassword("une phrase de passe assez longue");
    expect(passphrase.meetsMinimum).toBe(true);
    expect(passphrase.passed).toBeLessThan(passphrase.total);
  });
});
