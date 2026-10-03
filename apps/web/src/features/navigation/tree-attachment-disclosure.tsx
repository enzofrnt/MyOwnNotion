import { type ReactNode, useCallback, useEffect, useState } from "react";

interface TreeAttachmentDisclosureProps {
  /** Navigation identity, independent of the page whose files are inspected. */
  readonly activeViewId: string | null;
  readonly children: (open: boolean, toggle: () => void) => ReactNode;
}

/** Keep a presentation-only toggle local to its row, without rerendering the
 * workspace's other rows, menus, or durable editor sessions. No wrapper DOM:
 * the collapsible panel remains adjacent to the row for its closing join. */
export function TreeAttachmentDisclosure({
  activeViewId,
  children,
}: TreeAttachmentDisclosureProps) {
  const [disclosure, setDisclosure] = useState({ viewId: activeViewId, open: false });
  const toggle = useCallback(
    () =>
      setDisclosure((current) => ({
        viewId: activeViewId,
        open: current.viewId !== activeViewId || !current.open,
      })),
    [activeViewId],
  );
  useEffect(() => {
    // Close only after actual navigation. Closed rows keep their state object
    // so changing pages does not schedule an extra render for every tree row.
    setDisclosure((current) =>
      current.open && current.viewId !== activeViewId ? { ...current, open: false } : current,
    );
  }, [activeViewId]);
  return children(disclosure.viewId === activeViewId && disclosure.open, toggle);
}
