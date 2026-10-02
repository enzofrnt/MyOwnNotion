interface PersistedChunk {
  readonly chunkIndex: number;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}
interface ManifestChunk {
  readonly index: number;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}
export function protectedChunkManifestEntry(chunk: PersistedChunk): ManifestChunk {
  return {
    index: chunk.chunkIndex,
    byteLength: chunk.byteLength,
    storageKey: chunk.storageKey,
    keyGeneration: chunk.keyGeneration,
    recordVersion: chunk.recordVersion,
  };
}
export function protectedChunksMatchManifest(
  chunks: readonly PersistedChunk[],
  trusted: readonly ManifestChunk[],
): boolean {
  return (
    chunks.length === trusted.length &&
    chunks.every((chunk, index) => {
      const entry = trusted[index];
      return (
        entry !== undefined &&
        chunk.chunkIndex === entry.index &&
        chunk.storageKey === entry.storageKey &&
        chunk.byteLength === entry.byteLength &&
        chunk.keyGeneration === entry.keyGeneration &&
        chunk.recordVersion === entry.recordVersion
      );
    })
  );
}
