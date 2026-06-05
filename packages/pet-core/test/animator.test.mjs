import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getFrameAt, getActionDurationMs } from "../src/animator.js";

const manifest = { frameDurationMs: 100, actionFrameDurations: { idle: 200 } };

test("computes the active frame index from elapsed time", () => {
  assert.equal(getFrameAt("running", 0, manifest), 0);
  assert.equal(getFrameAt("running", 250, manifest), 2);
});

test("loops frames within the action frame count", () => {
  // running has 6 frames at 100ms -> 600ms wraps back to 0
  assert.equal(getFrameAt("running", 600, manifest), 0);
});

test("honours per-action frame duration overrides", () => {
  // idle override is 200ms; 500ms -> frame 2
  assert.equal(getFrameAt("idle", 500, manifest), 2);
});

test("computes the full duration of an action loop", () => {
  // waving has 4 frames at 100ms
  assert.equal(getActionDurationMs("waving", manifest), 400);
  // idle has 6 frames at 200ms override
  assert.equal(getActionDurationMs("idle", manifest), 1200);
});

test("rejects unknown actions", () => {
  assert.throws(() => getFrameAt("dancing", 0, manifest), /Unknown pet action/);
});
