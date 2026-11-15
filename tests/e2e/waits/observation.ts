/**
 * Negative claims observed over a window bounded by positive proofs (feature 060).
 *
 * "X never happens" cannot be shown by looking once after a delay: the delay
 * neither guarantees the risky moment has passed nor that it was observed. The
 * recorder below captures every value an attribute takes on every element
 * matching a selector — including elements mounted later — from before the
 * gesture until the journey has proved, positively, that the risky moment is
 * over. The negative assertion then reads the whole history.
 */
import type { Page } from "@playwright/test";

export interface AttributeHistory {
  /**
   * Every value taken *after* recording started, in order. The value present
   * at the start is excluded: it belongs to the state before the gesture, and
   * a journey asserts the current state separately.
   */
  readonly values: () => Promise<readonly (string | null)[]>;
}

export async function recordAttribute(
  page: Page,
  selector: string,
  attribute: string,
): Promise<AttributeHistory> {
  const key = `__attributeHistory_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ selector, attribute, key }) => {
      const history: (string | null)[] = [];
      const sample = () => {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          const value = element.getAttribute(attribute);
          if (history.at(-1) !== value) history.push(value);
        }
      };
      sample();
      new MutationObserver(sample).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [attribute],
      });
      (window as unknown as Record<string, unknown>)[key] = history;
    },
    { selector, attribute, key },
  );
  return {
    values: async () =>
      await page.evaluate(
        (key) =>
          ((window as unknown as Record<string, unknown>)[key] as (string | null)[]).slice(1),
        key,
      ),
  };
}

/**
 * Resolves on the server's first refusal of a page synchronization request.
 *
 * Page edits travel over the `page-sync` WebSocket, so a refused send is a
 * `sync-problem` frame answering one of this page's `sync` requests, never an
 * HTTP status. Install it before the gesture: frames are events and an earlier
 * one cannot be observed afterwards.
 */
export function nextPageSyncProblem(
  page: Page,
  options: { readonly timeout?: number } = {},
): Promise<{ readonly code: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the server never refused a page synchronization request")),
      options.timeout ?? 30_000,
    );
    page.on("websocket", (socket) => {
      if (!new URL(socket.url()).pathname.endsWith("/page-sync/socket")) return;
      socket.on("framereceived", (frame) => {
        try {
          const message = JSON.parse(String(frame.payload)) as {
            type?: string;
            problem?: { code?: string };
          };
          if (message.type !== "sync-problem") return;
          clearTimeout(timer);
          resolve({ code: message.problem?.code ?? "unknown" });
        } catch {
          // Not JSON: not a protocol message.
        }
      });
    });
  });
}
