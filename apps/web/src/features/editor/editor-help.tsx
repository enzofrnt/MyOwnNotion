import { MARKDOWN_SHORTCUTS } from "./markdown-shortcuts.ts";

export function EditorHelp() {
  return (
    <details className="editor-help">
      <summary>Keyboard shortcuts</summary>
      <p className="muted">Type these only at the start of an empty block.</p>
      <p className="muted">Press Cmd/Ctrl+Z immediately after a transformation to restore it.</p>
      <dl>
        {MARKDOWN_SHORTCUTS.map((shortcut) => (
          <div key={shortcut.id}>
            <dt>{shortcut.label}</dt>
            <dd>
              <kbd>{shortcut.input}</kbd> then {shortcut.activation}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
