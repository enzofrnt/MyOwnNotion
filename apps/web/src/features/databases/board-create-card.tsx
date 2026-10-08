import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";

/** The creation command stays below the list, including while a card is edited. */
export function BoardCreateCard({
  columnLabel,
  pending = false,
  onCreate,
}: {
  readonly columnLabel: string;
  readonly pending?: boolean;
  readonly onCreate: () => Promise<void>;
}) {
  const busy = useRef(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (busy.current || pending) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    try {
      await onCreate();
    } catch {
      setError(DATABASE_COPY.page.entryCreateFailed);
    } finally {
      busy.current = false;
      setCreating(false);
    }
  };
  return (
    <div className="database-board__create" aria-busy={pending || creating || undefined}>
      <Button
        size="compact"
        variant="ghost"
        className="database-board__add"
        data-board-create-trigger
        disabled={pending || creating}
        aria-label={DATABASE_COPY.board.newElementIn(columnLabel)}
        onClick={() => void create()}
      >
        <AppIcon name="add" size="small" /> {DATABASE_COPY.board.newElement}
      </Button>
      {error === null ? null : (
        <p className="database-board__create-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
