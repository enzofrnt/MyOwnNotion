/**
 * When the nightly backup happens (T016, FR-005).
 *
 * A fixed hour in a named time zone, which sounds simpler than it is. A daily
 * interval of twenty-four hours is the obvious implementation and it is wrong
 * twice a year: on the day a clock moves, "twenty-four hours after 04:00" is
 * 03:00 or 05:00, and from then on the backup drifts away from the hour the
 * owner was promised.
 *
 * So the next run is *computed from the calendar* each time rather than added to
 * the last one. The schedule wakes up often, asks "is it past the next 04:00 I
 * have not yet run", and goes back to sleep. Nothing accumulates, so nothing
 * drifts — and a process that was down at 04:00 runs as soon as it returns
 * rather than waiting for tomorrow.
 */

export const DEFAULT_BACKUP_HOUR = 4;

/** How often the schedule wakes to ask. Cheap, and unrelated to the hour. */
const TICK_MS = 5 * 60 * 1000;

export interface BackupScheduleDeps {
  /** Runs one backup. Errors are caught by the schedule, never thrown out of it. */
  readonly runBackup: () => Promise<void>;
  /** When the last scheduled backup started, so a restart does not repeat it. */
  readonly lastScheduledRunAt: () => Promise<Date | null>;
  readonly logger: { error: (details: unknown, message: string) => void };
  readonly hour?: number;
  /** IANA zone; the server's configured one. */
  readonly timeZone?: string;
  readonly now?: () => Date;
  readonly tickMs?: number;
}

/**
 * The hour, in the configured zone, as a number.
 *
 * Read through `Intl` rather than by arithmetic on the timestamp, because the
 * offset is not a constant — that is the entire reason this module exists.
 */
export function hourIn(zone: string, instant: Date): number {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    hour12: false,
  }).format(instant);
  return Number.parseInt(formatted, 10);
}

/** The calendar day, in the configured zone, as `YYYY-MM-DD`. */
export function dayIn(zone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Whether a backup is due now.
 *
 * Due means: it is at or past the hour today, and today's backup has not run.
 * Expressed against the *day* rather than against an elapsed duration, which is
 * what makes a clock change harmless — a day is a day whether it held 23 hours
 * or 25.
 */
export function backupIsDue(input: {
  readonly now: Date;
  readonly lastRunAt: Date | null;
  readonly hour: number;
  readonly timeZone: string;
}): boolean {
  if (hourIn(input.timeZone, input.now) < input.hour) {
    return false;
  }
  if (input.lastRunAt === null) {
    return true;
  }
  // Same calendar day in the configured zone means today's run already happened.
  // A restart at 04:05 therefore does not produce a second backup, and one at
  // 23:00 after a machine was down all day still produces today's.
  return dayIn(input.timeZone, input.lastRunAt) !== dayIn(input.timeZone, input.now);
}

export class BackupSchedule {
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(private readonly deps: BackupScheduleDeps) {}

  #now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  async evaluate(): Promise<void> {
    if (this.#running) {
      // A backup already in flight. Starting a second would produce two archives
      // of the same moment and, worse, two writers staging to the same place.
      // The claim is made before the first await: two ticks arriving together
      // must both see it, not both miss it.
      return;
    }
    this.#running = true;
    try {
      const due = backupIsDue({
        now: this.#now(),
        lastRunAt: await this.deps.lastScheduledRunAt(),
        hour: this.deps.hour ?? DEFAULT_BACKUP_HOUR,
        timeZone: this.deps.timeZone ?? "UTC",
      });
      if (!due) {
        return;
      }
      await this.deps.runBackup();
    } finally {
      this.#running = false;
    }
  }

  start(): void {
    // Evaluated immediately, like the rotation scheduler and for the same
    // reason: a process that restarts often would otherwise never reach the
    // interval, and a backup promised as daily would never happen.
    void this.#guarded();
    this.#timer = setInterval(() => void this.#guarded(), this.deps.tickMs ?? TICK_MS);
    // Never a reason for a container to refuse to exit.
    this.#timer.unref?.();
  }

  async #guarded(): Promise<void> {
    try {
      await this.evaluate();
    } catch (error) {
      // A failed evaluation must not stop the schedule: tomorrow's may succeed,
      // and losing the schedule turns one bad night into permanent silence.
      this.deps.logger.error({ err: error }, "scheduled backup failed");
    }
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
