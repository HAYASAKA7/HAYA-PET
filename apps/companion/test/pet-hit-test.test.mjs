import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { isOpaqueAlpha, isPointInsideRect } from "../src/renderer/pet-hit-test.js";

const RECT = { left: 10, top: 20, right: 110, bottom: 220 };

test("isPointInsideRect includes the top-left edge and excludes the bottom-right", () => {
  assert.equal(isPointInsideRect({ x: 10, y: 20 }, RECT), true); // top-left corner is inside
  assert.equal(isPointInsideRect({ x: 60, y: 120 }, RECT), true); // centre
  assert.equal(isPointInsideRect({ x: 110, y: 120 }, RECT), false); // right edge is exclusive
  assert.equal(isPointInsideRect({ x: 60, y: 220 }, RECT), false); // bottom edge is exclusive
});

test("isPointInsideRect rejects points outside the box", () => {
  assert.equal(isPointInsideRect({ x: 9, y: 120 }, RECT), false);
  assert.equal(isPointInsideRect({ x: 60, y: 19 }, RECT), false);
  assert.equal(isPointInsideRect({ x: 200, y: 300 }, RECT), false);
});

test("isOpaqueAlpha compares against the threshold (default 16)", () => {
  assert.equal(isOpaqueAlpha(255), true);
  assert.equal(isOpaqueAlpha(16), true); // threshold is inclusive
  assert.equal(isOpaqueAlpha(15), false);
  assert.equal(isOpaqueAlpha(0), false);
});

test("isOpaqueAlpha honours a custom threshold", () => {
  assert.equal(isOpaqueAlpha(120, 128), false);
  assert.equal(isOpaqueAlpha(128, 128), true);
});
