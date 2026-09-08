import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopRuntime,
  FileDialogInput,
  SetProfileInput,
  WrappedKeyEnvelope,
} from "./ipc-contract.ts";
import { IPC_CHANNELS, resolveDesktopPlatform } from "./ipc-contract.ts";

const platform = resolveDesktopPlatform();
declare const __DESKTOP_VERSION__: string;

const runtime: DesktopRuntime = {
  platform,
  appVersion: __DESKTOP_VERSION__,
  getActiveProfile: () => ipcRenderer.invoke(IPC_CHANNELS.getActiveProfile),
  setActiveProfile: (input: SetProfileInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveProfile, input),
  getKeyState: () => ipcRenderer.invoke(IPC_CHANNELS.getKeyState),
  wrapDeviceKey: (input: Uint8Array) => ipcRenderer.invoke(IPC_CHANNELS.wrapDeviceKey, input),
  unwrapDeviceKey: (input: WrappedKeyEnvelope) =>
    ipcRenderer.invoke(IPC_CHANNELS.unwrapDeviceKey, input),
  saveFile: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveFile, input),
  chooseFile: (input: FileDialogInput) => ipcRenderer.invoke(IPC_CHANNELS.chooseFile, input),
  openExternal: (input) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, input),
  getWindowState: () => ipcRenderer.invoke(IPC_CHANNELS.getWindowState),
  update: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
    context: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateContext, input),
    defer: () => ipcRenderer.invoke(IPC_CHANNELS.updateDefer),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
  },
};

contextBridge.exposeInMainWorld("myownnotionDesktop", runtime);
