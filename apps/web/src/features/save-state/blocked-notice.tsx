/**
 * What a refused write means, in the three parts FR-010 requires (T041, US2).
 *
 * The save indicator says *blocked* in a line; this says what the owner needs
 * in order to act, and it says it as three separate statements rather than one
 * sentence:
 *
 * 1. **what is refused** — the server's reason, never paraphrased into
 *    something friendlier, because an owner who cannot tell a key rotation from
 *    an outage cannot choose what to do next;
 * 2. **that existing content is still readable** — the question actually being
 *    asked when a note-taking application refuses a write is *have I lost
 *    anything*, and it deserves a direct answer;
 * 3. **what would resolve it**.
 *
 * Rendered only when something is blocked. A permanent panel that says
 * "nothing is blocked" is furniture, and furniture is not read when it changes.
 */

import type { OutboxMutationRow, SaveState } from "@myownnotion/client-core";
import { deriveSaveState, rowsForItem } from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AsyncState } from "../../ui/primitives/async-state.tsx";

export function BlockedNotice({
  service,
  itemId,
}: {
  readonly service: LocalContentService;
  readonly itemId: string;
}) {
  const [rows, setRows] = useState<OutboxMutationRow[]>([]);

  useEffect(() => {
    const refresh = async () => {
      setRows(await service.outbox.all());
    };
    void refresh();
    return service.subscribe(() => {
      void refresh();
    });
  }, [service]);

  const state: SaveState = deriveSaveState(rowsForItem(rows, itemId), navigator.onLine);
  if (state.kind !== "blocked") {
    return null;
  }

  return (
    <AsyncState
      kind="error"
      state="blocked"
      testId="blocked-notice"
      title="Modification refusée par le serveur"
      description={
        <>
          <p data-testid="blocked-what">{state.reason}</p>
          <p data-testid="blocked-readable">
            Tout le contenu déjà enregistré reste présent et lisible. Seule la dernière modification
            est concernée.
          </p>
          <p data-testid="blocked-resolution">{state.resolution}</p>
        </>
      }
    />
  );
}
