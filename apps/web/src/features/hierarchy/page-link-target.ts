import type { ProjectedItem } from "@myownnotion/client-core";
import { isUuid, type SafeError, type Uuid } from "@myownnotion/domain";

/** React's rendered tree can lag a completed local creation transaction. */
export async function resolveLocalPageLinkTarget(
  rawItemId: string,
  readItem: (itemId: Uuid) => Promise<ProjectedItem | null>,
): Promise<
  { readonly ok: true; readonly itemId: Uuid } | { readonly ok: false; readonly error: SafeError }
> {
  if (!isUuid(rawItemId)) {
    return {
      ok: false,
      error: {
        code: "validation.invalid-identifier",
        title: "The internal page link has an invalid target identity",
      },
    };
  }
  try {
    const item = await readItem(rawItemId);
    if (item?.lifecycle === "active") return { ok: true, itemId: item.id };
    if (item?.lifecycle === "trashed") {
      return {
        ok: false,
        error: {
          code: "item.not-active",
          title: "This internal page link points to an item in the trash",
        },
      };
    }
  } catch {
    // Local storage diagnostics must not become content-bearing UI messages.
  }
  return {
    ok: false,
    error: {
      code: "item.not-found",
      title: "This internal page link target is unavailable on this device",
    },
  };
}
