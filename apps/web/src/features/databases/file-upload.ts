import { createUpload, discoverUpload, sendRemaining } from "../files/upload.ts";

export interface UploadedDatabaseFile {
  readonly id: string;
  readonly name: string;
}

/**
 * Uploads one file as an attachment of an entry and returns its canonical file
 * item identity. The property only stores that identity; bytes never travel
 * through the database value itself.
 */
export async function uploadDatabaseFile(
  file: File,
  entryItemId: string,
): Promise<
  | { readonly ok: true; readonly file: UploadedDatabaseFile }
  | { readonly ok: false; readonly reason: string }
> {
  const created = await createUpload(file, undefined, entryItemId);
  if (!created.ok) {
    return {
      ok: false,
      reason:
        created.state.kind === "blocked"
          ? created.state.reason
          : "Le transfert n’a pas pu démarrer.",
    };
  }
  let final = await sendRemaining(created.handle, file, () => undefined);
  for (let attempt = 0; attempt < 30 && final.kind === "verifying"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const discovered = await discoverUpload(created.handle.uploadId);
    if (discovered.kind === "synchronized") {
      final = discovered.state;
      break;
    }
    if (discovered.kind === "missing" || discovered.kind === "blocked") break;
  }
  if (final.kind === "synchronized") {
    return { ok: true, file: { id: final.itemId, name: file.name } };
  }
  return {
    ok: false,
    reason: final.kind === "blocked" ? final.reason : "Le fichier n’a pas pu être transféré.",
  };
}
