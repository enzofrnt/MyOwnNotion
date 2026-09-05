import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./register-schemes.ts";
import { app } from "electron";

const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory !== "") {
  if (!path.isAbsolute(profileDirectory)) throw new Error("The profile directory must be absolute");
  app.setPath("userData", profileDirectory);
}

const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.js");
await import(pathToFileURL(mainPath).href);
