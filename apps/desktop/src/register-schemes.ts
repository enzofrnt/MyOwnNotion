import { protocol } from "electron";
import { DESKTOP_PROTOCOL_SCHEME } from "./ipc-contract.ts";

// Must run before any other Electron API usage in the main graph. ESM imports
// of `app` / `BrowserWindow` are otherwise too late for privileged schemes, and
// Chromium then fails ES module loads on `myownnotion:` (blank window).
protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
