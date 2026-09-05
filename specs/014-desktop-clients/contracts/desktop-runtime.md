# Desktop Runtime Contract

The renderer receives a narrow `window.myownnotionDesktop` bridge only when it
runs inside the packaged desktop client. The Web build keeps working without
the bridge.

```ts
interface DesktopRuntime {
  readonly platform: "win32" | "darwin" | "linux";
  readonly appVersion: string;
  readonly getActiveProfile: () => Promise<DesktopServerProfile | null>;
  readonly setActiveProfile: (input: SetProfileInput) => Promise<ProfileResult>;
  readonly getKeyState: () => Promise<KeyStateResult>;
  readonly wrapDeviceKey: (input: Uint8Array) => Promise<WrappedKeyResult>;
  readonly unwrapDeviceKey: (input: WrappedKeyEnvelope) => Promise<UnwrappedKeyResult>;
  readonly chooseFile: (input: FileDialogInput) => Promise<FileDialogResult>;
  readonly openExternal: (input: { url: string }) => Promise<OpenExternalResult>;
  readonly getWindowState: () => Promise<WindowState>;
  readonly update: {
    check: () => Promise<UpdateState>;
    defer: () => Promise<UpdateState>;
    install: () => Promise<UpdateState>;
  };
}
```

Rules:

1. No raw Electron object, `ipcRenderer`, filesystem path, shell command,
   cookie, session token or unrestricted URL is exposed.
2. Each request includes a schema-validated operation and is rejected unless it
   comes from the expected local renderer frame.
3. `openExternal` accepts only an explicitly approved `https:` URL or an
   owner-confirmed local URL; `javascript:`, `file:`, custom untrusted schemes
   and redirects outside the approved policy are rejected.
4. Key operations return typed success/failure. When the client-core adapter
   needs to import a key into a non-extractable WebCrypto key, the raw bytes may
   cross the preload boundary only transiently for that immediate operation;
   they must never be persisted, logged, placed in a general-purpose bridge
   object or exposed to the server. A missing or unavailable platform key is
   fail-closed.
5. Profile changes are normalized before persistence and never silently merge
   two server origins into one device identity.

The Web client must feature-detect this bridge and fall back to its existing
same-origin/browser key-storage adapter.
