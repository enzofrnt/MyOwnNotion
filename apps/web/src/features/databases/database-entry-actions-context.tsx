import type { Uuid } from "@myownnotion/domain";
import { createContext } from "react";
import type { DatabaseViewRow } from "../../services/databases.ts";
import type { ConvertOutcome } from "../navigation/convert-item.tsx";
import type { BoardCardDraft } from "./board-card-editor.tsx";
import type { RelationOption } from "./value-editor.tsx";

export interface DatabaseEntryActions {
  readonly relationOptions: readonly RelationOption[];
  readonly save: (row: DatabaseViewRow, draft: BoardCardDraft) => Promise<void>;
  readonly convert: (
    id: Uuid,
    kind: "page" | "folder",
    confirmed: boolean,
  ) => Promise<ConvertOutcome>;
  readonly trash: (id: Uuid) => Promise<void>;
  readonly openFullPage: (id: Uuid) => void;
  readonly editIcon: (id: Uuid) => void;
}
export const DatabaseEntryActionsContext = createContext<DatabaseEntryActions | null>(null);
