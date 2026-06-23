import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  applySubagentBackgroundTasks,
  extractBackgroundTasks,
  runningSubagentTasks,
  summarizeSubagentTasks
} from "../src/background-tasks.js";

test("extractBackgroundTasks pulls the array out of a Claude Stop payload", () => {
  const raw = JSON.stringify({
    hook_event_name: "Stop",
    background_tasks: [
      { id: "x", type: "subagent", status: "running", description: "Survey repo structure" }
    ]
  });
  assert.deepEqual(extractBackgroundTasks(raw), [
    { id: "x", type: "subagent", status: "running", description: "Survey repo structure" }
  ]);
});

test("extractBackgroundTasks is defensive about junk, missing field, and wrong types", () => {
  assert.deepEqual(extractBackgroundTasks("{not json"), []);
  assert.deepEqual(extractBackgroundTasks(JSON.stringify({ hook_event_name: "Stop" })), []);
  assert.deepEqual(extractBackgroundTasks(JSON.stringify({ background_tasks: "nope" })), []);
  assert.deepEqual(extractBackgroundTasks(""), []);
  assert.deepEqual(extractBackgroundTasks(undefined), []);
});

test("runningSubagentTasks keeps only running subagents (drops shells and finished)", () => {
  const tasks = [
    { id: "a", type: "subagent", status: "running", description: "A" },
    { id: "b", type: "subagent", status: "completed", description: "B" },
    { id: "c", type: "shell", status: "running", command: "sleep 120" },
    null,
    { id: "d", type: "subagent", status: "running", description: "D" }
  ];
  assert.deepEqual(runningSubagentTasks(tasks).map((t) => t.id), ["a", "d"]);
  assert.deepEqual(runningSubagentTasks(undefined), []);
  assert.deepEqual(runningSubagentTasks("nope"), []);
});

test("summarizeSubagentTasks returns a fixed message when any subagent runs (no detail)", () => {
  // Same generic message regardless of description, agent_type, or count.
  assert.equal(
    summarizeSubagentTasks([
      { type: "subagent", status: "running", description: "Survey repo structure" }
    ]),
    "Subagent running"
  );
  assert.equal(
    summarizeSubagentTasks([{ type: "subagent", status: "running", agent_type: "explore" }]),
    "Subagent running"
  );
  assert.equal(
    summarizeSubagentTasks([
      { type: "subagent", status: "running", description: "A" },
      { type: "subagent", status: "running", description: "B" }
    ]),
    "Subagent running"
  );
});

test("summarizeSubagentTasks returns undefined when nothing is running", () => {
  assert.equal(summarizeSubagentTasks([]), undefined);
  assert.equal(summarizeSubagentTasks([{ type: "shell", status: "running" }]), undefined);
  assert.equal(summarizeSubagentTasks([{ type: "subagent", status: "completed" }]), undefined);
});

test("applySubagentBackgroundTasks upgrades idle to a working cue when a subagent runs", () => {
  assert.deepEqual(
    applySubagentBackgroundTasks({
      state: "idle",
      summary: undefined,
      backgroundTasks: [
        { type: "subagent", status: "running", description: "Survey repo structure" }
      ]
    }),
    { state: "running_tool", summary: "Subagent running" }
  );
});

test("applySubagentBackgroundTasks leaves a non-idle state untouched", () => {
  assert.deepEqual(
    applySubagentBackgroundTasks({
      state: "thinking",
      summary: "hi",
      backgroundTasks: [{ type: "subagent", status: "running", description: "A" }]
    }),
    { state: "thinking", summary: "hi" }
  );
});

test("applySubagentBackgroundTasks passes idle through when nothing runs (the retraction case)", () => {
  // The follow-up Stop carries an empty background_tasks — this is what clears the cue.
  assert.deepEqual(
    applySubagentBackgroundTasks({ state: "idle", summary: undefined, backgroundTasks: [] }),
    { state: "idle", summary: undefined }
  );
  assert.deepEqual(
    applySubagentBackgroundTasks({ state: "idle", summary: "idle", backgroundTasks: undefined }),
    { state: "idle", summary: "idle" }
  );
});

test("applySubagentBackgroundTasks ignores background shells (deliberately unsupported)", () => {
  assert.deepEqual(
    applySubagentBackgroundTasks({
      state: "idle",
      summary: undefined,
      backgroundTasks: [{ type: "shell", status: "running", command: "sleep 120" }]
    }),
    { state: "idle", summary: undefined }
  );
});
