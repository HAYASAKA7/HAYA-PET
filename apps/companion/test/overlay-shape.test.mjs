import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildOverlayShapeRects, resolveElementLayoutRect, sameOverlayShape } from "../src/renderer/overlay-shape.js";

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

test("resolveElementLayoutRect ignores the element transform box", () => {
  const parent = fakeElement({
    rect: { left: 40, top: 30, right: 70, bottom: 60, width: 30, height: 30 }
  });
  const list = fakeElement({
    offsetParent: parent,
    offsetLeft: 12,
    offsetTop: 20,
    offsetWidth: 180,
    offsetHeight: 96,
    // getBoundingClientRect() includes the current CSS scale during expansion;
    // native shape needs the final layout box so the animation is not clipped.
    rect: { left: 60, top: 55, right: 222, bottom: 141, width: 162, height: 86 }
  });

  assert.deepEqual(resolveElementLayoutRect(list), {
    left: 52,
    top: 50,
    right: 232,
    bottom: 146,
    width: 180,
    height: 96
  });
});

function fakeElement({ rect, offsetParent, offsetLeft = 0, offsetTop = 0, offsetWidth = 0, offsetHeight = 0 }) {
  return {
    offsetParent,
    offsetLeft,
    offsetTop,
    offsetWidth,
    offsetHeight,
    getBoundingClientRect: () => rect
  };
}
