import { useEffect, useRef, useState } from "react";
import {
  Button,
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
} from "../../../ui/primitives/index.ts";
import { normalizeExternalLinkTarget } from "../editor-links.ts";

export interface WebBookmarkEditor {
  getBlock(blockId: string):
    | {
        readonly id: string;
        readonly type: string;
        readonly content?: unknown;
      }
    | undefined;
  updateBlock(blockId: string, update: unknown): unknown;
  insertBlocks(blocks: unknown[], referenceBlockId: string, placement: "after"): unknown;
  removeBlocks(blockIds: string[]): unknown;
  focus(): void;
}

export type WebBookmarkRequest =
  | { readonly mode: "create"; readonly anchorBlockId: string }
  | { readonly mode: "edit"; readonly blockId: string; readonly sourceUrl: string };

export function normalizeWebBookmarkUrl(value: string): string | null {
  const normalized = normalizeExternalLinkTarget(value);
  if (normalized === null) return null;
  const protocol = new URL(normalized).protocol;
  return protocol === "http:" || protocol === "https:" ? normalized : null;
}

function blockIsEmptyParagraph(block: ReturnType<WebBookmarkEditor["getBlock"]>): boolean {
  if (block === undefined || block.type !== "paragraph") return false;
  if (typeof block.content === "string") return block.content.trim() === "";
  return !Array.isArray(block.content) || block.content.length === 0;
}

export function writeWebBookmark(
  editor: WebBookmarkEditor,
  request: WebBookmarkRequest,
  sourceUrl: string,
): boolean {
  const normalized = normalizeWebBookmarkUrl(sourceUrl);
  if (normalized === null) return false;
  const update = {
    type: "embed" as const,
    props: { provider: "bookmark" as const, sourceUrl: normalized, caption: "" },
  };
  if (request.mode === "edit") {
    if (editor.getBlock(request.blockId) === undefined) return false;
    editor.updateBlock(request.blockId, update);
    return true;
  }
  const anchor = editor.getBlock(request.anchorBlockId);
  if (anchor === undefined) return false;
  // Media enters the operational model through an insert-block command. A
  // paragraph -> embed type change is deliberately unsupported and would be
  // rewound by the next durable projection. Insert first, then remove the empty
  // slash paragraph in the same editor transaction stream.
  editor.insertBlocks([update], anchor.id, "after");
  if (blockIsEmptyParagraph(anchor)) editor.removeBlocks([anchor.id]);
  return true;
}

export function WebBookmarkDialog({
  editor,
  onClose,
  request,
}: {
  readonly editor: WebBookmarkEditor;
  readonly request: WebBookmarkRequest | null;
  readonly onClose: () => void;
}) {
  const initialUrl = request?.mode === "edit" ? request.sourceUrl : "";
  const input = useRef<HTMLInputElement | null>(null);
  const previousRequest = useRef(request);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (previousRequest.current === request) return;
    previousRequest.current = request;
    if (input.current !== null) input.current.value = initialUrl;
    setValidation(null);
  }, [initialUrl, request]);

  if (request === null) return null;
  const finish = (): void => {
    onClose();
    queueMicrotask(() => editor.focus());
  };
  const save = (): void => {
    const visibleValue = input.current?.value ?? initialUrl;
    if (!writeWebBookmark(editor, request, visibleValue)) {
      setValidation("Saisissez un lien Web valide.");
      return;
    }
    finish();
  };

  return (
    <DialogRoot open setOpen={(open) => !open && finish()}>
      <DialogContent
        className="web-bookmark-dialog"
        size="small"
        data-testid="web-bookmark-dialog"
        initialFocus={input}
      >
        <DialogHeading>
          {request.mode === "edit" ? "Modifier le lien Web" : "Lien Web"}
        </DialogHeading>
        <DialogDismiss />
        <input
          ref={input}
          type="url"
          defaultValue={initialUrl}
          placeholder="https://exemple.fr"
          aria-label="Adresse Web"
          aria-invalid={validation !== null || undefined}
          onChange={() => setValidation(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        {validation === null ? null : (
          <p className="web-bookmark-dialog__error" role="alert">
            {validation}
          </p>
        )}
        <Button type="button" variant="primary" data-testid="save-web-bookmark" onClick={save}>
          {request.mode === "edit" ? "Enregistrer" : "Ajouter le lien"}
        </Button>
      </DialogContent>
    </DialogRoot>
  );
}
