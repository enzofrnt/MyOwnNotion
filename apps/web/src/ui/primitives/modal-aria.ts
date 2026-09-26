import { useCallback, useRef, type ForwardedRef, type RefCallback } from "react";

/** Keep aria-modal on the active dialog when Ariakit hides a parent dialog. */
export function useModalAriaRef(
  forwardedRef: ForwardedRef<HTMLDivElement>,
  modal: boolean,
): RefCallback<HTMLDivElement> {
  const observer = useRef<MutationObserver | null>(null);

  return useCallback(
    (element) => {
      observer.current?.disconnect();
      observer.current = null;
      if (element !== null && modal) {
        const sync = (): void => {
          const role = element.getAttribute("role");
          const active = role === "dialog" || role === "alertdialog";
          if (active && element.getAttribute("aria-modal") !== "true") {
            element.setAttribute("aria-modal", "true");
          } else if (!active && element.hasAttribute("aria-modal")) {
            element.removeAttribute("aria-modal");
          }
        };
        sync();
        observer.current = new MutationObserver(sync);
        observer.current.observe(element, {
          attributes: true,
          attributeFilter: ["role", "aria-modal"],
        });
      }
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef !== null) forwardedRef.current = element;
    },
    [forwardedRef, modal],
  );
}
