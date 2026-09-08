import { evaluateExternalUrl } from "./external-links.ts";
import type {
  FileDialogInput,
  FileDialogResult,
  OpenExternalResult,
  SaveFileInput,
  SaveFileResult,
} from "./ipc-contract.ts";

export interface NativeCapabilityHost {
  chooseFile(input: FileDialogInput): Promise<FileDialogResult>;
  saveFile(input: SaveFileInput): Promise<SaveFileResult>;
  openExternal(url: string): Promise<boolean>;
}

export async function performOpenExternal(
  host: Pick<NativeCapabilityHost, "openExternal">,
  url: string,
): Promise<OpenExternalResult> {
  const decision = evaluateExternalUrl(url);
  if (!decision.ok) {
    return { ok: false, message: "This link is not allowed to leave the application." };
  }
  const opened = await host.openExternal(decision.url);
  return opened ? { ok: true } : { ok: false, message: "The system could not open this link." };
}
