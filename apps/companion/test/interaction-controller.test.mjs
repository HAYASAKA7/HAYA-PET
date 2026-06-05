import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createInteractionController } from "../src/renderer/interaction-controller.js";

test("classifies short low-movement pointer sequence as waving click", () => {
  const controller = createInteractionController();

  assert.equal(controller.pointerDown({ x: 10, y: 10, time: 1000 }), undefined);

  assert.deepEqual(controller.pointerUp({ x: 13, y: 12, time: 1200 }), {
    type: "click",
    action: "waving"
  });
});

test("classifies second click inside double-click window as jumping", () => {
  const controller = createInteractionController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });
  controller.pointerUp({ x: 10, y: 10, time: 1100 });
  controller.pointerDown({ x: 10, y: 10, time: 1300 });

  assert.deepEqual(controller.pointerUp({ x: 10, y: 10, time: 1350 }), {
    type: "double-click",
    action: "jumping"
  });
});

test("classifies right drag as running-right", () => {
  const controller = createInteractionController();

  controller.pointerDown({ x: 10, y: 10, time: 1000 });

  assert.deepEqual(controller.pointerMove({ x: 20, y: 10, time: 1050 }), {
    type: "drag",
    direction: "right",
    action: "running-right"
  });
  assert.deepEqual(controller.pointerUp({ x: 30, y: 10, time: 1100 }), {
    type: "drag-end"
  });
});

test("classifies left drag as running-left", () => {
  const controller = createInteractionController();

  controller.pointerDown({ x: 20, y: 10, time: 1000 });

  assert.deepEqual(controller.pointerMove({ x: 10, y: 10, time: 1050 }), {
    type: "drag",
    direction: "left",
    action: "running-left"
  });
});
