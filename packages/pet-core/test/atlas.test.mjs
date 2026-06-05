import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  ACTION_ROWS,
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  FRAME_COUNTS,
  getFrameCount,
  getFrameRect,
  mapAiStateToPetAction
} from "../src/atlas.js";

test("defines Codex-compatible atlas geometry and action rows", () => {
  assert.equal(CELL_WIDTH, 192);
  assert.equal(CELL_HEIGHT, 208);
  assert.equal(ATLAS_WIDTH, 1536);
  assert.equal(ATLAS_HEIGHT, 1872);

  assert.deepEqual(ACTION_ROWS, {
    idle: 0,
    "running-right": 1,
    "running-left": 2,
    waving: 3,
    jumping: 4,
    failed: 5,
    waiting: 6,
    running: 7,
    review: 8
  });

  assert.deepEqual(FRAME_COUNTS, {
    idle: 6,
    "running-right": 8,
    "running-left": 8,
    waving: 4,
    jumping: 5,
    failed: 8,
    waiting: 6,
    running: 6,
    review: 6
  });
});

test("returns frame rectangles for valid pet actions", () => {
  assert.deepEqual(getFrameRect("running-right", 3), {
    x: 576,
    y: 208,
    width: 192,
    height: 208
  });

  assert.deepEqual(getFrameRect("review", 5), {
    x: 960,
    y: 1664,
    width: 192,
    height: 208
  });
});

test("rejects unknown actions and out-of-range frame indexes", () => {
  assert.throws(() => getFrameCount("dancing"), /Unknown pet action/);
  assert.throws(() => getFrameRect("idle", 6), /Frame index 6 is out of range/);
  assert.throws(() => getFrameRect("waving", -1), /Frame index -1 is out of range/);
});

test("maps normalized AI states to pet actions", () => {
  assert.equal(mapAiStateToPetAction("idle"), "idle");
  assert.equal(mapAiStateToPetAction("thinking"), "review");
  assert.equal(mapAiStateToPetAction("running_tool"), "running");
  assert.equal(mapAiStateToPetAction("editing_files"), "running");
  assert.equal(mapAiStateToPetAction("waiting_user"), "waiting");
  assert.equal(mapAiStateToPetAction("waiting_approval"), "waiting");
  assert.equal(mapAiStateToPetAction("reviewing"), "review");
  assert.equal(mapAiStateToPetAction("compacting"), "review");
  assert.equal(mapAiStateToPetAction("failed"), "failed");
  assert.equal(mapAiStateToPetAction("success"), "jumping");
  assert.equal(mapAiStateToPetAction("stale"), "waiting");
  assert.equal(mapAiStateToPetAction("exited"), "jumping");
});
