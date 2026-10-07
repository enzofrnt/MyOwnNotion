// @vitest-environment jsdom

import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import { restoreEntryPeekFocus } from "../src/features/databases/restore-entry-peek-focus.ts";

afterEach(() => document.body.replaceChildren());

function fixture() {
  const entryId = generateUuidV7();
  const main = document.createElement("main");
  main.className = "workspace-main";
  const trigger = document.createElement("button");
  trigger.dataset.entryTrigger = entryId;
  main.append(trigger);
  const peek = document.createElement("div");
  const close = document.createElement("button");
  peek.append(close);
  document.body.append(main, peek);
  close.focus();
  return { origin: { entryId, trigger }, trigger, peek, main };
}

describe("entry peek focus return", () => {
  it.each([false, true])(
    "returns to the entry after an ordinary close (removed: %s)",
    (removed) => {
      const { origin, trigger, peek } = fixture();
      if (removed) peek.remove();
      restoreEntryPeekFocus(origin, peek);
      expect(document.activeElement).toBe(trigger);
    },
  );

  it.each([false, true])("preserves a newer menu focus (closing origin known: %s)", (known) => {
    const { origin, peek } = fixture();
    const menu = document.createElement("div");
    menu.setAttribute("role", "dialog");
    const option = document.createElement("button");
    menu.append(option);
    document.body.append(menu);
    option.focus();
    restoreEntryPeekFocus(origin, known ? peek : null);
    expect(document.activeElement).toBe(option);
  });

  it("finds the current entry trigger after a projection replaces it", () => {
    const { origin, trigger, peek, main } = fixture();
    const replacement = trigger.cloneNode() as HTMLButtonElement;
    main.replaceChildren(replacement);
    peek.remove();
    restoreEntryPeekFocus(origin, peek);
    expect(document.activeElement).toBe(replacement);
  });

  it("does not move focus into an entry whose origin is no longer available", () => {
    const { peek, trigger } = fixture();
    peek.remove();
    restoreEntryPeekFocus(null, peek);
    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(trigger);
  });
});
