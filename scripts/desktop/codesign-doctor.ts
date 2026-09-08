import { inspectCodesignIdentity, printCodesignIdentityHelp } from "./codesign-diagnostics.ts";

if (process.platform !== "darwin") {
  console.info("[desktop:codesign] macOS only.");
  process.exit(0);
}

const status = inspectCodesignIdentity();
printCodesignIdentityHelp(status);
process.exit(status.kind === "ready" ? 0 : 1);
