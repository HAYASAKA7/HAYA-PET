import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { watchCodexGuardianReviews } from "../src/codex-guardian-watcher.js";

const noopTimers = { setInterval: () => ({}), clearInterval: () => {} };

function metaLine(payload) {
  return `${JSON.stringify({ timestamp: "2026-06-12T01:36:41.556Z", type: "session_meta", payload })}\n`;
}

function metaLineAt(timestamp, payload) {
  return `${JSON.stringify({ timestamp, type: "session_meta", payload })}\n`;
}

function reviewStarted(turnId = "turn-1", timestamp) {
  return `${JSON.stringify({
    ...(timestamp ? { timestamp } : {}),
    type: "event_msg",
    payload: { type: "task_started", turn_id: turnId }
  })}\n`;
}

function reviewFinished(outcome, turnId = "turn-1") {
  return `${JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: turnId,
      last_agent_message: JSON.stringify({ outcome })
    }
  })}\n`;
}

function makeSessionsRoot() {
  const root = mkdtempSync(join(tmpdir(), "codex-guardian-"));
  const dir = join(root, "2026", "06", "12");
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

test("watchCodexGuardianReviews tails the guardian trunk of the main session", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLine({ id: "main-1", parent_thread_id: null, source: "cli", thread_source: "user" })
  );
  // A non-guardian subagent of the same parent must not be tailed.
  writeFileSync(
    join(dir, "rollout-collab.jsonl"),
    metaLine({ id: "agent-1", parent_thread_id: "main-1", source: { subagent: { other: "collab" } } }) +
      reviewStarted("decoy")
  );
  const trunkPath = join(dir, "rollout-guardian.jsonl");
  writeFileSync(
    trunkPath,
    metaLine({ id: "guardian-1", parent_thread_id: "main-1", source: { subagent: { other: "guardian" } } })
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();
  assert.deepEqual(events, [], "no review turns yet");

  appendFileSync(trunkPath, reviewStarted());
  watcher._tick();
  appendFileSync(trunkPath, reviewFinished("allow"));
  watcher._tick();

  assert.deepEqual(events, [
    { type: "review_started" },
    { type: "review_finished", outcome: "allow" }
  ]);

  watcher.stop();
});

test("watchCodexGuardianReviews replays a trunk discovered after the review began", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLine({ id: "main-1", parent_thread_id: null, source: "cli", thread_source: "user" })
  );
  writeFileSync(
    join(dir, "rollout-guardian.jsonl"),
    metaLine({ id: "guardian-1", parent_thread_id: "main-1", source: { subagent: { other: "guardian" } } }) +
      reviewStarted("turn-1") +
      reviewFinished("deny", "turn-1")
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, [
    { type: "review_started" },
    { type: "review_finished", outcome: "deny" }
  ]);

  watcher.stop();
});

test("watchCodexGuardianReviews skips review records from before the session start", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLine({ id: "main-1", parent_thread_id: null, source: "cli", thread_source: "user" })
  );
  writeFileSync(
    join(dir, "rollout-guardian.jsonl"),
    metaLine({ id: "guardian-1", parent_thread_id: "main-1", source: { subagent: { other: "guardian" } } }) +
      reviewStarted("turn-old", "2026-06-12T00:00:00.000Z") +
      reviewStarted("turn-new", "2026-06-12T02:00:00.000Z")
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    startedAt: Date.parse("2026-06-12T01:00:00.000Z"),
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, [{ type: "review_started" }]);

  watcher.stop();
});

test("watchCodexGuardianReviews ignores guardian trunks for sessions that started before this wrapper", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLineAt("2026-06-12T00:00:00.000Z", {
      id: "main-1",
      parent_thread_id: null,
      source: "cli",
      thread_source: "user"
    })
  );
  writeFileSync(
    join(dir, "rollout-guardian.jsonl"),
    metaLineAt("2026-06-12T00:01:00.000Z", {
      id: "guardian-1",
      parent_thread_id: "main-1",
      source: { subagent: { other: "guardian" } }
    }) + reviewStarted("turn-new", "2026-06-12T02:00:00.000Z")
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    startedAt: Date.parse("2026-06-12T01:00:00.000Z"),
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, []);

  watcher.stop();
});

test("watchCodexGuardianReviews follows a resumed main session in the same cwd", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main-resumed.jsonl"),
    metaLineAt("2026-06-12T00:00:00.000Z", {
      id: "main-1",
      parent_thread_id: null,
      source: "cli",
      thread_source: "user",
      cwd: "D:\\Work\\project"
    })
  );
  writeFileSync(
    join(dir, "rollout-guardian.jsonl"),
    metaLineAt("2026-06-12T01:01:00.000Z", {
      id: "guardian-1",
      parent_thread_id: "main-1",
      source: { subagent: { other: "guardian" } }
    }) + reviewStarted("turn-new", "2026-06-12T01:02:00.000Z")
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    cwd: "D:\\Work\\project",
    startedAt: Date.parse("2026-06-12T01:00:00.000Z"),
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, [{ type: "review_started" }]);

  watcher.stop();
});

test("watchCodexGuardianReviews emits nothing without a classifiable main session", () => {
  const { root, dir } = makeSessionsRoot();
  // Guardian trunk exists but there is no main rollout to bind its parent to.
  writeFileSync(
    join(dir, "rollout-guardian.jsonl"),
    metaLine({ id: "guardian-1", parent_thread_id: "main-1", source: { subagent: { other: "guardian" } } }) +
      reviewStarted()
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();
  watcher._tick();

  assert.deepEqual(events, []);

  watcher.stop();
});

test("watchCodexGuardianReviews ignores guardian trunks of other parents", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLine({ id: "main-1", parent_thread_id: null, source: "cli", thread_source: "user" })
  );
  writeFileSync(
    join(dir, "rollout-guardian-other.jsonl"),
    metaLine({ id: "guardian-9", parent_thread_id: "someone-else", source: { subagent: { other: "guardian" } } }) +
      reviewStarted()
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, []);

  watcher.stop();
});

test("watchCodexGuardianReviews picks up a trunk created after watching began", () => {
  const { root, dir } = makeSessionsRoot();
  writeFileSync(
    join(dir, "rollout-main.jsonl"),
    metaLine({ id: "main-1", parent_thread_id: null, source: "cli", thread_source: "user" })
  );

  const events = [];
  const watcher = watchCodexGuardianReviews({
    sessionsRoot: root,
    onReviewEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();
  assert.deepEqual(events, [], "no trunk yet");

  const trunkPath = join(dir, "rollout-guardian.jsonl");
  writeFileSync(
    trunkPath,
    metaLine({ id: "guardian-1", parent_thread_id: "main-1", source: { subagent: { other: "guardian" } } }) +
      reviewStarted()
  );
  watcher._tick();

  assert.deepEqual(events, [{ type: "review_started" }]);

  watcher.stop();
});
