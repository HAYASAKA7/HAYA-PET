import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolveVisibleBubbles, ENDED_STATES } from "../src/bubble-linger.js";

function bubble(sessionId, state) {
  return { sessionId, state };
}

test("ENDED_STATES covers the process-finished states", () => {
  assert.ok(ENDED_STATES.has("exited"));
  assert.ok(ENDED_STATES.has("success"));
  assert.ok(ENDED_STATES.has("failed"));
  assert.ok(!ENDED_STATES.has("idle"));
  assert.ok(!ENDED_STATES.has("running_tool"));
  // An interrupt ends the TURN, not the session — the session is still alive, so
  // its bubble must NOT linger-out and vanish.
  assert.ok(!ENDED_STATES.has("interrupted"));
});

test("keeps an interrupted bubble visible (the session is still alive)", () => {
  // Long after any linger window would have elapsed, an interrupted bubble stays.
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "interrupted")],
    now: 1_000_000,
    lingerState: { a: 1000 },
    lingerMs: 2000
  });
  assert.deepEqual(result.visible.map((b) => b.sessionId), ["a"]);
  assert.deepEqual(result.lingerState, {});
  assert.equal(result.nextWakeMs, undefined);
});

test("keeps active (non-ended) bubbles visible with no linger tracking", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "running_tool"), bubble("b", "idle")],
    now: 1000
  });
  assert.deepEqual(result.visible.map((b) => b.sessionId), ["a", "b"]);
  assert.deepEqual(result.lingerState, {});
  assert.equal(result.nextWakeMs, undefined);
});

test("shows a freshly ended bubble and schedules its removal", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "success")],
    now: 1000,
    lingerMs: 2000
  });
  assert.deepEqual(result.visible.map((b) => b.sessionId), ["a"]);
  assert.equal(result.lingerState.a, 1000); // first seen ended at now
  assert.equal(result.nextWakeMs, 2000);
});

test("keeps the ended bubble visible until the linger window elapses", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "success")],
    now: 2500,
    lingerState: { a: 1000 },
    lingerMs: 2000
  });
  assert.deepEqual(result.visible.map((b) => b.sessionId), ["a"]);
  assert.equal(result.nextWakeMs, 500); // 2000 - (2500 - 1000)
});

test("hides the ended bubble once the linger window has passed", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "failed")],
    now: 3001,
    lingerState: { a: 1000 },
    lingerMs: 2000
  });
  assert.deepEqual(result.visible, []);
  // still tracked (so it stays hidden if it reappears in later payloads)...
  assert.equal(result.lingerState.a, 1000);
  // ...but nothing left to wake up for.
  assert.equal(result.nextWakeMs, undefined);
});

test("anchors the linger clock to the FIRST ended state, not later ones (success -> exited)", () => {
  // success first seen at 1000; the later 'exited' message must not reset it.
  const afterSuccess = resolveVisibleBubbles({ bubbles: [bubble("a", "success")], now: 1000, lingerMs: 2000 });
  const afterExited = resolveVisibleBubbles({
    bubbles: [bubble("a", "exited")],
    now: 1500,
    lingerState: afterSuccess.lingerState,
    lingerMs: 2000
  });
  assert.equal(afterExited.lingerState.a, 1000);
  assert.equal(afterExited.nextWakeMs, 1500); // 2000 - (1500 - 1000)
});

test("drops linger tracking for sessions no longer present", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("b", "running_tool")],
    now: 5000,
    lingerState: { a: 1000 },
    lingerMs: 2000
  });
  assert.deepEqual(result.visible.map((x) => x.sessionId), ["b"]);
  assert.deepEqual(result.lingerState, {}); // 'a' is gone -> forgotten
});

test("reports the soonest wake among several ended bubbles", () => {
  const result = resolveVisibleBubbles({
    bubbles: [bubble("a", "success"), bubble("b", "failed")],
    now: 1800,
    lingerState: { a: 1000, b: 1500 },
    lingerMs: 2000
  });
  // a: 2000-800=1200 remaining; b: 2000-300=1700 remaining -> soonest is 1200
  assert.equal(result.nextWakeMs, 1200);
});
