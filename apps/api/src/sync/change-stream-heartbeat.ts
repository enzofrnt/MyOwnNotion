/** Reconciles lossy local announcements with the durable cursor on the existing SSE tick. */
export function createChangeStreamHeartbeat(input: {
  initialCursor: number;
  revoked(): Promise<boolean>;
  currentCursor(): Promise<number>;
  advanced(cursor: number): void;
  keepAlive(): void;
  close(): void;
}) {
  let announced = input.initialCursor;
  let stopped = false;
  let running = false;
  const close = () => {
    if (stopped) return;
    stopped = true;
    try {
      input.close();
    } catch {
      /* A broken transport is already closed to this producer. */
    }
  };
  const announce = (cursor: number) => {
    if (stopped || !Number.isSafeInteger(cursor) || cursor <= announced) return;
    try {
      input.advanced(cursor);
      announced = cursor;
    } catch {
      close();
    }
  };
  return {
    announce,
    stop: () => {
      stopped = true;
    },
    tick: async () => {
      if (stopped || running) return;
      running = true;
      try {
        const revoked = await input.revoked();
        if (stopped) return;
        if (revoked) {
          close();
          return;
        }
        const cursor = await input.currentCursor();
        if (stopped) return;
        // An immediate local announcement may already have overtaken this read.
        announce(cursor);
        if (!stopped) input.keepAlive();
      } catch {
        // Reconnection rechecks access and reads the canonical position. No content/error log.
        close();
      } finally {
        running = false;
      }
    },
  };
}
