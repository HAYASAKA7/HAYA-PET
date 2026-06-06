import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createOutputObserver } from "../src/output-observer.js";

function makeObserver(overrides = {}) {
  const states = [];
  const timers = [];
  const observer = createOutputObserver({
    clientId: "generic",
    now: () => 1,
    onState: (event) => states.push(event),
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimer: (id) => {
      timers[id] = undefined;
    },
    ...overrides
  });
  return { observer, states, fireIdle: () => timers.filter(Boolean).at(-1)?.() };
}

// --- Default: activity-based ---

test("treats any output as working (running_tool)", () => {
  const { observer, states } = makeObserver();
  observer.push("anything the AI prints\n");
  assert.equal(states.at(-1).state, "running_tool");
  assert.equal(states.at(-1).source, "pty_output");
});

test("does NOT infer failed from a stray 'error' in output", () => {
  const { observer, states } = makeObserver();
  observer.push("No errors found; build succeeded\n");
  // activity = working, never failed
  assert.equal(states.at(-1).state, "running_tool");
  assert.ok(!states.some((event) => event.state === "failed"));
});

test("does not re-emit working on continued output", () => {
  const { observer, states } = makeObserver();
  observer.push("line one\n");
  observer.push("line two\n");
  assert.equal(states.filter((event) => event.state === "running_tool").length, 1);
});

test("ignores whitespace-only chunks", () => {
  const { observer, states } = makeObserver();
  observer.push("   \r\n");
  assert.equal(states.length, 0);
});

test("reverts to idle after a quiet period and resumes on new output", () => {
  const { observer, states, fireIdle } = makeObserver();
  observer.push("working...\n");
  assert.equal(observer.getState(), "running_tool");

  fireIdle();
  assert.equal(states.at(-1).state, "idle");
  assert.equal(observer.getState(), "idle");

  observer.push("more output\n");
  assert.equal(states.at(-1).state, "running_tool");
});

test("does not arm an idle timer when idleMs is 0", () => {
  const timers = [];
  const observer = createOutputObserver({
    clientId: "generic",
    idleMs: 0,
    onState: () => {},
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    }
  });
  observer.push("running\n");
  assert.equal(timers.length, 0);
});

// --- Opt-in keyword heuristics ---

test("with useHeuristics, recognizes specific states from lines", () => {
  const { observer, states } = makeObserver({ useHeuristics: true });
  observer.push("Do you want to approve this command?\n");
  assert.equal(states.at(-1).state, "waiting_approval");
});

test("with useHeuristics, unmatched output still counts as working", () => {
  const { observer, states } = makeObserver({ useHeuristics: true });
  observer.push("some neutral progress text\n");
  assert.equal(states.at(-1).state, "running_tool");
});
