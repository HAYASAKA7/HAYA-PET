import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  clampLocalToWorkArea,
  clampWindowBounds,
  resolveOverlayPlacement,
  resolveSavedPosition
} from "../src/main/display-manager.js";

const displays = [
  {
    id: "primary",
    primary: true,
    scaleFactor: 1.25,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    workArea: { x: 0, y: 0, width: 800, height: 560 }
  },
  {
    id: "secondary",
    primary: false,
    scaleFactor: 2,
    bounds: { x: 800, y: 0, width: 1200, height: 900 },
    workArea: { x: 820, y: 20, width: 1160, height: 840 }
  }
];

test("keeps saved position inside the matching display work area", () => {
  assert.deepEqual(
    resolveSavedPosition({ x: 900, y: 120, width: 192, height: 208, displayId: "secondary" }, displays),
    { x: 900, y: 120, width: 192, height: 208, displayId: "secondary", scaleFactor: 2 }
  );
});

test("clamps window bounds to the visible work area", () => {
  assert.deepEqual(
    clampWindowBounds({ x: 1900, y: 880, width: 192, height: 208 }, displays[1]),
    { x: 1788, y: 652, width: 192, height: 208 }
  );
});

test("falls back to primary display when saved display is missing", () => {
  assert.deepEqual(
    resolveSavedPosition({ x: 2000, y: 2000, width: 192, height: 208, displayId: "gone" }, displays),
    { x: 608, y: 352, width: 192, height: 208, displayId: "primary", scaleFactor: 1.25 }
  );
});

test("uses primary display when no saved position exists", () => {
  assert.deepEqual(
    resolveSavedPosition(undefined, displays, { width: 384, height: 416 }),
    { x: 416, y: 144, width: 384, height: 416, displayId: "primary", scaleFactor: 1.25 }
  );
});

test("resolveOverlayPlacement spans the saved display and places the sprite inside it", () => {
  assert.deepEqual(
    resolveOverlayPlacement({
      savedPosition: { x: 900, y: 120, width: 192, height: 208, displayId: "secondary" },
      displays,
      petSize: { width: 192, height: 208 }
    }),
    {
      workArea: { x: 820, y: 20, width: 1160, height: 840 },
      displayId: "secondary",
      petLocal: { x: 80, y: 100 } // 900-820, 120-20
    }
  );
});

test("resolveOverlayPlacement re-homes a stranded position onto a valid display", () => {
  // The pet was last on a display that is now gone (monitor unplugged). It must
  // come back on the primary display, fully inside its work area — this is the
  // recovery the disappear-and-can't-restore bug needed.
  assert.deepEqual(
    resolveOverlayPlacement({
      savedPosition: { x: 4000, y: 4000, width: 192, height: 208, displayId: "gone" },
      displays,
      petSize: { width: 192, height: 208 }
    }),
    {
      workArea: { x: 0, y: 0, width: 800, height: 560 },
      displayId: "primary",
      petLocal: { x: 608, y: 352 } // clamped to primary work area (800-192, 560-208)
    }
  );
});

test("clampLocalToWorkArea keeps the sprite within the work area for its size", () => {
  const workArea = { x: 0, y: 0, width: 800, height: 560 };
  assert.deepEqual(
    clampLocalToWorkArea({ x: 5000, y: 5000 }, workArea, { width: 192, height: 208 }),
    { x: 608, y: 352 }
  );
  assert.deepEqual(
    clampLocalToWorkArea({ x: -50, y: -50 }, workArea, { width: 192, height: 208 }),
    { x: 0, y: 0 }
  );
});
