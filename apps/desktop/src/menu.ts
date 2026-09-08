import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform } from "./ipc-contract.ts";

export interface DesktopMenuClick {
  readonly id:
    | "quit"
    | "undo"
    | "redo"
    | "cut"
    | "copy"
    | "paste"
    | "selectAll"
    | "reload"
    | "toggleDevTools";
}

export function defaultMenuTemplate(platform: DesktopPlatform): MenuItemConstructorOptions[] {
  if (platform === "darwin") {
    return [
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ];
  }
  return [{ role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }];
}
