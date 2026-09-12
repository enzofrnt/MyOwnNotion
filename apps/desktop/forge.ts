import { api } from "@electron-forge/core";
import { runForgeCommand } from "./forge-command.ts";

await runForgeCommand(process.argv.slice(2), api, import.meta.dirname);
