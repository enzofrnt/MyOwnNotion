import type { LocalContentService } from "../../services/local-content.ts";
import { StoragePanel } from "../files/storage-panel.tsx";
import { LegacyRecoveryList } from "../sync/legacy-recovery-list.tsx";

/** Local-only diagnostics kept outside the note workspace. */
export function StorageDiagnostics({ service }: { readonly service: LocalContentService }) {
  return (
    <>
      <StoragePanel service={service} />
      <LegacyRecoveryList service={service} />
    </>
  );
}
