import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolvePanelPlacement } from "../src/main/panel-placement.js";

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
const panel = { width: 320, height: 240 };

test("places the panel to the right when there is room", () => {
  const result = resolvePanelPlacement({
    pet: { x: 200, y: 400, width: 192, height: 208 },
    panel,
    workArea
  });
  assert.equal(result.side, "right");
  assert.equal(result.x, 200 + 192 + 8);
  assert.equal(result.y, 400);
});

test("flips to the left when the pet is near the right edge", () => {
  const result = resolvePanelPlacement({
    pet: { x: 1700, y: 400, width: 192, height: 208 },
    panel,
    workArea
  });
  assert.equal(result.side, "left");
  assert.equal(result.x, 1700 - 8 - 320);
});

test("clamps the cross-axis so the panel stays on screen (bottom-right corner)", () => {
  const result = resolvePanelPlacement({
    pet: { x: 1700, y: 1000, width: 192, height: 208 },
    panel,
    workArea
  });
  assert.equal(result.side, "left");
  // pet.y 1000 + panel 240 = 1240 > 1080, so it clamps up to 1080 - 240 = 840
  assert.equal(result.y, 840);
});

test("falls back to below when neither side fits", () => {
  const narrow = { x: 0, y: 0, width: 400, height: 1080 };
  const result = resolvePanelPlacement({
    pet: { x: 60, y: 50, width: 192, height: 208 },
    panel: { width: 360, height: 200 },
    workArea: narrow
  });
  assert.equal(result.side, "below");
  assert.equal(result.y, 50 + 208 + 8);
});

test("overlaps only as a last resort on a tiny work area", () => {
  const tiny = { x: 0, y: 0, width: 300, height: 300 };
  const result = resolvePanelPlacement({
    pet: { x: 50, y: 50, width: 192, height: 208 },
    panel: { width: 320, height: 240 },
    workArea: tiny
  });
  assert.equal(result.side, "overlap");
  assert.ok(result.x >= 0 && result.y >= 0);
});
