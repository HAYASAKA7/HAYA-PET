import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createTaskStore } from "../src/task-store.js";

test("appends events and returns recent history per session", () => {
  const store = createTaskStore();

  store.appendEvent({ id: "e1", sessionId: "s", type: "user_message", timestamp: 1, text: "hi" });
  store.appendEvent({ id: "e2", sessionId: "s", type: "assistant_message", timestamp: 2, text: "yo" });

  const events = store.getEvents("s");
  assert.equal(events.length, 2);
  assert.equal(store.getLatestEvent("s").id, "e2");
});

test("rejects invalid events", () => {
  const store = createTaskStore();
  assert.throws(() => store.appendEvent({ type: "user_message" }), /sessionId/);
});

test("derives a status snapshot from status-bearing events", () => {
  const store = createTaskStore();
  store.appendEvent({
    id: "e1",
    sessionId: "s",
    type: "status_changed",
    timestamp: 10,
    status: "running_command",
    confidence: 0.8,
    source: "pty_output",
    text: "running tests"
  });

  const snapshot = store.getStatusSnapshot("s");
  assert.equal(snapshot.sessionId, "s");
  assert.equal(snapshot.status, "running_command");
  assert.equal(snapshot.aiState, "running_tool");
  assert.equal(snapshot.petAction, "running");
  assert.equal(snapshot.confidence, 0.8);
  assert.equal(snapshot.source, "pty_output");
  assert.equal(snapshot.updatedAt, 10);
});

test("caps stored history to the configured maximum", () => {
  const store = createTaskStore({ maxEventsPerSession: 2 });
  for (let i = 0; i < 5; i += 1) {
    store.appendEvent({ id: `e${i}`, sessionId: "s", type: "tool_output", timestamp: i });
  }
  const events = store.getEvents("s");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.id), ["e3", "e4"]);
});

test("limits returned events when a limit is requested", () => {
  const store = createTaskStore();
  for (let i = 0; i < 5; i += 1) {
    store.appendEvent({ id: `e${i}`, sessionId: "s", type: "tool_output", timestamp: i });
  }
  assert.equal(store.getEvents("s", { limit: 2 }).length, 2);
});

test("returns an undefined snapshot for unknown sessions", () => {
  const store = createTaskStore();
  assert.equal(store.getStatusSnapshot("missing"), undefined);
});
