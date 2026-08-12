import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createPetAnimationTimer } from "../src/renderer/pet-animation-timer.js";

function createFakeTimers() {
  let pending;
  return {
    setTimer(fn, delay) {
      pending = { fn, delay };
      return pending;
    },
    clearTimer(timer) {
      if (pending === timer) pending = undefined;
    },
    pending() {
      return pending;
    },
    fire() {
      const timer = pending;
      pending = undefined;
      timer.fn();
    }
  };
}

test("pet animation timer draws once per sprite frame instead of every display refresh", () => {
  let now = 25;
  const draws = [];
  const timers = createFakeTimers();
  const clock = createPetAnimationTimer({
    getState: () => ({ stableAction: "idle" }),
    resolveAction: (state) => state.stableAction,
    getFrame: (_action, elapsed) => Math.floor(elapsed / 100),
    getNextDelay: (_action, elapsed) => 100 - (elapsed % 100),
    draw: (action, frame) => draws.push({ action, frame }),
    now: () => now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  clock.start();
  assert.deepEqual(draws, [{ action: "idle", frame: 0 }]);
  assert.equal(timers.pending().delay, 100);

  now = 50;
  clock.wake();
  assert.equal(draws.length, 1, "waking within the same frame does not redraw");
  assert.equal(timers.pending().delay, 75);

  now = 125;
  timers.fire();
  assert.deepEqual(draws.at(-1), { action: "idle", frame: 1 });
});

test("pet animation timer supports explicit visual invalidation", () => {
  let now = 0;
  const draws = [];
  const timers = createFakeTimers();
  const clock = createPetAnimationTimer({
    getState: () => ({ stableAction: "idle" }),
    resolveAction: (state) => state.stableAction,
    getFrame: () => 0,
    getNextDelay: () => 100,
    draw: (action, frame) => draws.push({ action, frame }),
    now: () => now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  clock.start();
  now = 10;
  clock.invalidate();

  assert.equal(draws.length, 2, "resizing or loading a sprite forces one redraw");
  clock.stop();
  assert.equal(timers.pending(), undefined);
});
