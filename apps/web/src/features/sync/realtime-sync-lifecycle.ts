/** Bridges authenticated app lifetime to the persistent page-sync transport. */

import type { LocalContentService } from "../../services/local-content.ts";

export class RealtimeSyncLifecycle {
  readonly #service: LocalContentService;
  #stopState: (() => void) | null = null;
  #stopAdvances: (() => void) | null = null;
  #safetySweep: number | null = null;
  #wake: (() => void) | null = null;
  #sleep: (() => void) | null = null;

  constructor(service: LocalContentService) {
    this.#service = service;
  }

  start(): void {
    if (this.#stopState !== null) return;
    this.#stopState = this.#service.realtimePageSync.subscribe((state) => {
      if (state === "ready") void this.#service.synchronizeOperationalPages();
    });
    this.#stopAdvances = this.#service.realtimePageSync.subscribePageAdvances((event) => {
      void this.#service.reconcileRealtimePageAdvance(event);
    });
    if (typeof window !== "undefined") {
      this.#wake = () => {
        const online = navigator.onLine !== false;
        this.#service.realtimePageSync.setNetworkAvailable(online);
        if (online && document.visibilityState !== "hidden") {
          this.#service.realtimePageSync.wake();
          void this.#service.synchronizeOperationalPages();
        }
      };
      this.#sleep = () => this.#service.realtimePageSync.setNetworkAvailable(false);
      this.#service.realtimePageSync.setNetworkAvailable(navigator.onLine !== false);
      window.addEventListener("online", this.#wake);
      window.addEventListener("offline", this.#sleep);
      document.addEventListener("visibilitychange", this.#wake);
      // Notifications are deliberately lossy. This low-frequency frontier
      // sweep repairs a missed signal without returning to per-change polling.
      this.#safetySweep = window.setInterval(
        () => void this.#service.synchronizeOperationalPages(),
        60_000,
      );
    }
    this.#service.realtimePageSync.start();
  }

  stop(): void {
    this.#stopState?.();
    this.#stopAdvances?.();
    this.#stopState = null;
    this.#stopAdvances = null;
    if (this.#wake !== null && typeof window !== "undefined") {
      window.removeEventListener("online", this.#wake);
      document.removeEventListener("visibilitychange", this.#wake);
    }
    if (this.#sleep !== null && typeof window !== "undefined") {
      window.removeEventListener("offline", this.#sleep);
    }
    if (this.#safetySweep !== null) clearInterval(this.#safetySweep);
    this.#wake = null;
    this.#sleep = null;
    this.#safetySweep = null;
    this.#service.realtimePageSync.stop();
  }
}
