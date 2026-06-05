import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  TASK_EVENT_TYPES,
  isTaskEventType,
  normalizeTaskEvent
} from "../src/task-events.js";

test("defines the documented task event vocabulary", () => {
  for (const type of [
    "user_message",
    "assistant_message",
    "status_changed",
    "tool_started",
    "approval_requested",
    "task_completed"
  ]) {
    assert.ok(TASK_EVENT_TYPES.includes(type), `missing ${type}`);
  }
  assert.equal(isTaskEventType("tool_output"), true);
  assert.equal(isTaskEventType("nope"), false);
});

test("normalizes a valid task event", () => {
  const result = normalizeTaskEvent({
    id: "evt_1",
    sessionId: "sess_a",
    type: "status_changed",
    timestamp: 1000,
    status: "running_command",
    source: "pty_output",
    text: "running tests"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.event.type, "status_changed");
  assert.equal(result.event.status, "running_command");
});

test("rejects events with missing or invalid fields", () => {
  const missing = normalizeTaskEvent({ type: "user_message" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((m) => m.includes("id")));
  assert.ok(missing.errors.some((m) => m.includes("sessionId")));

  const badType = normalizeTaskEvent({
    id: "e",
    sessionId: "s",
    type: "explode",
    timestamp: 1
  });
  assert.equal(badType.ok, false);
  assert.ok(badType.errors.some((m) => m.includes("type")));
});

test("rejects an invalid status on an otherwise valid event", () => {
  const result = normalizeTaskEvent({
    id: "e",
    sessionId: "s",
    type: "status_changed",
    timestamp: 1,
    status: "not-a-status"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((m) => m.includes("status")));
});
