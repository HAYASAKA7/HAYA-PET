import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  TASK_STATUSES,
  isTaskStatus,
  mapTaskStatusToAiState,
  mapTaskStatusToPetAction,
  buildTaskStatusPill
} from "../src/task-status.js";

test("defines the documented task status vocabulary", () => {
  for (const status of [
    "starting",
    "running_command",
    "editing_files",
    "waiting_approval",
    "completed",
    "paused",
    "stopped"
  ]) {
    assert.ok(TASK_STATUSES.includes(status), `missing ${status}`);
  }
  assert.equal(isTaskStatus("running_command"), true);
  assert.equal(isTaskStatus("nope"), false);
});

test("maps detailed task status down to normalized AI state", () => {
  assert.equal(mapTaskStatusToAiState("running_command"), "running_tool");
  assert.equal(mapTaskStatusToAiState("waiting_approval"), "waiting_approval");
  assert.equal(mapTaskStatusToAiState("reviewing"), "reviewing");
  assert.equal(mapTaskStatusToAiState("completed"), "success");
  assert.equal(mapTaskStatusToAiState("paused"), "idle");
});

test("maps task status to pet action through the AI state", () => {
  assert.equal(mapTaskStatusToPetAction("running_command"), "running");
  assert.equal(mapTaskStatusToPetAction("waiting_approval"), "waiting");
  assert.equal(mapTaskStatusToPetAction("completed"), "jumping");
});

test("renders stable status pills", () => {
  assert.equal(buildTaskStatusPill("running_command"), "Running command");
  assert.equal(buildTaskStatusPill("waiting_user"), "Waiting for you");
  assert.equal(buildTaskStatusPill("compacting"), "Compacting context");
});

test("throws on unknown task status mapping", () => {
  assert.throws(() => mapTaskStatusToAiState("bogus"), /Unknown task status/);
});
