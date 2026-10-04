import type { FileUsageDto, ItemDto } from "@myownnotion/contracts";
import { useState } from "react";
import { CompactAttachmentList } from "../features/attachments/attachment-panel.tsx";
import { AttachmentList, type AttachmentRow } from "../features/files/attachment-list.tsx";
import { DeleteFile } from "../features/files/delete-file.tsx";
import { CollapsibleRegion } from "../features/navigation/collapsible-region.tsx";
import { NavigationInlineCreate } from "../features/navigation/navigation-inline-create.tsx";
import { TreeAttachmentDisclosure } from "../features/navigation/tree-attachment-disclosure.tsx";
import type { ContentApi } from "../services/content-api.ts";
import { AppIcon } from "./icons.tsx";
import { Button, Section } from "./primitives/index.ts";
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
  const [empty, setEmpty] = useState(false);
  const [open, setOpen] = useState(false);
  const [otherPageActive, setOtherPageActive] = useState(true);
  const name = "Vue d’ensemble — Produit et documentation";
  return (
    <>
      <Section>
        <h2>Pièces jointes dans la navigation</h2>
        <Button size="compact" variant="ghost" onClick={() => setEmpty((value) => !value)}>
          {empty ? "Afficher les pièces jointes d’exemple" : "Afficher une page sans pièce jointe"}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => setOtherPageActive((value) => !value)}
        >
          {otherPageActive
            ? "Consulter cette page d’exemple"
            : "Consulter une autre page d’exemple"}
        </Button>
        <p className="ui-lab__hint">
          Page active : {otherPageActive ? "Notes personnelles" : name}. Le trombone ouvre les PJ
          sans changer de page.
        </p>
        {/* Keep the real sidebar ancestry: its tree indentation must not indent attachments. */}
        <div className="workspace-navigation ui-lab__attachment-navigation">
          {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: list-based ARIA tree matches the production hierarchy. */}
          <ul className="tree" role="tree" aria-label="Arborescence d’exemple">
            <li role="none">
              <div className="tree-row" role="treeitem" aria-level={1} aria-expanded tabIndex={0}>
                <AppIcon name="folder" size="small" />
                <span className="tree-name">Produit</span>
              </div>
              {/* biome-ignore lint/a11y/useSemanticElements: role="group" on ul is the ARIA tree substructure. */}
              <ul role="group">
                <TreeAttachmentDisclosure activeViewId={otherPageActive ? "other" : "inspected"}>
                  {(attachmentsOpen, toggleAttachments) => (
                    <li role="none">
                      <div className="tree-drop-target">
                        <div
                          className="tree-row"
                          role="treeitem"
                          aria-level={2}
                          aria-selected={!otherPageActive}
                          data-attachments-open={attachmentsOpen || undefined}
                          tabIndex={0}
                        >
                          <AppIcon name="fileText" size="small" />
                          <span className="tree-name" title={name}>
                            {name}
                          </span>
                          <span
                            className="navigation-item-actions"
                            data-inline-open={open || undefined}
                          >
                            <Button
                              size="square"
                              variant="ghost"
                              className="workspace-page-attachments-trigger"
                              aria-label="Pièces jointes de la page d’exemple"
                              aria-expanded={attachmentsOpen}
                              aria-controls="review-page-attachments"
                              onClick={toggleAttachments}
                            >
                              <AppIcon name="paperclip" size="small" />
                              {empty ? null : (
                                <span
                                  className="workspace-page-attachments-count"
                                  aria-hidden="true"
                                >
                                  {rows.length}
                                </span>
                              )}
                            </Button>
                            <NavigationInlineCreate
                              itemName={name}
                              open={open}
                              onOpenChange={setOpen}
                              onCreatePage={() => undefined}
                              onCreateFolder={() => undefined}
                              onCreateDatabase={() => undefined}
                            />
                            <Button
                              size="square"
                              variant="ghost"
                              className="navigation-item-menu"
                              aria-label="Actions pour la page d’exemple"
                            >
                              <AppIcon name="more" size="small" />
                            </Button>
                          </span>
                        </div>
                      </div>
                      <CollapsibleRegion
                        id="review-page-attachments"
                        className="workspace-page-attachments"
                        open={attachmentsOpen}
                        joinPrevious
                        lazy
                      >
                        <section
                          className="workspace-attachment-panel"
                          aria-label="Pièces jointes de la page d’exemple"
                        >
                          <div className="workspace-attachment-panel__header">
                            <h2>Pièces jointes</h2>
                            <span className="workspace-attachment-panel__count">
                              {empty ? 0 : rows.length}
                            </span>
                          </div>
                          <CompactAttachmentList
                            rows={empty ? [] : rows}
                            onOpenUsage={() => undefined}
                            actions={actions}
                          />
                        </section>
                      </CollapsibleRegion>
                    </li>
                  )}
                </TreeAttachmentDisclosure>
              </ul>
            </li>
          </ul>
        </div>
      </Section>
      <Section>
        <h2>Détails des pièces jointes</h2>
        <AttachmentList rows={rows} onOpenUsage={() => undefined} actions={actions} />
      </Section>
    </>
  );
}
