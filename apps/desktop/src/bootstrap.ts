import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./register-schemes.ts";
import { app, dialog, safeStorage } from "electron";
import {
  commitWindowsProfileKey,
  WINDOWS_KEY_PRIME_SWITCH,
  WINDOWS_SESSION_DATA_SWITCH,
} from "./windows-profile-key.ts";

const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory !== "") {
  if (!path.isAbsolute(profileDirectory)) throw new Error("The profile directory must be absolute");
  app.setPath("userData", profileDirectory);
}

const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.js");
if (process.platform === "win32" && app.commandLine.hasSwitch(WINDOWS_KEY_PRIME_SWITCH)) {
  const sessionData = app.commandLine.getSwitchValue(WINDOWS_SESSION_DATA_SWITCH);
  if (!path.isAbsolute(sessionData)) throw new Error("The session directory must be absolute.");
  app.setPath("sessionData", sessionData);
  app.disableHardwareAcceleration();
  // Finish bootstrap before awaiting readiness: Electron initializes OSCrypt
  // only after JoinAppCode. Normal quit commits its native preferences.
  void app
    .whenReady()
    .then(async () => {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        app.exit(1);
        return;
      }
      app.quit();
    })
    .catch(() => app.exit(1));
} else if (process.platform === "win32") {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    let committed = false;
    try {
      commitWindowsProfileKey({
        executable: process.execPath,
        ...(app.isPackaged ? {} : { applicationPath: app.getAppPath() }),
        userData: app.getPath("userData"),
        sessionData: app.getPath("sessionData"),
      });
      committed = true;
    } catch {
      dialog.showErrorBox(
        "Le stockage protégé est indisponible",
        "Windows n’a pas pu préparer le stockage protégé. Vérifiez l’accès au profil, puis relancez l’application. Vos données locales sont conservées.",
      );
      app.exit(1);
    }
    if (committed) await import(pathToFileURL(mainPath).href);
  }
} else {
  await import(pathToFileURL(mainPath).href);
}
