import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createOverlayHoverClearer } from "../src/renderer/overlay-hover.js";

test("overlay leave clears stale hover affordances and returns to click-through", () => {
  const petEl = fakePetElement();
  const ignored = [];
  const cleared = [];
  const clearHover = createOverlayHoverClearer({
    petEl,
    isInteractionCaptured: () => false,
    onPointerCleared: () => cleared.push(true),
    setMouseIgnore: (ignore) => ignored.push(ignore)
  });

  assert.equal(clearHover(), true);
  assert.equal(petEl.classList.has("show-grip"), false);
  assert.deepEqual(cleared, [true]);
  assert.deepEqual(ignored, [true]);
});

test("overlay leave keeps hover state while a pointer capture is active", () => {
  const petEl = fakePetElement();
  const ignored = [];
  const clearHover = createOverlayHoverClearer({
    petEl,
    isInteractionCaptured: () => true,
    setMouseIgnore: (ignore) => ignored.push(ignore)
  });

  assert.equal(clearHover(), false);
  assert.equal(petEl.classList.has("show-grip"), true);
  assert.deepEqual(ignored, []);
});

function fakePetElement() {
  const classes = new Set(["show-grip"]);
  return {
    classList: {
      has: (name) => classes.has(name),
      remove: (name) => classes.delete(name)
    }
  };
}