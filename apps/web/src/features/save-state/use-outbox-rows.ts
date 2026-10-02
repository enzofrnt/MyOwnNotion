import type { OutboxMutationRow } from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
export function useOutboxRows(service: LocalContentService): OutboxMutationRow[] {
  const [rows, setRows] = useState<OutboxMutationRow[]>([]);
  useEffect(() => {
    const refresh = async () => {
      setRows(await service.outbox.all());
    };
    void refresh();
    return service.subscribe(() => {
      void refresh();
    });
  }, [service]);
  return rows;
}
