import type { FileUsageDto, ItemDto } from "@myownnotion/contracts";
import { CompactAttachmentList } from "../features/attachments/attachment-panel.tsx";
import { AttachmentList, type AttachmentRow } from "../features/files/attachment-list.tsx";
import { DeleteFile } from "../features/files/delete-file.tsx";
import type { ContentApi } from "../services/content-api.ts";
import { Section } from "./primitives/index.ts";
import { reviewId } from "./ui-lab-review-fixtures.ts";

const usages: FileUsageDto[] = [
  {
    usedByItemId: reviewId(42),
    usedByName: "Une page avec un titre particulièrement long qui utilise cette pièce jointe",
    usageKind: "attachment",
  },
];
// Only the presentation's fields are consumed; no production service is instantiated.
const item = {
  id: reviewId(60),
  name: "Une pièce jointe au nom particulièrement long.pdf",
  kind: "file",
  file: { mediaType: "application/pdf", byteLength: 4096 },
} as unknown as ItemDto;
const rows: AttachmentRow[] = [
  {
    item,
    addedAt: "2026-10-03T10:00:00Z",
    location: "Produit / Documentation / Une sous-page de référence",
    usages,
    availability: "offloaded",
    synchronized: true,
  },
];
const api = {
  fileUsages: async () => ({ ok: true, value: { usages } }),
  getItem: async () => ({ ok: false }),
} as unknown as ContentApi;
const actions = () => (
  <DeleteFile
    api={api}
    fileItemId={reviewId(60)}
    fileName={item.name}
    onDeleted={() => undefined}
  />
);

export function ReviewAttachments() {
  return (
    <>
      <Section>
        <h2>Pièces jointes dans la navigation</h2>
        <CompactAttachmentList rows={rows} onOpenUsage={() => undefined} actions={actions} />
      </Section>
      <Section>
        <h2>Détails des pièces jointes</h2>
        <AttachmentList rows={rows} onOpenUsage={() => undefined} actions={actions} />
      </Section>
    </>
  );
}
