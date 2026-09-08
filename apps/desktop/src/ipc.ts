import { type BrowserWindow, dialog, type IpcMainInvokeEvent, shell } from "electron";
import { diagnosticMessage } from "./diagnostics.ts";
import type {
  FileDialogInput,
  FileDialogResult,
  IpcChannel,
  ProfileResult,
  SaveFileInput,
  SaveFileResult,
  SetProfileInput,
  UnwrappedKeyResult,
  UpdateState,
  WindowState,
  WrappedKeyEnvelope,
  WrappedKeyResult,
} from "./ipc-contract.ts";
import { IPC_CHANNELS, isDesktopAppUrl } from "./ipc-contract.ts";
import { MAX_FILE_BYTES, validIpcPayload } from "./ipc-validation.ts";
import { performOpenExternal } from "./native-capabilities.ts";
import type { NativeKeyStorage } from "./native-key-storage.ts";
import { decideNavigation } from "./navigation-policy.ts";
import { activeProfile, type ProfileStore, persistUpsert } from "./profile-store.ts";
import type { UpdateOrchestrator } from "./updates.ts";

export interface IpcHost {
  readonly store: ProfileStore;
  readonly keys: NativeKeyStorage;
  readonly updates: UpdateOrchestrator;
  readonly getWindowState: () => WindowState;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly onProfileChanged: (serverUrl: string) => void;
}

export function senderAllowed(
  event: IpcMainInvokeEvent,
  activeOrigin: string | null,
  window: BrowserWindow | null,
): boolean {
  if (
    window === null ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  const url = event.senderFrame?.url;
  if (url === undefined) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (isDesktopAppUrl(parsed)) {
      return true;
    }
    return activeOrigin !== null && decideNavigation(parsed, new URL(activeOrigin)) === "allow";
  } catch {
    return false;
  }
}

export function createIpcHandler(host: IpcHost) {
  return async (
    channel: IpcChannel,
    event: IpcMainInvokeEvent,
    payload: unknown,
  ): Promise<unknown> => {
    const profile = activeProfile(host.store.loadAll());
    if (
      !senderAllowed(event, profile?.serverUrl ?? null, host.getMainWindow()) ||
      !validIpcPayload(channel, payload)
    ) {
      return { ok: false, message: diagnosticMessage("ipc.sender", "refused").message };
    }
    try {
      switch (channel) {
        case IPC_CHANNELS.getActiveProfile:
          return profile;
        case IPC_CHANNELS.setActiveProfile: {
          const input = payload as SetProfileInput;
          const mutation = persistUpsert(host.store, input);
          if (mutation.result.ok) {
            host.onProfileChanged(mutation.result.profile.serverUrl);
          }
          return mutation.result satisfies ProfileResult;
        }
        case IPC_CHANNELS.getKeyState:
          return await host.keys.state();
        case IPC_CHANNELS.wrapDeviceKey: {
          const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(0);
          const keyId = crypto.randomUUID();
          return (await host.keys.wrap(bytes, keyId)) satisfies WrappedKeyResult;
        }
        case IPC_CHANNELS.unwrapDeviceKey:
          return (await host.keys.unwrap(
            payload as WrappedKeyEnvelope,
          )) satisfies UnwrappedKeyResult;
        case IPC_CHANNELS.chooseFile:
          return await chooseFile(host, payload as FileDialogInput);
        case IPC_CHANNELS.saveFile:
          return await saveFile(host, payload as SaveFileInput);
        case IPC_CHANNELS.openExternal: {
          const url = (payload as { readonly url?: string }).url ?? "";
          return await performOpenExternal(
            {
              openExternal: async (target) => {
                await shell.openExternal(target);
                return true;
              },
            },
            url,
          );
        }
        case IPC_CHANNELS.getWindowState:
          return host.getWindowState();
        case IPC_CHANNELS.updateCheck:
          return await host.updates.check();
        case IPC_CHANNELS.updateContext:
          host.updates.setContext(payload as { pendingLocalChanges: boolean });
          return host.updates.snapshot() satisfies UpdateState;
        case IPC_CHANNELS.updateDefer:
          return host.updates.defer();
        case IPC_CHANNELS.updateInstall:
          return await host.updates.install();
        case IPC_CHANNELS.getDiagnostics:
          return [];
        default:
          return { ok: false, message: "Unknown native capability." };
      }
    } catch {
      return {
        ok: false,
        state: "unavailable",
        message: "The native operation could not be completed.",
      };
    }
  };
}

async function chooseFile(host: IpcHost, input: FileDialogInput): Promise<FileDialogResult> {
  const window = host.getMainWindow();
  if (window === null) {
    return { ok: false, message: "The window is not ready." };
  }
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ["openFile"],
  };
  if (input.title !== undefined) {
    dialogOptions.title = input.title;
  }
  if (input.filters !== undefined) {
    dialogOptions.filters = input.filters.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    }));
  }
  const result = await dialog.showOpenDialog(window, dialogOptions);
  if (result.canceled || result.filePaths[0] === undefined) {
    return { ok: true, canceled: true };
  }
  const { open } = await import("node:fs/promises");
  const filePath = result.filePaths[0];
  const file = await open(filePath, "r");
  let bytes: Uint8Array;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      return { ok: false, message: "Choose a regular file smaller than 64 MiB." };
    bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("File changed while reading");
      offset += bytesRead;
    }
  } finally {
    await file.close();
  }
  const name = filePath.split(/[\\/]/).pop() ?? "file";
  return { ok: true, canceled: false, name, bytes };
}

async function saveFile(host: IpcHost, input: SaveFileInput): Promise<SaveFileResult> {
  const window = host.getMainWindow();
  if (window === null) {
    return { ok: false, message: "The window is not ready." };
  }
  const result = await dialog.showSaveDialog(window, { defaultPath: input.defaultName });
  if (result.canceled || result.filePath === undefined) {
    return { ok: true, canceled: true };
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(result.filePath, Buffer.from(input.bytes));
  return { ok: true, canceled: false };
}
