/**
 * A working codec for tests that now need one (T121).
 *
 * The projection stores sealed rows, so every suite that opens a local
 * database needs a key and a codec. Building them inline in each file would be
 * six copies of the same four lines, and six places to update when the codec's
 * shape changes.
 *
 * The key is minted in memory and thrown away with the test. That is the point:
 * these suites assert what the projection *does*, not what it stores between
 * runs, and a persistent key would make one test's leftovers another test's
 * mystery.
 */

import {
  LocalCipher,
  LocalKeyManager,
  LocalRecordCodec,
  MemorySecureStorage,
} from "@myownnotion/client-core";

export interface TestCodec {
  readonly codec: LocalRecordCodec;
  readonly keys: LocalKeyManager;
}

export async function createTestCodec(
  installationId = "018f2b7c-0000-7000-8000-000000000001",
  workspaceId = "018f2b7c-0000-7000-8000-0000000000aa",
): Promise<TestCodec> {
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  return {
    keys,
    codec: new LocalRecordCodec(new LocalCipher(keys), { installationId, workspaceId }),
  };
}
