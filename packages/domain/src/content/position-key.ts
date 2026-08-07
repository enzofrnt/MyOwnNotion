/**
 * Stable lexicographic sibling ordering keys (FR-044).
 *
 * Keys are base-62 fractional strings: sibling order is the plain string
 * order of `positionKey`. Order is always explicit — never inferred from
 * query output. `keyBetween(a, b)` returns a new key strictly between its
 * arguments (`null` meaning the open start/end of the sequence).
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MIN_DIGIT = DIGITS[0] as string;
const MAX_DIGIT = DIGITS[DIGITS.length - 1] as string;
const MID_DIGIT = DIGITS[Math.floor(DIGITS.length / 2)] as string;

function digitValue(char: string): number {
  const value = DIGITS.indexOf(char);
  if (value === -1) {
    throw new RangeError(`invalid position-key digit: ${JSON.stringify(char)}`);
  }
  return value;
}

export function isValidPositionKey(key: string): boolean {
  if (key.length === 0 || key.length > 255) {
    return false;
  }
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      return false;
    }
  }
  // Trailing minimum digits are forbidden: they make midpoints ambiguous.
  return !key.endsWith(MIN_DIGIT);
}

/**
 * Returns a key strictly between `before` and `after`.
 * `before === null` means "before everything"; `after === null` means
 * "after everything". Both null yields the initial midpoint key.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && !isValidPositionKey(before)) {
    throw new RangeError(`invalid position key: ${JSON.stringify(before)}`);
  }
  if (after !== null && !isValidPositionKey(after)) {
    throw new RangeError(`invalid position key: ${JSON.stringify(after)}`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`keyBetween requires before < after (${before} >= ${after})`);
  }

  if (before === null && after === null) {
    return MID_DIGIT;
  }
  if (before === null) {
    return keyBefore(after as string);
  }
  if (after === null) {
    return keyAfter(before);
  }
  return midpoint(before, after);
}

function keyBefore(after: string): string {
  // Find the first non-minimum digit and step below it.
  let prefix = "";
  for (const char of after) {
    if (char === MIN_DIGIT) {
      prefix += MIN_DIGIT;
      continue;
    }
    const lower = DIGITS[Math.ceil(digitValue(char) / 2) - 1] ?? MIN_DIGIT;
    if (lower === MIN_DIGIT) {
      return `${prefix}${MIN_DIGIT}${MID_DIGIT}`;
    }
    return prefix + lower;
  }
  throw new RangeError(`cannot create a key before ${JSON.stringify(after)}`);
}

function keyAfter(before: string): string {
  // Increment the final digit when possible; otherwise extend.
  const last = before[before.length - 1] as string;
  if (last !== MAX_DIGIT) {
    const value = digitValue(last);
    const next = DIGITS[value + Math.max(1, Math.floor((DIGITS.length - value) / 2))];
    return before.slice(0, -1) + (next ?? MAX_DIGIT);
  }
  return before + MID_DIGIT;
}

function midpoint(before: string, after: string): string {
  let prefix = "";
  let index = 0;
  for (;;) {
    const beforeChar = before[index] ?? MIN_DIGIT;
    const afterChar = index < after.length ? (after[index] as string) : MAX_DIGIT;
    if (beforeChar === afterChar) {
      prefix += beforeChar;
      index += 1;
      continue;
    }
    const low = digitValue(beforeChar);
    const high = index < after.length ? digitValue(afterChar) : DIGITS.length; // virtual upper bound
    if (high - low > 1) {
      const mid = DIGITS[low + Math.floor((high - low) / 2)] as string;
      return prefix + mid;
    }
    // Adjacent digits: descend into the `before` suffix.
    prefix += beforeChar;
    index += 1;
    // Continue with before's remaining digits against an open upper bound.
    const rest = before.slice(index);
    return prefix + suffixAfter(rest);
  }
}

function suffixAfter(rest: string): string {
  let prefix = "";
  for (const char of rest) {
    const value = digitValue(char);
    if (value < DIGITS.length - 1) {
      const mid = DIGITS[value + Math.max(1, Math.floor((DIGITS.length - value) / 2))] as string;
      return prefix + mid;
    }
    prefix += char;
  }
  return prefix + MID_DIGIT;
}

/** Generates `count` evenly spread keys for bulk sibling creation. */
export function initialKeys(count: number): string[] {
  const keys: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const next = keyBetween(previous, null);
    keys.push(next);
    previous = next;
  }
  return keys;
}
