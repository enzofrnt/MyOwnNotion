/**
 * Defensive sibling-key computation for the UI.
 *
 * Keys created by this client are always fractional-indexing keys, but the
 * API accepts any base-62 key from other clients. When an existing key
 * cannot serve as a generator bound, fall back to charset-valid appends that
 * preserve lexicographic order instead of failing the interaction.
 */
import { isValidPositionKey, keyBetween } from "@myownnotion/domain";

export function safeKeyBetween(before: string | null, after: string | null): string {
  try {
    return keyBetween(before, after);
  } catch {
    // Fallbacks keep strict order for foreign keys.
    if (before !== null) {
      for (const suffix of ["V", "0z", "00z"]) {
        const candidate = `${before}${suffix}`;
        if (isValidPositionKey(candidate) && (after === null || candidate < after)) {
          return candidate;
        }
      }
    }
    if (before === null && after !== null) {
      const candidate = `0${after}`.slice(0, 250);
      if (isValidPositionKey(candidate) && candidate < after) {
        return candidate;
      }
    }
    // Last resort: a fresh standalone key (order may be approximate).
    return keyBetween(null, null);
  }
}
