import { KeyboardSensor, type KeyboardSensorProps } from "@dnd-kit/core";

/**
 * A keyboard sensor that can read the very next key.
 *
 * `@dnd-kit/core` 6.3.1 registers its document keydown listener in an untracked
 * `setTimeout` after the item has already been lifted, so a direction pressed
 * quickly after activation is dropped — no replay, no error. A deterministic
 * probe of the installed sensor proved it: the first ArrowDown after lift
 * produced no coordinate call, a second one did. The screen meanwhile announced
 * a drag, which is why `data-dragging` can never be used as proof here.
 *
 * This subclass closes that gap in application code (dependency patches are
 * refused by the toolchain contract): the listener is registered synchronously,
 * and two guards keep it honest —
 *
 * 1. the activation event itself is ignored, because it is still bubbling toward
 *    the document and would otherwise be read as "drop" immediately after lift;
 * 2. each event is handled at most once, because the library's deferred
 *    registration still adds this same handler a moment later.
 *
 * Everything else (arrows, Space to drop, Escape to cancel, detach) stays the
 * library's behaviour.
 */

interface KeyboardSensorInternals {
  readonly listeners: {
    add(eventName: string, handler: (event: KeyboardEvent) => void): void;
  };
  handleKeyDown: (event: KeyboardEvent) => void;
}

export class ReadyKeyboardSensor extends KeyboardSensor {
  constructor(props: KeyboardSensorProps) {
    super(props);
    const internals = this as unknown as KeyboardSensorInternals;
    const activation = props.event;
    const deliver = internals.handleKeyDown;
    const handled = new WeakSet<Event>();
    const handler = (event: KeyboardEvent): void => {
      if (event === activation) return;
      if (handled.has(event)) return;
      handled.add(event);
      deliver(event);
    };
    // Reassign before the library's deferred task runs: that task registers the
    // current property, so it registers this guard instead of a second path.
    internals.handleKeyDown = handler;
    internals.listeners.add("keydown", handler);
  }
}
