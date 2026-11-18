/**
 * Password strength block for the account surfaces.
 *
 * The model is the one Giftlist uses (same five-rule checklist, same level
 * scale, same "x/5 règles" counter), applied to MyOwnNotion's own policy: the
 * contract enforces a 12-character minimum (`NewPasswordSchema`), and the four
 * composition criteria are guidance that never blocks submission — a long
 * passphrase is a legitimate password.
 *
 * The level is therefore computed from the checklist, not from an entropy
 * estimate: two people looking at the same password see the same verdict.
 */

import { PASSWORD_MINIMUM_LENGTH } from "@myownnotion/contracts";

export { PASSWORD_MINIMUM_LENGTH };

/** Every criterion shown under the meter, in display order. */
export const PASSWORD_CRITERIA = [
  {
    id: "length",
    required: true,
    test: (value: string) => value.length >= PASSWORD_MINIMUM_LENGTH,
  },
  { id: "lowercase", required: false, test: (value: string) => /[a-z]/.test(value) },
  { id: "uppercase", required: false, test: (value: string) => /[A-Z]/.test(value) },
  { id: "digit", required: false, test: (value: string) => /[0-9]/.test(value) },
  { id: "special", required: false, test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

export type PasswordCriterionId = (typeof PASSWORD_CRITERIA)[number]["id"];

/** 0 = nothing typed, 1 = très faible … 4 = très fort (Giftlist's scale). */
export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordCriterion {
  readonly id: PasswordCriterionId;
  readonly required: boolean;
  readonly met: boolean;
}

export interface PasswordStrength {
  readonly isEmpty: boolean;
  /** 0–4, used by the meter and by the level label. */
  readonly level: PasswordStrengthLevel;
  /** Bar width in percent: never 0 once something is typed. */
  readonly percent: number;
  readonly criteria: readonly PasswordCriterion[];
  readonly passed: number;
  readonly total: number;
  /** The contract's rule alone; what actually gates submission. */
  readonly meetsMinimum: boolean;
}

export function assessPassword(value: string): PasswordStrength {
  const criteria: PasswordCriterion[] = PASSWORD_CRITERIA.map((criterion) => ({
    id: criterion.id,
    required: criterion.required,
    met: criterion.test(value),
  }));
  const passed = criteria.filter((criterion) => criterion.met).length;
  const isEmpty = value.length === 0;
  const level = (isEmpty ? 0 : Math.max(0, Math.min(4, passed - 1))) as PasswordStrengthLevel;

  return {
    isEmpty,
    level,
    // Giftlist keeps a visible sliver for a typed but rule-less password.
    percent: level === 0 ? (isEmpty ? 0 : 10) : level * 25,
    criteria,
    passed,
    total: criteria.length,
    meetsMinimum: criteria[0]?.met === true,
  };
}
