import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  advancePreviewFrame,
  buildPreviewRows,
  createPreviewState,
  selectPreviewAction
} from "../src/preview-state.js";

test("builds preview rows for every pet atlas action", () => {
  assert.deepEqual(buildPreviewRows().map((row) => row.action), [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review"
  ]);

  assert.deepEqual(buildPreviewRows().find((row) => row.action === "jumping"), {
    action: "jumping",
    row: 4,
    frameCount: 5
  });
});

test("selecting an action resets preview playback to the first frame", () => {
  const state = createPreviewState({ action: "running", frameIndex: 4, scale: 3 });

  assert.deepEqual(selectPreviewAction(state, "waving"), {
    action: "waving",
    frameIndex: 0,
    frameRect: {
      x: 0,
      y: 624,
      width: 192,
      height: 208
    },
    scale: 3,
    playing: true
  });
});

test("advancing preview frame wraps at the action frame count", () => {
  const state = createPreviewState({ action: "waving", frameIndex: 3 });

  assert.equal(advancePreviewFrame(state).frameIndex, 0);
});

test("preview state exposes the current atlas frame rectangle", () => {
  const state = createPreviewState({ action: "review", frameIndex: 2 });

  assert.deepEqual(state.frameRect, {
    x: 384,
    y: 1664,
    width: 192,
    height: 208
  });
});
