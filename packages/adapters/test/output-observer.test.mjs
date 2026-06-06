import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createOutputObserver } from "../src/output-observer.js";

test("emits a state change when a line matches a heuristic", () => {
  const states = [];
  const observer = createOutputObserver({
    clientId: "generic",
    now: () => 100,
    onState: (event) => states.push(event)
  });

  observer.push("Do you want to approve this command?\n");

  assert.equal(states.length, 1);
  assert.equal(states[0].state, "waiting_approval");
  assert.equal(states[0].source, "pty_output");
  assert.equal(states[0].updatedAt, 100);
  assert.ok(states[0].confidence > 0 && states[0].confidence <= 1);
});

test("does not re-emit the same state twice in a row", () => {
  const states = [];
  const observer = createOutputObserver({ clientId: "generic", now: () => 1, onState: (e) => states.push(e) });

  observer.push("running tests\n");
  observer.push("$ still running\n");

  assert.equal(states.length, 1);
  assert.equal(states[0].state, "running_tool");
});

test("buffers partial lines across pushes", () => {
  const states = [];
  const observer = createOutputObserver({ clientId: "generic", now: () => 1, onState: (e) => states.push(e) });

  observer.push("Error: something ");
  assert.equal(states.length, 0);
  observer.push("went wrong\n");

  assert.equal(states.length, 1);
  assert.equal(states[0].state, "failed");
});

test("uses client-specific rules", () => {
  const states = [];
  const observer = createOutputObserver({ clientId: "codex", now: () => 1, onState: (e) => states.push(e) });

  observer.push("Applying patch to src/index.js\n");

  assert.equal(states[0].state, "editing_files");
});

test("ignores neutral lines and exposes the current state", () => {
  const observer = createOutputObserver({ clientId: "generic", now: () => 1, onState: () => {} });
  observer.push("hello world\n");
  assert.equal(observer.getState(), undefined);

  observer.push("reviewing the diff\n");
  assert.equal(observer.getState(), "reviewing");
});
