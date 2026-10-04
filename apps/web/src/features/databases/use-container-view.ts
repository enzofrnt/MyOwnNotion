import { isUuid, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useState } from "react";

const keyFor = (containerId: Uuid) => `myOwnNotion.databaseContainerView.${containerId}`;

function read(containerId: Uuid): Uuid | null {
  try {
    const id = window.sessionStorage.getItem(keyFor(containerId));
    return isUuid(id) ? id : null;
  } catch {
    return null;
  }
}

/** Device-local navigation context. Only opaque identities are stored. */
export function useContainerView(containerId: Uuid) {
  const [selection, setSelection] = useState(() => ({ containerId, viewId: read(containerId) }));
  useEffect(() => {
    setSelection({ containerId, viewId: read(containerId) });
  }, [containerId]);
  const select = useCallback(
    (viewId: Uuid | null) => {
      setSelection({ containerId, viewId });
      try {
        if (viewId === null) window.sessionStorage.removeItem(keyFor(containerId));
        else window.sessionStorage.setItem(keyFor(containerId), viewId);
      } catch {
        // Storage can be unavailable in privacy mode; this mount still remembers its view.
      }
    },
    [containerId],
  );
  return [selection.containerId === containerId ? selection.viewId : null, select] as const;
}
