/**
 * The notifier's failure behaviour (T009, US1, FR-001).
 *
 * Every assertion here is about something going wrong, because the happy path is
 * a `Set` and a loop. What can actually hurt an owner is a subscriber that has
 * gone away and is still written to, or one that blocks and decides when the
 * others hear.
 */

import { describe, expect, it, vi } from "vitest";
import { ChangeNotifier } from "../src/sync/change-notifier.ts";

describe("delivering a cursor", () => {
  it("tells every open subscriber", () => {
    const notifier = new ChangeNotifier();
    const first = vi.fn();
    const second = vi.fn();
    notifier.subscribe(first);
    notifier.subscribe(second);

    notifier.publish("42");

    expect(first).toHaveBeenCalledWith("42");
    expect(second).toHaveBeenCalledWith("42");
  });

  it("stops telling one that unsubscribed", () => {
    const notifier = new ChangeNotifier();
    const listener = vi.fn();
    const stop = notifier.subscribe(listener);
    stop();

    notifier.publish("7");

    expect(listener).not.toHaveBeenCalled();
    expect(notifier.size).toBe(0);
  });
});

describe("a subscriber that fails", () => {
  it("is dropped rather than retried on the next change", () => {
    const notifier = new ChangeNotifier();
    const broken = vi.fn(() => {
      throw new Error("socket closed");
    });
    notifier.subscribe(broken);

    notifier.publish("1");
    notifier.publish("2");

    // Called once, not twice. It has already failed for a reason this class
    // cannot see, and calling it again would fail identically while delaying
    // everyone behind it.
    expect(broken).toHaveBeenCalledTimes(1);
    expect(notifier.size).toBe(0);
  });

  it("does not stop the others from hearing", () => {
    const notifier = new ChangeNotifier();
    const broken = () => {
      throw new Error("gone");
    };
    const healthy = vi.fn();
    notifier.subscribe(broken);
    notifier.subscribe(healthy);

    notifier.publish("9");

    // The one that matters. A publisher that gave up at the first failure would
    // let one dead connection silence every live device.
    expect(healthy).toHaveBeenCalledWith("9");
  });

  it("survives a subscriber that unsubscribes while being notified", () => {
    const notifier = new ChangeNotifier();
    const seen: string[] = [];
    const stop = notifier.subscribe((cursor) => {
      seen.push(cursor);
      // Removing itself mid-iteration is what a stream does when it notices the
      // socket is gone. Iterating over a copy is what makes that safe.
      stop();
    });
    const other = vi.fn();
    notifier.subscribe(other);

    notifier.publish("3");

    expect(seen).toEqual(["3"]);
    expect(other).toHaveBeenCalledWith("3");
    expect(notifier.size).toBe(1);
  });

  it("publishes to nobody without complaint", () => {
    const notifier = new ChangeNotifier();
    // A workspace with no device connected is the ordinary state overnight.
    expect(() => notifier.publish("1")).not.toThrow();
  });
});
