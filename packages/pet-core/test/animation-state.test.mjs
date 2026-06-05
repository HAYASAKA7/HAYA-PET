import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  clearDragAction,
  createAnimationState,
  resolveCurrentAction,
  setDragAction,
  setStableAction,
  triggerOneShot
} from "../src/animation-state.js";

test("stable action loops until it is changed", () => {
  let state = createAnimationState("idle");

  assert.equal(resolveCurrentAction(state, 1000), "idle");

  state = setStableAction(state, "review");

  assert.equal(resolveCurrentAction(state, 1200), "review");
});

test("one-shot action temporarily overrides stable action", () => {
  const state = triggerOneShot(createAnimationState("review"), "waving", 1000, 500);

  assert.equal(resolveCurrentAction(state, 1499), "waving");
  assert.equal(resolveCurrentAction(state, 1500), "review");
  assert.equal(state.previousStableAction, "review");
});

test("stable action changes become the return target after an active one-shot", () => {
  let state = triggerOneShot(createAnimationState("idle"), "jumping", 1000, 500);
  state = setStableAction(state, "running");

  assert.equal(resolveCurrentAction(state, 1250), "jumping");
  assert.equal(resolveCurrentAction(state, 1500), "running");
});

test("drag action overrides both stable and one-shot actions", () => {
  let state = triggerOneShot(createAnimationState("review"), "waving", 1000, 500);
  state = setDragAction(state, "left");

  assert.equal(resolveCurrentAction(state, 1100), "running-left");

  state = clearDragAction(state);

  assert.equal(resolveCurrentAction(state, 1100), "waving");
});
