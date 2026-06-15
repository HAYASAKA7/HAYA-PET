import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolveCompanionPetState } from "../src/pet-state.js";

function bubble(sessionId, state) {
  return { sessionId, state };
}

test("drives the stable action from the highest-priority active session", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "waiting_approval"), bubble("b", "idle")],
    prioritySessionId: "a",
    previousStates: {}
  });
  assert.equal(result.stableAction, "waiting");
});

test("returns idle when there are no active sessions", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "exited")],
    prioritySessionId: "a",
    previousStates: { a: "success" }
  });
  assert.equal(result.stableAction, "idle");
});

test("excludes finished sessions from the active bubble list", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "idle"), bubble("b", "exited"), bubble("c", "success")],
    prioritySessionId: "a",
    previousStates: {}
  });
  assert.deepEqual(result.activeBubbles.map((b) => b.sessionId), ["a"]);
});

test("fires a one-shot jump when a session transitions into success", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "success")],
    prioritySessionId: "a",
    previousStates: { a: "running_tool" }
  });
  assert.deepEqual(result.oneShots, ["jumping"]);
});

test("does not repeat the success one-shot once already seen", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "success")],
    prioritySessionId: "a",
    previousStates: { a: "success" }
  });
  assert.deepEqual(result.oneShots, []);
});

test("failure is a one-shot reaction, not a sticky stable action", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "failed")],
    prioritySessionId: "a",
    previousStates: { a: "running_tool" }
  });
  // plays the failed reaction once...
  assert.deepEqual(result.oneShots, ["failed"]);
  // ...but does not pin the pet on a looping "failed" stable action
  assert.equal(result.stableAction, "idle");
});

test("does not repeat the failed reaction while it stays failed", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "failed")],
    prioritySessionId: "a",
    previousStates: { a: "failed" }
  });
  assert.deepEqual(result.oneShots, []);
  assert.equal(result.stableAction, "idle");
});

test("a failed session still yields to active work for the stable action", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "failed"), bubble("b", "running_tool")],
    prioritySessionId: "a",
    previousStates: { a: "failed", b: "running_tool" }
  });
  assert.equal(result.stableAction, "running");
});

test("an interrupt is a one-shot reaction, not a sticky stable action (like failed)", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "interrupted")],
    prioritySessionId: "a",
    previousStates: { a: "thinking" }
  });
  // plays the failed reaction once on the interrupt...
  assert.deepEqual(result.oneShots, ["failed"]);
  // ...but does not pin the pet on a looping action, and the session stays alive
  // (still in the active bubble list, unlike exited/success).
  assert.equal(result.stableAction, "idle");
  assert.deepEqual(result.activeBubbles.map((b) => b.sessionId), ["a"]);
});

test("does not repeat the interrupt reaction while it stays interrupted", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "interrupted")],
    prioritySessionId: "a",
    previousStates: { a: "interrupted" }
  });
  assert.deepEqual(result.oneShots, []);
});

test("celebrates with a one-shot jump when a working turn finishes (working -> idle)", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "idle")],
    prioritySessionId: "a",
    previousStates: { a: "running_tool" }
  });
  assert.deepEqual(result.oneShots, ["jumping"]);
  assert.equal(result.stableAction, "idle");
});

test("no finished reaction when idle was not preceded by active work", () => {
  assert.deepEqual(
    resolveCompanionPetState({ bubbles: [bubble("a", "idle")], prioritySessionId: "a", previousStates: { a: "idle" } }).oneShots,
    []
  );
  assert.deepEqual(
    resolveCompanionPetState({ bubbles: [bubble("a", "idle")], prioritySessionId: "a", previousStates: {} }).oneShots,
    []
  );
  // waiting -> idle is not "finished work"
  assert.deepEqual(
    resolveCompanionPetState({ bubbles: [bubble("a", "idle")], prioritySessionId: "a", previousStates: { a: "waiting_user" } }).oneShots,
    []
  );
});

test("returns the next state map for the following update", () => {
  const result = resolveCompanionPetState({
    bubbles: [bubble("a", "idle"), bubble("b", "exited")],
    prioritySessionId: "a",
    previousStates: {}
  });
  assert.deepEqual(result.nextStates, { a: "idle", b: "exited" });
});
