// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageTitleEditor } from "../src/features/workspace/page-title-editor.tsx";

function typeInto(title: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(title, value);
  title.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("page title editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is the first large editable line and commits an empty draft as Sans titre", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor title="Projet Atlas" onCommit={onCommit} />);
    });

    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    expect(title?.getAttribute("aria-label")).toBe("Titre de la page");
    expect(title?.value).toBe("Projet Atlas");

    await act(async () => {
      if (title === null) return;
      title.focus();
      typeInto(title, "");
      title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledWith("Sans titre");
  });

  it("captures a replacement input before an immediate Enter commit", async () => {
    const onCommit = vi.fn(async () => undefined);
    const onDraftStateChange = vi.fn();
    await act(async () => {
      root.render(
        <PageTitleEditor
          initialDraft=""
          restoreFocus
          title="Sans titre"
          onCommit={onCommit}
          onDraftStateChange={onDraftStateChange}
        />,
      );
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        title,
        "Titre immédiat",
      );
      title.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "Titre immédiat",
          inputType: "insertReplacementText",
        }),
      );
      title.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(onDraftStateChange).toHaveBeenCalledWith("Titre immédiat", true);
    expect(onCommit).toHaveBeenCalledWith("Titre immédiat");
    expect(title.value).toBe("Titre immédiat");
  });

  it("keeps a native replacement through a concurrent projection render", async () => {
    const onCommit = vi.fn(async () => undefined);
    const editor = (
      <PageTitleEditor initialDraft="" restoreFocus title="Sans titre" onCommit={onCommit} />
    );
    await act(async () => {
      root.render(editor);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      title,
      "Dossier immédiat",
    );
    await act(async () => {
      // WebKit can let a projection render run after applying the replacement
      // but before React receives the native input event. That render must not
      // put the previous blank draft back into the textarea.
      root.render(editor);
    });
    expect(title.value).toBe("Dossier immédiat");

    await act(async () => {
      title.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "Dossier immédiat",
          inputType: "insertReplacementText",
        }),
      );
      title.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith("Dossier immédiat");
  });

  it("does not replace the draft or cursor when a remote title arrives during editing", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor title="Avant" onCommit={onCommit} />);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    await act(async () => {
      title.focus();
      typeInto(title, "Brouillon local");
      title.setSelectionRange(9, 9);
      root.render(<PageTitleEditor title="Titre distant" onCommit={onCommit} />);
    });

    expect(title.value).toBe("Brouillon local");
    expect(title.selectionStart).toBe(9);
  });

  it("keeps the submitted title while an older projection arrives during commit", async () => {
    let resolveCommit: (() => void) | undefined;
    const onCommit = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    await act(async () => {
      root.render(<PageTitleEditor title="Sans titre" onCommit={onCommit} />);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    await act(async () => {
      title.focus();
      typeInto(title, "Titre local");
      title.blur();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith("Titre local");

    await act(async () => {
      root.render(<PageTitleEditor title="Projection obsolète" onCommit={onCommit} />);
    });
    expect(title.value).toBe("Titre local");

    await act(async () => {
      resolveCommit?.();
      await Promise.resolve();
      root.render(<PageTitleEditor title="Titre local" onCommit={onCommit} />);
    });
    expect(title.value).toBe("Titre local");
  });

  it("retains the focused draft when route projection churn remounts the title", async () => {
    const onCommit = vi.fn(async () => undefined);

    function Harness({ surface }: { readonly surface: number }) {
      const [session, setSession] = useState<{
        readonly draft: string;
        readonly focused: boolean;
      }>({ draft: "", focused: true });
      return (
        <PageTitleEditor
          key={surface}
          initialDraft={session.draft}
          restoreFocus={session.focused}
          title="Sans titre"
          onDraftStateChange={(draft, focused) => setSession({ draft, focused })}
          onCommit={onCommit}
        />
      );
    }

    await act(async () => {
      root.render(<Harness surface={0} />);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");
    await act(async () => {
      typeInto(title, "Titre conservé");
    });
    await act(async () => {
      root.render(<Harness surface={1} />);
    });

    const remounted = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="active-item-title"]',
    );
    expect(remounted?.value).toBe("Titre conservé");
    expect(remounted).toBe(document.activeElement);
    await act(async () => {
      remounted?.blur();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith("Titre conservé");
  });

  it("keeps a focused empty draft blank until the owner leaves the field", async () => {
    vi.useFakeTimers();
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor title="Projet" onCommit={onCommit} />);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    await act(async () => {
      title.focus();
      typeInto(title, "");
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(title.value).toBe("");
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      title.blur();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith("Sans titre");
    expect(title.value).toBe("Sans titre");
  });

  it("opens every newly created identity on one focused blank title", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <PageTitleEditor initialDraft="" restoreFocus title="Sans titre" onCommit={onCommit} />,
      );
    });

    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    expect(title).toBe(document.activeElement);
    expect(title?.value).toBe("");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("edits a folder through the same canonical identity component", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor kind="folder" icon="📁" title="Archives" onCommit={onCommit} />);
    });

    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    expect(title?.getAttribute("aria-label")).toBe("Nom du dossier");
    expect(container.querySelector('[data-kind="folder"]')).not.toBeNull();
    const kind = container.querySelector('[data-testid="active-item-kind"]');
    expect(kind?.textContent).toContain("Dossier");
    expect(kind?.querySelector('[data-icon="folder"]')).not.toBeNull();
  });

  it("shows a quiet page caption just below the canvas title, next to the type icon", async () => {
    await act(async () => {
      root.render(<PageTitleEditor title="Notes" onCommit={async () => undefined} />);
    });
    const kind = container.querySelector('[data-testid="active-item-kind"]');
    const title = container.querySelector('[data-testid="active-item-title"]');
    expect(kind?.textContent).toContain("Page");
    expect(kind?.querySelector('[data-icon="fileText"]')).not.toBeNull();
    expect(title?.nextElementSibling?.querySelector('[data-testid="active-item-kind"]')).toBe(kind);
  });

  it("pins folder create actions to the right of the centered kind caption", async () => {
    await act(async () => {
      root.render(
        <PageTitleEditor
          kind="folder"
          kindActions={<span data-testid="folder-kind-action">Nouveau</span>}
          title="Archives"
          onCommit={async () => undefined}
        />,
      );
    });
    const meta = container.querySelector(".workspace-page-title__meta");
    const kind = container.querySelector('[data-testid="active-item-kind"]');
    expect(meta?.firstElementChild).toBe(kind);
    expect(kind?.textContent).toContain("Dossier");
    expect(meta?.lastElementChild?.className).toBe("workspace-page-title__kind-actions");
    expect(meta?.querySelector('[data-testid="folder-kind-action"]')?.textContent).toBe("Nouveau");
  });
});
