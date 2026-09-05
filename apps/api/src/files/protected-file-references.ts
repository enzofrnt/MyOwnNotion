import { getUpload, listProtectedFileChunks, type Transaction } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import {
  type ProtectedFileService,
  ProtectedFileUnavailableError,
} from "./protected-file-service.ts";
import { ProtectedUploadService } from "./protected-upload-service.ts";

type FileIdentity = {
  kind: "content" | "upload";
  id: string;
  validScope: boolean;
};

/**
 * Caller holds FILE maintenance until its completion/revocation commit.
 * Mutable chunk indexes may have lost every row. Current manifests, including
 * identities recoverable only from an envelope, must agree before trusting zero.
 */
export async function countVerifiedFileGenerationReferences(
  tx: Transaction,
  input: {
    workspaceId: string;
    generation: number;
    files: ProtectedFileService | undefined;
  },
): Promise<number> {
  let after: FileIdentity | undefined;
  let references = 0;
  for (;;) {
    const page = await tx.execute<FileIdentity>(sql`
      WITH objects AS (
        SELECT 'content' AS kind, id::text AS id FROM file_contents
          WHERE storage_format = 'encrypted-chunks-v1'
        UNION
        SELECT 'upload' AS kind, id::text AS id FROM uploads
          WHERE workspace_id = ${input.workspaceId} AND storage_format = 'encrypted-chunks-v1'
        UNION
        SELECT CASE WHEN entity_type = 'file.content-manifest' THEN 'content' ELSE 'upload' END AS kind,
          entity_id::text AS id FROM protected_envelopes
          WHERE workspace_id = ${input.workspaceId}
            AND entity_type IN ('file.content-manifest', 'file.upload-state')
      )
      SELECT kind, id, (kind = 'content' OR EXISTS (
        SELECT 1 FROM uploads WHERE uploads.id::text = objects.id
          AND uploads.workspace_id = ${input.workspaceId}
      )) AS "validScope" FROM objects
      ${after === undefined ? sql`` : sql`WHERE (kind, id) > (${after.kind}, ${after.id})`}
      ORDER BY kind, id LIMIT 64
    `);
    if (page.rows.length === 0) return references;
    const files = input.files;
    if (files === undefined || files.deps.workspaceId !== input.workspaceId)
      throw new ProtectedFileUnavailableError();
    const uploads = new ProtectedUploadService(files);
    for (const object of page.rows) {
      if (!object.validScope) throw new ProtectedFileUnavailableError();
      const upload = object.kind === "upload" ? await getUpload(tx, object.id as Uuid) : null;
      const manifest =
        object.kind === "content"
          ? await files.manifest(tx, object.id)
          : upload === null
            ? null
            : await uploads.state(tx, upload);
      if (manifest === null) throw new ProtectedFileUnavailableError();
      const chunks = await listProtectedFileChunks(tx, files.scope(object.kind, object.id));
      if (
        chunks.length !== manifest.chunks.length ||
        chunks.some((chunk, index) => {
          const trusted = manifest.chunks[index];
          return (
            trusted === undefined ||
            chunk.chunkIndex !== trusted.index ||
            chunk.storageKey !== trusted.storageKey ||
            chunk.byteLength !== trusted.byteLength ||
            chunk.keyGeneration !== trusted.keyGeneration ||
            chunk.recordVersion !== trusted.recordVersion
          );
        })
      )
        throw new ProtectedFileUnavailableError();
      references += manifest.chunks.filter(
        (chunk) => chunk.keyGeneration === input.generation,
      ).length;
    }
    after = page.rows.at(-1);
  }
}
