interface RefreshScope {
  active: boolean;
  requested: boolean;
  running: Promise<void> | null;
}

/** One read at a time; a notification during it invalidates that read's publication. */
export function createProjectionRefresh<T>({
  load,
  publish,
  onError,
}: {
  readonly load: () => Promise<T>;
  readonly publish: (value: T) => void;
  readonly onError?: (cause: unknown) => void;
}): {
  readonly activate: () => void;
  readonly deactivate: () => void;
  readonly refresh: () => Promise<void>;
} {
  let scope: RefreshScope | null = null;
  return {
    activate: () => {
      if (scope?.active) return;
      scope = { active: true, requested: false, running: null };
    },
    deactivate: () => {
      if (scope !== null) scope.active = false;
      scope = null;
    },
    refresh: () => {
      const current = scope;
      if (current === null) return Promise.resolve();
      current.requested = true;
      if (current.running !== null) return current.running;
      // Publish the shared promise before starting a read, including a loader
      // that throws synchronously. This also joins same-turn notifications.
      current.running = Promise.resolve().then(async () => {
        try {
          while (current.active && current.requested) {
            current.requested = false;
            let value: T;
            try {
              value = await load();
            } catch (cause) {
              if (!current.active) return;
              if (current.requested) continue;
              onError?.(cause);
              throw cause;
            }
            if (!current.active) return;
            if (!current.requested) publish(value);
          }
        } finally {
          current.running = null;
        }
      });
      return current.running;
    },
  };
}
