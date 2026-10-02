import { createContext, useContext } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

export interface DatabaseViewBlockContextValue {
  readonly service: LocalContentService;
  readonly openItem: (itemId: string) => void;
}

export const DatabaseViewBlockContext = createContext<DatabaseViewBlockContextValue | null>(null);

export function useDatabaseViewBlockContext(): DatabaseViewBlockContextValue | null {
  return useContext(DatabaseViewBlockContext);
}
