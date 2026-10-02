import type { FileUsageDto } from "@myownnotion/contracts";
import { Button } from "../../ui/primitives/index.ts";
export function AttachmentUsages({
  usages,
  onOpenUsage,
}: {
  readonly usages: readonly FileUsageDto[];
  readonly onOpenUsage: (itemId: string) => void;
}) {
  return usages.map((usage, index) => (
    <span key={`${usage.usedByItemId}-${usage.blockId ?? index}`}>
      {index > 0 ? ", " : null}
      <Button
        type="button"
        size="compact"
        variant="ghost"
        className="attachment-usage-link"
        data-testid={`attachment-usage-${usage.usedByName}`}
        onClick={() => onOpenUsage(usage.usedByItemId)}
      >
        {usage.usedByName}
      </Button>
    </span>
  ));
}
