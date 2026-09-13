import type { Database, Transaction } from "@myownnotion/database";
import { shareFullFileMutation } from "../backup/full/locks.ts";

/** Keep maintenance out until the consumer finishes, fails or cancels its stream. */
export async function* pinnedFileRead(
  executor: Database | Transaction,
  read: (tx: Transaction) => AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  let release!: () => void;
  const consumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (tx: Transaction) => void;
  let unavailable!: (error: unknown) => void;
  const acquired = new Promise<Transaction>((resolve, reject) => {
    ready = resolve;
    unavailable = reject;
  });
  // Attach the rejection handler immediately, including connection/lock failures.
  const completed = executor
    .transaction(async (tx) => {
      await shareFullFileMutation(tx);
      ready(tx);
      await consumed;
    })
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => {
        unavailable(error);
        return { ok: false as const, error };
      },
    );
  let result: Awaited<typeof completed>;
  try {
    yield* read(await acquired);
  } finally {
    release();
    result = await completed;
  }
  if (!result.ok) throw result.error;
}
