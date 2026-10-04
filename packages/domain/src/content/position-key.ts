/**
 * Stable lexicographic sibling ordering keys (FR-044).
 *
 * Sibling order is the plain string order of `positionKey`; order is always
 * explicit — never inferred from query output. Key generation delegates to
 * the proven fractional-indexing algorithm (integer head + fraction), whose
 * appended/prepended keys grow logarithmically, so 10,000 sequential inserts
 * stay far below the 255-character storage bound.
 */
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

const KEY_PATTERN = /^[0-9A-Za-z]+$/;
export const MAX_POSITION_KEY_LENGTH = 255;

/**
 * Storage-level validity: base-62 charset within length bounds. Generator
 * bounds are additionally validated by `keyBetween` itself.
 */
export function isValidPositionKey(key: string): boolean {
  return key.length >= 1 && key.length <= MAX_POSITION_KEY_LENGTH && KEY_PATTERN.test(key);
}

/**
 * Returns a key strictly between `before` and `after`.
 * `before === null` means "before everything"; `after === null` means
 * "after everything". Both null yields the initial key. Invalid bounds or
 * `before >= after` throw a RangeError.
 */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before ?? undefined, after ?? undefined);
  } catch (error) {
    throw new RangeError(
      `invalid position-key bounds (${JSON.stringify(before)}, ${JSON.stringify(after)}): ${
        (error as Error).message
      }`,
    );
  }
}

/** Generates `count` evenly ordered keys for bulk sibling creation. */
export function initialKeys(count: number): string[] {
  return generateNKeysBetween(undefined, undefined, count);
}

/**
 * A key that sorts after every existing sibling.
 *
 * Fractional keys use the shared generator. Keys such as `view-000003`,
 * written when a view is reordered, are not fractional keys: appending a
 * digit keeps string order without asking the generator to accept them.
 */
export function keyAfterAll(keys: readonly string[]): string {
  if (keys.length === 0) return keyBetween(null, null);
  const fractional = keys.every((key) => {
    if (!isValidPositionKey(key)) return false;
    try {
      keyBetween(key, null);
      return true;
    } catch {
      return false;
    }
  });
  const max = [...keys].sort((left, right) => left.localeCompare(right)).at(-1);
  if (fractional) return keyBetween(max ?? null, null);
  const used = new Set(keys);
  let candidate = `${max ?? ""}0`;
  while (used.has(candidate)) candidate = `${candidate}0`;
  return candidate;
}
