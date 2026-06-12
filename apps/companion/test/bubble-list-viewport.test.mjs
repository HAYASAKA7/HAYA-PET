import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolveBubbleListMaxHeight } from "../src/main/bubble-list-viewport.js";

// Layout bottoms for bubbles ~48px tall with a 6px gap.
const FOUR_BUBBLES = [48, 102, 156, 210];

test("three or fewer bubbles use the height budget alone", () => {
  assert.equal(resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: [48, 102, 156] }), 400);
  assert.equal(resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: [48] }), 400);
  assert.equal(resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: [] }), 400);
});

test("more than three bubbles cap the viewport at the third bubble's bottom", () => {
  assert.equal(resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: FOUR_BUBBLES }), 156);
});

test("the height budget still wins when it is tighter than the count cap", () => {
  assert.equal(resolveBubbleListMaxHeight({ room: 120, bubbleBottoms: FOUR_BUBBLES }), 120);
});

test("the minimum height floor applies to both budgets", () => {
  assert.equal(resolveBubbleListMaxHeight({ room: 40, bubbleBottoms: FOUR_BUBBLES }), 96);
  assert.equal(resolveBubbleListMaxHeight({ room: 40, bubbleBottoms: [48] }), 96);
});

test("the room is rounded to whole pixels", () => {
  assert.equal(resolveBubbleListMaxHeight({ room: 150.6, bubbleBottoms: [48] }), 151);
});

test("maxVisible and minHeight are configurable", () => {
  assert.equal(
    resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: FOUR_BUBBLES, maxVisible: 2 }),
    102
  );
  assert.equal(
    resolveBubbleListMaxHeight({ room: 40, bubbleBottoms: [48], minHeight: 32 }),
    40
  );
});

test("garbage measurements fall back safely", () => {
  // Unusable room → the floor keeps the list usable.
  assert.equal(resolveBubbleListMaxHeight({ room: Number.NaN, bubbleBottoms: [48] }), 96);
  // Unusable bottom at the cap index → no count cap, height budget alone.
  assert.equal(
    resolveBubbleListMaxHeight({ room: 400, bubbleBottoms: [48, 102, Number.NaN, 210] }),
    400
  );
});
