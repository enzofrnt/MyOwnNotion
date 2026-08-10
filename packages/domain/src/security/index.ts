/**
 * Owner security foundation — platform-independent rules (feature 002).
 *
 * This barrel is the single entry point other packages import. Like the rest
 * of `@myownnotion/domain` it must never import Fastify, React, Drizzle,
 * browser APIs, or filesystem APIs: bootstrap, session, recovery, rotation,
 * migration, redaction, policy, and envelope-metadata rules stay pure so they
 * can be property-tested under a controlled clock.
 */

export * from "./crypto.ts";
export * from "./envelopes.ts";
export * from "./recovery-artifacts.ts";
export * from "./types.ts";
