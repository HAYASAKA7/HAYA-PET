import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildOverlayShapeRects, sameOverlayShape } from "../src/renderer/overlay-shape.js";

test("buildOverlayShapeRects clips visible overlay regions to the viewport", () => {
  assert.deepEqual(
    buildOverlayShapeRects({
      viewport: { width: 300, height: 200 },
      rects: [
        { left: 10.2, top: 20.7, right: 110.8, bottom: 90.1 },
        { left: -4, top: 180, right: 20, bottom: 230 },
        { left: 290, top: -10, right: 330, bottom: 15 }
      ]
    }),
    [
      { x: 10, y: 20, width: 101, height: 71 },
      { x: 0, y: 180, width: 20, height: 20 },
      { x: 290, y: 0, width: 10, height: 15 }
    ]
  );
});

test("buildOverlayShapeRects drops empty and off-screen regions", () => {
  assert.deepEqual(
    buildOverlayShapeRects({
      viewport: { width: 300, height: 200 },
      rects: [
        { left: 40, top: 40, right: 40, bottom: 80 },
        { left: 310, top: 10, right: 330, bottom: 30 },
        { left: 20, top: 20, right: 60, bottom: 60 }
      ]
    }),
    [{ x: 20, y: 20, width: 40, height: 40 }]
  );
});

test("sameOverlayShape compares normalized native shape rectangles", () => {
  assert.equal(
    sameOverlayShape(
      [
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 5, y: 6, width: 7, height: 8 }
      ],
      [
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 5, y: 6, width: 7, height: 8 }
      ]
    ),
    true
  );
  assert.equal(sameOverlayShape([{ x: 1, y: 2, width: 3, height: 4 }], [{ x: 1, y: 2, width: 3, height: 5 }]), false);
});
