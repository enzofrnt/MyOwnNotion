/**
 * UUIDv7 identity primitives (RFC 9562).
 *
 * Identities are client-generatable, time-ordered for index locality, and
 * never derived from names or paths. The generator only relies on Web Crypto
 * (`globalThis.crypto`), which exists in Node.js 24 and evergreen browsers,
 * keeping this module platform-independent.
 */

export type Uuid = string & { readonly __brand: "Uuid" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function asUuid(value: string): Uuid {
  if (!isUuid(value)) {
    throw new TypeError(`invalid UUID: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Web Crypto is present in Node.js 24 and every evergreen browser. */
const webCrypto = (
  globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
).crypto;

/** Monotonicity helper: retains the last emitted timestamp/counter pair. */
let lastMillis = -1;
let counter = 0;

/**
 * Generates a UUIDv7 value. Within one millisecond, a 12-bit counter placed
 * in `rand_a` keeps values monotonically increasing for index locality.
 */
export function generateUuidV7(now: () => number = Date.now): Uuid {
  const millis = now();
  if (millis === lastMillis) {
    counter = (counter + 1) & 0x0fff;
  } else {
    lastMillis = millis;
    counter = 0;
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);

  const ms = BigInt(millis);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  // version 7 in the high nibble + counter in rand_a
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  // RFC 4122/9562 variant
  bytes[8] = (bytes[8] as number & 0x3f) | 0x80;

  const hex: string[] = [];
  for (const byte of bytes) {
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  const digits = hex.join("");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}` as Uuid;
}
