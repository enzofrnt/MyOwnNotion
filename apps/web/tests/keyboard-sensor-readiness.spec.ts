// @vitest-environment jsdom

import type { KeyboardSensorProps } from "@dnd-kit/core";
import { afterEach, expect, it, vi } from "vitest";
import { ReadyKeyboardSensor } from "../src/features/workspace/ready-keyboard-sensor.ts";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

interface Harness {
  readonly onStart: ReturnType<typeof vi.fn>;
  readonly onMove: ReturnType<typeof vi.fn>;
  readonly onEnd: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
  readonly coordinateGetter: ReturnType<typeof vi.fn>;
  readonly press: (code: string) => void;
}

/** Lifts the item with a real Space keydown and returns the observation points. */
function lift(keyboard: boolean): Harness {
  const handle = document.createElement("button");
  document.body.append(handle);
  const onStart = vi.fn();
  const onMove = vi.fn();
  const onEnd = vi.fn();
  const onCancel = vi.fn();
  const coordinateGetter = vi.fn((_event, { currentCoordinates }) => ({
    x: currentCoordinates.x,
    y: currentCoordinates.y + 30,
  }));
  handle.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "Space") return;
      const props = {
        event,
        active: "first",
        activeNode: { node: { current: null } },
        options: { coordinateGetter },
        context: {
          current: {
            collisionRect: { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 },
            scrollableAncestors: [],
          },
        },
        onStart,
        onMove,
        onEnd,
        onCancel,
      } as unknown as KeyboardSensorProps;
      if (keyboard) new ReadyKeyboardSensor(props);
      else {
        // The red counterfactual: the library's own deferred registration.
        void import("@dnd-kit/core").then(({ KeyboardSensor }) => new KeyboardSensor(props));
      }
    },
    { once: true },
  );
  const press = (code: string) =>
    handle.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
  return { onStart, onMove, onEnd, onCancel, coordinateGetter, press };
}

it("reads the first direction immediately after lift, without treating the lift as a drop", () => {
  // The library's deferred registration is deliberately never advanced.
  vi.useFakeTimers();
  const harness = lift(true);
  harness.press("Space");
  expect(harness.onStart).toHaveBeenCalledOnce();
  expect(harness.onEnd, "the lifting Space must not drop the item").not.toHaveBeenCalled();

  harness.press("ArrowDown");
  expect(
    harness.coordinateGetter,
    "the keyboard sensor must accept the first direction after lift",
  ).toHaveBeenCalledOnce();
  expect(harness.onMove).toHaveBeenCalledWith({ x: 0, y: 30 });

  harness.press("Space");
  expect(harness.onEnd).toHaveBeenCalledOnce();
  harness.press("ArrowDown");
  expect(harness.coordinateGetter, "nothing moves after the drop").toHaveBeenCalledOnce();
  expect(harness.onCancel).not.toHaveBeenCalled();
});

it("still handles each key exactly once once the library's deferred registration has run", async () => {
  // The test owns the clock: no guessed delay, the library's own scheduled task
  // is advanced explicitly.
  vi.useFakeTimers();
  const harness = lift(true);
  harness.press("Space");
  expect(harness.onStart).toHaveBeenCalledOnce();
  await vi.runOnlyPendingTimersAsync();
  harness.press("ArrowDown");
  expect(harness.coordinateGetter).toHaveBeenCalledOnce();
  harness.press("ArrowDown");
  expect(harness.coordinateGetter).toHaveBeenCalledTimes(2);
  harness.press("Escape");
  expect(harness.onCancel).toHaveBeenCalledOnce();
});
