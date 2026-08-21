import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";

function UnknownBlockView({
  blockId,
  declaredType,
  rawJson,
}: {
  readonly blockId: string;
  readonly declaredType: string;
  readonly rawJson: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copyRawJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <aside
      className="editor-unknown-block"
      data-testid={`unknown-block-${blockId}`}
      data-unknown-block-type={declaredType}
      contentEditable={false}
    >
      <strong>Bloc non pris en charge</strong>
      <span>{declaredType}</span>
      <small>Son contenu est conservé sans modification.</small>
      <button type="button" onClick={() => void copyRawJson()}>
        Copier les données du bloc
      </button>
      <small role="status" aria-live="polite">
        {copyState === "copied"
          ? "Données copiées."
          : copyState === "failed"
            ? "La copie a échoué. Utilisez le menu du bloc pour le conserver ou le déplacer."
            : ""}
      </small>
    </aside>
  );
}

/**
 * A visible, deliberately non-editable carrier for content this editor does
 * not understand yet. The raw JSON stays in a string property so BlockNote's
 * schema can move or delete the block without interpreting its payload.
 */
export const unknownBlockSpec = createReactBlockSpec(
  {
    type: "unknown",
    propSchema: {
      declaredType: { default: "unknown" },
      rawJson: { default: "{}" },
      syntheticId: { default: false, type: "boolean" },
    },
    content: "none",
  } as const,
  {
    meta: { selectable: true, isolating: true },
    render: ({ block }) => (
      <UnknownBlockView
        blockId={block.id}
        declaredType={block.props.declaredType}
        rawJson={block.props.rawJson}
      />
    ),
    toExternalHTML: ({ block }) => (
      <div data-unknown-block-type={block.props.declaredType}>
        Bloc non pris en charge : {block.props.declaredType}
      </div>
    ),
  },
);
