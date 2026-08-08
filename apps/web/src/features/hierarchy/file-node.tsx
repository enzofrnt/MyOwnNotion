/**
 * Hierarchy file node (T060, US2): terminal row exposing the canonical
 * file identity, media type, and size. Files never render children.
 */
import type { ProjectedItem } from "@myownnotion/client-core";

export function formatByteLength(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KiB`;
  }
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
}

export function FileNode({ item }: { readonly item: ProjectedItem }) {
  return (
    <span className="tree-file-meta muted" data-testid={`file-meta-${item.name}`}>
      {item.file !== null
        ? `${item.file.mediaType} · ${formatByteLength(item.file.byteLength)} · SHA-256 ${item.file.sha256.slice(0, 10)}…`
        : "file"}
      {item.placements.length > 1 ? ` · ${item.placements.length} placements` : ""}
    </span>
  );
}
