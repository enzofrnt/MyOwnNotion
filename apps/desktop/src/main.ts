import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, safeStorage, screen, session, shell } from "electron";
import { PROTOCOL_VERSION } from "../../../packages/domain/src/sync/protocol-version.ts";
import { createIpcHandler } from "./ipc.ts";
import {
  IPC_CHANNELS,
  type IpcChannel,
  isIpcChannel,
  resolveDesktopPlatform,
} from "./ipc-contract.ts";
import { defaultMenuTemplate } from "./menu.ts";
import { performOpenExternal } from "./native-capabilities.ts";
import { createNativeKeyStorage, type NativeKeyStorage } from "./native-key-storage.ts";
import { DESKTOP_CSP, decideNavigation } from "./navigation-policy.ts";
import { profilesFile, windowStateFile } from "./paths.ts";
import { activeProfile, FileProfileStore } from "./profile-store.ts";
import { isServerDataPath } from "./protocol.ts";
import {
  onboardingUrl,
  registerLocalProtocol,
  registerOriginInterception,
} from "./protocol-register.ts";
import { sessionPartitionForProfile } from "./session-partition.ts";
import { createUpdateDriver } from "./update-download.ts";
import { UpdateOrchestrator } from "./updates.ts";
import { configureDesktopWebAuthn, registerWebAuthnSessionHandlers } from "./webauthn-config.ts";
import {
  DEFAULT_WINDOW_STATE,
  safeWindowRoute,
  sanitizeWindowState,
  type WindowState,
} from "./window-state.ts";

const DEFAULT_DEV_SERVER_URL = "https://localhost:8443";

function resolveInitialLoadUrl(serverUrl: string | null): string {
  if (process.env["MYOWNNOTION_DESKTOP_DEV"] === "1") {
    const devOrigin = process.env["MYOWNNOTION_DESKTOP_DEV_URL"] ?? DEFAULT_DEV_SERVER_URL;
    return serverUrl ?? devOrigin;
  }
  return serverUrl ?? onboardingUrl();
}

const hostPlatform = resolveDesktopPlatform();
declare const __DESKTOP_UPDATE_PUBLIC_KEY__: string;
const updates = new UpdateOrchestrator(
  __DESKTOP_UPDATE_PUBLIC_KEY__ && (process.arch === "arm64" || process.arch === "x64")
    ? createUpdateDriver({
        host: {
          version: app.getVersion(),
          platform: hostPlatform,
          architecture: process.arch,
          protocol: PROTOCOL_VERSION,
        },
        publicKey: __DESKTOP_UPDATE_PUBLIC_KEY__,
        directory: path.join(app.getPath("userData"), "updates"),
        launch: async (file) => {
          if (hostPlatform === "linux") {
            shell.showItemInFolder(file);
            return;
          }
          const error = await shell.openPath(file);
          if (error) throw new Error("Installer launch failed");
        },
      })
    : undefined,
);
let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let suppressClosePersist = false;

if (process.env["MYOWNNOTION_DESKTOP_DEV"] === "1") {
  app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
    try {
      const { hostname, protocol } = new URL(url);
      if (protocol === "https:" && (hostname === "localhost" || hostname === "127.0.0.1")) {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch {
      // Fall through to the default refusal.
    }
    callback(false);
  });
}

function revealMainWindow(focus = false): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  if (focus) {
    mainWindow.focus();
  }
}

function recreateMainWindow(): void {
  updates.setContext({ pendingLocalChanges: true });
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    suppressClosePersist = true;
    mainWindow.destroy();
    mainWindow = null;
    suppressClosePersist = false;
  }
  createWindow();
}

function loadWindowState(userData: string): WindowState {
  try {
    return sanitizeWindowState(
      JSON.parse(readFileSync(windowStateFile(userData), "utf8")),
      screen.getAllDisplays().map((display) => display.bounds),
    );
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

function persistWindowState(
  userData: string,
  window: BrowserWindow,
  lastProfileId: string | null,
): void {
  const bounds = window.getNormalBounds();
  const target = windowStateFile(userData);
  const temporary = `${target}.tmp`;
  const lastRoute = safeWindowRoute(new URL(window.webContents.getURL()).pathname);
  writeFileSync(
    temporary,
    `${JSON.stringify({
      bounds,
      isMaximized: window.isMaximized(),
      lastRoute,
      lastProfileId,
    } satisfies WindowState)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, target);
}

function registerIpcOnce(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;
  const userData = app.getPath("userData");
  const store = new FileProfileStore(profilesFile(userData));
  const stores = new Map<string, NativeKeyStorage>();
  const ipc = createIpcHandler({
    store,
    get keys() {
      const profile = activeProfile(store.loadAll());
      if (profile === null) throw new Error("No active profile");
      let keys = stores.get(profile.profileId);
      if (keys === undefined) {
        keys = createNativeKeyStorage({
          userData: path.join(userData, "vaults", profile.profileId),
          legacyUserData: userData,
          platform: hostPlatform,
          safeStorage,
        });
        stores.set(profile.profileId, keys);
      }
      return keys;
    },
    updates,
    getWindowState: () => loadWindowState(userData),
    getMainWindow: () => mainWindow,
    onProfileChanged: () => {
      recreateMainWindow();
    },
  });
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isIpcChannel(channel)) {
        return { ok: false };
      }
      return ipc(channel as IpcChannel, event, payload);
    });
  }
}

function revealMainWindowFromEvent(): void {
  revealMainWindow(true);
}

function createWindow(): void {
  const userData = app.getPath("userData");
  const store = new FileProfileStore(profilesFile(userData));
  const profile = activeProfile(store.loadAll());
  const windowState = loadWindowState(userData);
  const partition = sessionPartitionForProfile(profile?.profileId ?? null);
  const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs");
  const windowSession = session.fromPartition(partition);
  if (windowSession.cookies.listenerCount("changed") === 0) {
    windowSession.cookies.on("changed", () => {
      void windowSession.cookies
        .flushStore()
        .catch(() => console.error("desktop session could not be persisted"));
    });
  }
  registerWebAuthnSessionHandlers(windowSession);

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    show: false,
    title: "MyOwnNotion",
    backgroundColor: "#f7f6f3",
    ...(hostPlatform === "darwin" ? { acceptFirstMouse: true } : {}),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  windowSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [DESKTOP_CSP],
      },
    });
  });
  registerLocalProtocol(windowSession);
  registerOriginInterception(windowSession, () => {
    const current = activeProfile(new FileProfileStore(profilesFile(userData)).loadAll());
    return current === null ? null : new URL(current.serverUrl);
  });

  const openSystemLink = (url: string) => {
    void performOpenExternal(
      {
        openExternal: async (target) => {
          await shell.openExternal(target);
          return true;
        },
      },
      url,
    ).catch(() => console.error("desktop external link could not be opened"));
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSystemLink(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const active = profile === null ? null : new URL(profile.serverUrl);
    if (decideNavigation(new URL(url), active) === "deny") {
      event.preventDefault();
      if (!isServerDataPath(new URL(url).pathname)) openSystemLink(url);
    }
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    const active = profile === null ? null : new URL(profile.serverUrl);
    if (decideNavigation(new URL(url), active) === "deny") event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  windowSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  windowSession.setPermissionCheckHandler(() => false);
  windowSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const active = profile === null ? null : new URL(profile.serverUrl);
    const executable = ["script", "stylesheet", "subFrame", "mainFrame"].includes(
      details.resourceType,
    );
    const dataExecutable = executable && isServerDataPath(url.pathname);
    const foreignExecutable =
      executable &&
      !["devtools:", "myownnotion:"].includes(url.protocol) &&
      url.origin !== active?.origin;
    callback({ cancel: dataExecutable || foreignExecutable });
  });
  mainWindow.webContents.on("preload-error", (_event, _preloadPath, _error) => {
    console.error("desktop preload failed");
  });
  const contents = mainWindow.webContents;
  contents.on("did-fail-load", (_event, code, _description, _validatedUrl) => {
    console.error("desktop window load failed", code);
    revealMainWindow();
  });
  contents.on("did-finish-load", () => {
    revealMainWindow();
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([...defaultMenuTemplate(hostPlatform)]));
  mainWindow.on("close", () => {
    if (suppressClosePersist || mainWindow === null) {
      return;
    }
    try {
      persistWindowState(userData, mainWindow, profile?.profileId ?? null);
    } catch {
      console.error("desktop window preferences could not be saved");
    }
  });
  mainWindow.once("ready-to-show", () => revealMainWindow());

  const restoredRoute =
    windowState.lastProfileId === profile?.profileId ? windowState.lastRoute : null;
  const target =
    restoredRoute !== null && profile !== null
      ? new URL(restoredRoute, profile.serverUrl).href
      : resolveInitialLoadUrl(profile?.serverUrl ?? null);
  mainWindow.loadURL(target).catch(() => {
    console.error("desktop window failed to load");
    revealMainWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    revealMainWindowFromEvent();
  });
  void app.whenReady().then(() => {
    configureDesktopWebAuthn();
    registerIpcOnce();
    createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    revealMainWindowFromEvent();
  });
}
