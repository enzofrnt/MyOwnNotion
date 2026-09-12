import { FilesystemBlobStore } from "@myownnotion/blob-store";
import type { Database } from "@myownnotion/database";
import {
  createProtectedContentRuntime,
  INSTALLATION_ID,
} from "../security/protected-content-runtime.ts";
import { ProtectedFileService } from "./protected-file-service.ts";

/** The server, CLI, migration and restore compose the same protected boundary. */
export function createProtectedFileRuntime(
  input: Parameters<typeof createProtectedContentRuntime>[0] & {
    readonly blobRoot: string;
    readonly journalDb: Database;
  },
) {
  const runtime = createProtectedContentRuntime(input);
  const blobs = new FilesystemBlobStore(input.blobRoot);
  const files = new ProtectedFileService({
    writeIntentDb: input.journalDb,
    installationId: input.installationId ?? INSTALLATION_ID,
    workspaceId: input.workspaceId,
    blobs,
    keys: runtime.keys,
    content: runtime.content,
    now: input.now ?? (() => new Date()),
  });
  return { ...runtime, blobs, files };
}
