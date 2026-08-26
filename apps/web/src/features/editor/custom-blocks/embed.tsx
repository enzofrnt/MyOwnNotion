import { createReactBlockSpec } from "@blocknote/react";
import { type EmbedProvider, validateDocumentV3 } from "@myownnotion/domain";
import { useEffect, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";

const PROVIDERS = ["bookmark", "youtube", "vimeo", "figma", "github"] as const;
const VALIDATION_BLOCK_ID = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056";
export const EMBED_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-presentation";

const DEFAULT_SOURCE: Readonly<Record<EmbedProvider, string>> = {
  bookmark: "https://example.org/",
  youtube: "https://www.youtube.com/watch?v=",
  vimeo: "https://vimeo.com/",
  figma: "https://www.figma.com/file/",
  github: "https://github.com/",
};

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

export function embedPreviewUrl(provider: EmbedProvider, sourceUrl: string): string | null {
  if (!isSafeEmbedSource(provider, sourceUrl)) return null;
  const url = new URL(sourceUrl);
  if (provider === "youtube") {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const videoId =
      url.hostname === "youtu.be"
        ? pathParts[0]
        : (url.searchParams.get("v") ??
          (["embed", "shorts", "live"].includes(pathParts[0] ?? "") ? pathParts[1] : null));
    return videoId !== null && videoId !== undefined && /^[\w-]{1,128}$/u.test(videoId)
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
      : null;
  }
  if (provider === "vimeo") {
    const videoId = url.pathname.split("/").filter(Boolean).at(-1);
    return videoId !== undefined && /^\d{1,20}$/u.test(videoId)
      ? `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`
      : null;
  }
  if (provider === "figma") {
    return `https://www.figma.com/embed?embed_host=myownnotion&url=${encodeURIComponent(sourceUrl)}`;
  }
  return null;
}

export function EmbedPreview({
  provider,
  sourceUrl,
  caption,
}: {
  readonly provider: EmbedProvider;
  readonly sourceUrl: string;
  readonly caption: string;
}) {
  const consentKey = `${provider}\u0000${sourceUrl}`;
  const [consentedFor, setConsentedFor] = useState<string | null>(null);
  const consented = consentedFor === consentKey;
  const safe = isSafeEmbedSource(provider, sourceUrl);
  const iframeUrl = safe ? embedPreviewUrl(provider, sourceUrl) : null;

  return (
    <div className="editor-embed-preview">
      <header>
        <strong>{caption || provider}</strong>
        {safe ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            {FR_COPY.editor.richBlocks.embed.openSource}
          </a>
        ) : null}
      </header>
      {!safe ? (
        <p role="alert">{FR_COPY.editor.richBlocks.embed.unsafe}</p>
      ) : iframeUrl === null ? (
        <p className="muted">{FR_COPY.editor.richBlocks.embed.staticPreview}</p>
      ) : consented ? (
        <iframe
          title={caption || `Contenu ${provider}`}
          src={iframeUrl}
          sandbox={EMBED_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow="fullscreen; picture-in-picture"
        />
      ) : (
        <button type="button" onClick={() => setConsentedFor(consentKey)}>
          {FR_COPY.editor.richBlocks.embed.consent}
        </button>
      )}
    </div>
  );
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
    render: ({ block, editor }) => {
      const [provider, setProvider] = useState(block.props.provider as EmbedProvider);
      const [sourceUrl, setSourceUrl] = useState(block.props.sourceUrl);
      const [caption, setCaption] = useState(block.props.caption);
      const [invalidSource, setInvalidSource] = useState(false);

      useEffect(() => setProvider(block.props.provider as EmbedProvider), [block.props.provider]);
      useEffect(() => setSourceUrl(block.props.sourceUrl), [block.props.sourceUrl]);
      useEffect(() => setCaption(block.props.caption), [block.props.caption]);

      const changeProvider = (next: EmbedProvider): void => {
        const nextSource = isSafeEmbedSource(next, sourceUrl) ? sourceUrl : DEFAULT_SOURCE[next];
        setProvider(next);
        setSourceUrl(nextSource);
        setInvalidSource(false);
        editor.updateBlock(block.id, { props: { provider: next, sourceUrl: nextSource } });
      };

      const commitSource = (): void => {
        if (!isSafeEmbedSource(provider, sourceUrl)) {
          setInvalidSource(true);
          return;
        }
        setInvalidSource(false);
        editor.updateBlock(block.id, { props: { sourceUrl } });
      };

      return (
        <article className="editor-embed-block" contentEditable={false}>
          <div className="editor-embed-fields">
            <label>
              <span className="sr-only">{FR_COPY.editor.richBlocks.embed.provider}</span>
              <select
                aria-label={FR_COPY.editor.richBlocks.embed.provider}
                value={provider}
                disabled={!editor.isEditable}
                onChange={(event) => changeProvider(event.currentTarget.value as EmbedProvider)}
              >
                {PROVIDERS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-embed-source-field">
              <span className="sr-only">{FR_COPY.editor.richBlocks.embed.source}</span>
              <input
                type="url"
                aria-label={FR_COPY.editor.richBlocks.embed.source}
                aria-invalid={invalidSource}
                value={sourceUrl}
                disabled={!editor.isEditable}
                onChange={(event) => setSourceUrl(event.currentTarget.value)}
                onBlur={commitSource}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
            <label>
              <span className="sr-only">{FR_COPY.editor.richBlocks.embed.caption}</span>
              <input
                aria-label={FR_COPY.editor.richBlocks.embed.caption}
                placeholder={FR_COPY.editor.richBlocks.embed.caption}
                value={caption}
                disabled={!editor.isEditable}
                onChange={(event) => setCaption(event.currentTarget.value)}
                onBlur={() => editor.updateBlock(block.id, { props: { caption } })}
              />
            </label>
          </div>
          {invalidSource ? (
            <p role="alert">{FR_COPY.editor.richBlocks.embed.unsafe}</p>
          ) : (
            <EmbedPreview provider={provider} sourceUrl={sourceUrl} caption={caption} />
          )}
        </article>
      );
    },
    toExternalHTML: ({ block }) => {
      const provider = block.props.provider as EmbedProvider;
      return isSafeEmbedSource(provider, block.props.sourceUrl) ? (
        <a href={block.props.sourceUrl}>{block.props.caption || provider}</a>
      ) : (
        <span>{block.props.caption || provider}</span>
      );
    },
  },
);
