import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createInteractionController } from "../src/renderer/interaction-controller.js";

// Test harness: collects emitted gestures and gives manual control over the
// deferred single-click timer.
function makeController(overrides = {}) {
  const actions = [];
  const timers = [];
  const controller = createInteractionController({
    onAction: (event) => actions.push(event),
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimer: (id) => {
      timers[id] = undefined;
    },
    ...overrides
  });
  return {
    controller,
    actions,
    fireTimer: (id = 0) => timers[id] && timers[id](),
    timerCount: () => timers.filter(Boolean).length
  };
}

test("a single click is deferred and fires waving after the double-click window", () => {
  const { controller, actions, fireTimer } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  controller.pointerUp({ x: 12, y: 11, time: 1100 });

  // Nothing fires immediately — it waits to see if a second click arrives.
  assert.deepEqual(actions, []);

  fireTimer();
  assert.deepEqual(actions, [{ type: "click", action: "waving" }]);
});

test("a double click jumps and does NOT also fire a single click", () => {
  const { controller, actions } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  controller.pointerUp({ x: 10, y: 10, time: 1100 });
  controller.pointerDown({ x: 10, y: 10, time: 1300 });
  controller.pointerUp({ x: 10, y: 10, time: 1350 });

  // Only the double-click fires; the pending single click was cancelled.
  assert.deepEqual(actions, [{ type: "double-click", action: "jumping" }]);
});

test("the pending single click is cancelled once a double click resolves", () => {
  const { controller, actions, fireTimer, timerCount } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  controller.pointerUp({ x: 10, y: 10, time: 1100 });
  controller.pointerDown({ x: 10, y: 10, time: 1300 });
  controller.pointerUp({ x: 10, y: 10, time: 1350 });

  // Firing the (now cleared) timer must not produce a stray click.
  fireTimer(0);
  assert.deepEqual(actions, [{ type: "double-click", action: "jumping" }]);
  assert.equal(timerCount(), 0);
});

test("drag is reported synchronously with the initial direction", () => {
  const { controller } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  assert.deepEqual(controller.pointerMove({ x: 20, y: 10, time: 1050 }), {
    type: "drag",
    direction: "right",
    action: "running-right"
  });
  assert.deepEqual(controller.pointerUp({ x: 30, y: 10, time: 1100 }), { type: "drag-end" });
});

test("drag direction flips immediately on reversal (incremental, not cumulative)", () => {
  const { controller } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  // move far right
  assert.equal(controller.pointerMove({ x: 60, y: 10, time: 1050 }).direction, "right");
  // now move slightly left — still right of the start, but should read "left" now
  assert.equal(controller.pointerMove({ x: 55, y: 10, time: 1060 }).direction, "left");
  assert.equal(controller.pointerMove({ x: 58, y: 10, time: 1070 }).direction, "right");
});

test("movement within the drag threshold is not a drag (stays a click)", () => {
  const { controller, actions, fireTimer } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  assert.equal(controller.pointerMove({ x: 13, y: 11, time: 1010 }), undefined); // < 6px
  controller.pointerUp({ x: 13, y: 11, time: 1050 });
  fireTimer();
  assert.deepEqual(actions, [{ type: "click", action: "waving" }]);
});

test("a long press past clickMaxDuration is neither click nor drag", () => {
  const { controller, actions } = makeController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  controller.pointerUp({ x: 10, y: 10, time: 1500 }); // 500ms > 300ms
  assert.deepEqual(actions, []);
});
