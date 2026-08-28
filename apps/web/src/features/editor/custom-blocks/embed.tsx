import { createReactBlockSpec } from "@blocknote/react";
import { type EmbedProvider, validateDocumentV3 } from "@myownnotion/domain";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon } from "../../../ui/icons.tsx";
import { Button } from "../../../ui/primitives/index.ts";
import { WebBookmarkDialog, type WebBookmarkEditor } from "../editor-menus/web-bookmark-dialog.tsx";

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

export function webBookmarkPresentation(sourceUrl: string): {
  readonly href: string;
  readonly domain: string;
} | null {
  if (!isSafeEmbedSource("bookmark", sourceUrl)) return null;
  const url = new URL(sourceUrl);
  return {
    href: url.href,
    domain: url.hostname.replace(/^www\./u, "") || url.href,
  };
}

export function WebBookmarkCard({
  editable = false,
  onEdit,
  onRemove,
  sourceUrl,
}: {
  readonly sourceUrl: string;
  readonly editable?: boolean;
  readonly onEdit?: (() => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
}) {
  const presentation = webBookmarkPresentation(sourceUrl);
  const [contextPoint, setContextPoint] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const contextMenu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (contextPoint === null) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !contextMenu.current?.contains(event.target)) {
        setContextPoint(null);
      }
    };
    const closeWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setContextPoint(null);
    };
    const focusFrame = requestAnimationFrame(() => {
      contextMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [contextPoint]);
  if (presentation === null) {
    return <p role="alert">Saisissez un lien Web valide.</p>;
  }
  const openContextMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setContextPoint({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 224)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 152)),
    });
  };
  const closeContextMenu = (): void => setContextPoint(null);
  return (
    <>
      {contextPoint === null
        ? null
        : createPortal(
            <div
              ref={contextMenu}
              className="ui-menu web-bookmark-context-menu"
              role="menu"
              aria-label="Actions du lien Web"
              data-testid="web-bookmark-context-menu"
              style={{ left: contextPoint.x, top: contextPoint.y }}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="ui-menu__label">Lien Web</span>
              <button
                type="button"
                role="menuitem"
                className="ui-menu__item"
                data-testid="context-open-web-bookmark"
                onClick={() => {
                  window.open(presentation.href, "_blank", "noopener,noreferrer");
                  closeContextMenu();
                }}
              >
                Ouvrir le lien
              </button>
              {!editable || onEdit === undefined ? null : (
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  data-testid="context-edit-web-bookmark"
                  onClick={() => {
                    onEdit();
                    closeContextMenu();
                  }}
                >
                  Modifier le lien…
                </button>
              )}
              {!editable || onRemove === undefined ? null : (
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  data-testid="context-remove-web-bookmark"
                  onClick={() => {
                    onRemove();
                    closeContextMenu();
                  }}
                >
                  Retirer le lien
                </button>
              )}
            </div>,
            document.body,
          )}
      <article
        className="web-bookmark-card"
        data-testid="web-bookmark-card"
        onContextMenu={openContextMenu}
      >
        <a href={presentation.href} target="_blank" rel="noreferrer noopener">
          <span className="web-bookmark-card__mark">
            <AppIcon name="link" />
          </span>
          <span className="web-bookmark-card__content">
            <strong>{presentation.domain}</strong>
            <small>{presentation.href}</small>
          </span>
          <AppIcon name="reference" size="small" />
        </a>
        {!editable || (onEdit === undefined && onRemove === undefined) ? null : (
          <span className="web-bookmark-card__actions">
            {onEdit === undefined ? null : (
              <Button type="button" size="compact" variant="ghost" onClick={onEdit}>
                Modifier
              </Button>
            )}
            {onRemove === undefined ? null : (
              <Button type="button" size="compact" variant="ghost" onClick={onRemove}>
                Retirer
              </Button>
            )}
          </span>
        )}
      </article>
    </>
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
      const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);

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

      if (provider === "bookmark") {
        return (
          <div className="editor-web-bookmark" contentEditable={false}>
            <WebBookmarkCard
              sourceUrl={sourceUrl}
              editable={editor.isEditable}
              onEdit={() => setBookmarkDialogOpen(true)}
              onRemove={() => editor.removeBlocks([block.id])}
            />
            <WebBookmarkDialog
              editor={editor as unknown as WebBookmarkEditor}
              request={bookmarkDialogOpen ? { mode: "edit", blockId: block.id, sourceUrl } : null}
              onClose={() => setBookmarkDialogOpen(false)}
            />
          </div>
        );
      }

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
