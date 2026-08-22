import { createReactBlockSpec } from "@blocknote/react";
import { type EmbedProvider, validateDocumentV3 } from "@myownnotion/domain";
import { useState } from "react";

const PROVIDERS = ["bookmark", "youtube", "vimeo", "figma", "github"] as const;
const VALIDATION_BLOCK_ID = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056";

export function isSafeEmbedSource(provider: EmbedProvider, sourceUrl: string): boolean {
  return validateDocumentV3({
    blocks: [
      {
        type: "embed",
        id: VALIDATION_BLOCK_ID,
        provider,
        sourceUrl,
        caption: null,
      },
    ],
  }).ok;
}

function previewUrl(provider: EmbedProvider, sourceUrl: string): string | null {
  if (!isSafeEmbedSource(provider, sourceUrl)) return null;
  const url = new URL(sourceUrl);
  if (provider === "youtube") {
    const videoId = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
    return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : null;
  }
  if (provider === "vimeo") {
    const videoId = url.pathname.split("/").filter(Boolean).at(-1);
    return videoId ? `https://player.vimeo.com/video/${encodeURIComponent(videoId)}` : null;
  }
  if (provider === "figma") return sourceUrl;
  return null;
}

export const embedBlockSpec = createReactBlockSpec(
  {
    type: "embed",
    propSchema: {
      provider: { default: "bookmark", values: PROVIDERS },
      sourceUrl: { default: "https://example.org/" },
      caption: { default: "" },
    },
    content: "none",
  } as const,
  {
    meta: { selectable: true, isolating: true },
    render: ({ block }) => {
      const [consented, setConsented] = useState(false);
      const provider = block.props.provider as EmbedProvider;
      const safe = isSafeEmbedSource(provider, block.props.sourceUrl);
      const iframeUrl = safe ? previewUrl(provider, block.props.sourceUrl) : null;
      return (
        <article className="editor-embed-block" contentEditable={false}>
          <header>
            <strong>{block.props.caption || provider}</strong>
            <a
              href={safe ? block.props.sourceUrl : undefined}
              target="_blank"
              rel="noreferrer noopener"
            >
              Ouvrir la source
            </a>
          </header>
          {!safe ? (
            <p role="alert">Cette adresse n’est pas autorisée pour ce fournisseur.</p>
          ) : iframeUrl === null ? (
            <p className="muted">Aperçu statique — aucune communication avec le site tiers.</p>
          ) : consented ? (
            <iframe
              title={block.props.caption || `Contenu ${provider}`}
              src={iframeUrl}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              allow="fullscreen; picture-in-picture"
            />
          ) : (
            <button type="button" onClick={() => setConsented(true)}>
              Charger le contenu tiers
            </button>
          )}
        </article>
      );
    },
    toExternalHTML: ({ block }) => (
      <a href={block.props.sourceUrl}>{block.props.caption || block.props.provider}</a>
    ),
  },
);
