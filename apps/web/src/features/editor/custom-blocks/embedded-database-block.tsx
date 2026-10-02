import { createReactBlockSpec } from "@blocknote/react";
import type { Uuid } from "@myownnotion/domain";
import type { MouseEvent } from "react";
import { DatabaseContainerPage } from "../../databases/database-container-page.tsx";
import { useDatabaseViewBlockContext } from "../database-view-context.tsx";

/** Clicks inside the database stay there. They must not select the editor block. */
function keepDatabaseInteraction(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
  const editor = event.currentTarget.closest(".bn-editor");
  if (
    editor instanceof HTMLElement &&
    document.activeElement instanceof Node &&
    editor.contains(document.activeElement)
  ) {
    editor.blur();
  }
}

function EmbeddedDatabaseBlock({ containerItemId }: { readonly containerItemId: string }) {
  const context = useDatabaseViewBlockContext();
  if (context === null || containerItemId === "") return null;
  return (
    <div
      className="editor-database-view-block"
      contentEditable={false}
      data-testid="database-view-block"
      onMouseDown={keepDatabaseInteraction}
    >
      <DatabaseContainerPage
        containerItemId={containerItemId as Uuid}
        service={context.service}
        onOpenEntry={context.openItem as (itemId: Uuid) => void}
      />
    </div>
  );
}

/** The block shows every view of the database page created under the host page. */
export const databaseViewBlockSpec = createReactBlockSpec(
  {
    type: "databaseView",
    propSchema: {
      containerItemId: { default: "" },
      viewId: { default: "" },
    },
    content: "none",
  } as const,
  {
    meta: { selectable: true, isolating: true },
    render: ({ block }) => <EmbeddedDatabaseBlock containerItemId={block.props.containerItemId} />,
  },
);
