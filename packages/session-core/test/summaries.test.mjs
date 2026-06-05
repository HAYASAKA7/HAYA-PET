import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  buildStatusLabel,
  buildSessionSummary,
  formatElapsed
} from "../src/summaries.js";

test("maps every normalized state to a human status label", () => {
  assert.equal(buildStatusLabel("waiting_approval"), "Waiting for approval");
  assert.equal(buildStatusLabel("waiting_user"), "Waiting for you");
  assert.equal(buildStatusLabel("running_tool"), "Running tools");
  assert.equal(buildStatusLabel("editing_files"), "Editing files");
  assert.equal(buildStatusLabel("success"), "Done");
  assert.equal(buildStatusLabel("idle"), "Idle");
});

test("falls back to a readable label for unknown states", () => {
  assert.equal(buildStatusLabel("totally_unknown"), "Totally unknown");
});

test("prefers an explicit summary but falls back to the status label", () => {
  assert.equal(
    buildSessionSummary({ state: "running_tool", summary: "npm test" }),
    "npm test"
  );
  assert.equal(
    buildSessionSummary({ state: "waiting_approval" }),
    "Waiting for approval"
  );
});

test("formats elapsed durations compactly", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(5_000), "5s");
  assert.equal(formatElapsed(65_000), "1m 5s");
  assert.equal(formatElapsed(3_725_000), "1h 2m");
});
