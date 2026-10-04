import type { ProjectedItem } from "@myownnotion/client-core";
import { embeddedFilesV3, readStoredDocumentV3, type Uuid } from "@myownnotion/domain";

/** Content references determine membership; placements only determine storage. */
export function pageAttachmentsByPage(
  items: readonly ProjectedItem[],
): ReadonlyMap<Uuid, readonly ProjectedItem[]> {
  const files = new Map(
    items
      .filter((item) => item.kind === "file" && item.lifecycle === "active")
      .map((item) => [item.id, item]),
  );
  const byPage = new Map<Uuid, readonly ProjectedItem[]>();
  for (const page of items) {
    if (page.kind !== "page" || page.lifecycle !== "active") continue;
    const document = readStoredDocumentV3(page.pageDocument);
    // Missing local content is unknown, not evidence that the page is empty.
    if (document === null) continue;
    const referencedIds = new Set(embeddedFilesV3(document).map(({ fileItemId }) => fileItemId));
    const attached: ProjectedItem[] = [];
    for (const id of referencedIds) {
      const file = files.get(id);
      if (file !== undefined) attached.push(file);
    }
    byPage.set(page.id, attached);
  }
  return byPage;
}
