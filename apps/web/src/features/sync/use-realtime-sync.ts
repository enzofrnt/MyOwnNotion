import { useEffect } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { RealtimeSyncLifecycle } from "./realtime-sync-lifecycle.ts";

/** Keeps one live page channel for exactly the signed-in workspace lifetime. */
export function useRealtimeSync(service: LocalContentService): void {
  useEffect(() => {
    const lifecycle = new RealtimeSyncLifecycle(service);
    lifecycle.start();
    return () => lifecycle.stop();
  }, [service]);
}
