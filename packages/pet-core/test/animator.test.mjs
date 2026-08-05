import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getFrameAt, getActionDurationMs } from "../src/animator.js";

const manifest = {
  frameDurationMs: 100,
  actionFrameDurations: { idle: 200 },
  actionLoopPausesMs: { running: 300 }
};

test("computes the active frame index from elapsed time", () => {
  assert.equal(getFrameAt("running", 0, manifest), 0);
  assert.equal(getFrameAt("running", 250, manifest), 2);
});

test("loops frames within the action frame count", () => {
  // jumping has 5 frames at 100ms -> 500ms wraps back to 0
  assert.equal(getFrameAt("jumping", 500, manifest), 0);
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

test("holds the final frame during an action loop pause", () => {
  // running has 6 frames at 100ms, then pauses for 300ms on the final frame.
  assert.equal(getFrameAt("running", 599, manifest), 5);
  assert.equal(getFrameAt("running", 600, manifest), 5);
  assert.equal(getFrameAt("running", 899, manifest), 5);
  assert.equal(getFrameAt("running", 900, manifest), 0);
});

test("rejects unknown actions", () => {
  assert.throws(() => getFrameAt("dancing", 0, manifest), /Unknown pet action/);
});
