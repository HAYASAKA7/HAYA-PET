import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  classifyCodexSessionMeta,
  parseGuardianTranscriptLine,
  parseGuardianTranscriptLines
} from "../src/codex-guardian.js";

function metaLine(payload) {
  return JSON.stringify({ timestamp: "2026-06-12T01:36:41.556Z", type: "session_meta", payload });
}

test("classifyCodexSessionMeta identifies a main session", () => {
  const line = metaLine({
    id: "main-1",
    parent_thread_id: null,
    originator: "codex-tui",
    source: "cli",
    thread_source: "user"
  });

  assert.deepEqual(classifyCodexSessionMeta(line), {
    kind: "main",
    threadId: "main-1",
    parentThreadId: undefined
  });
});

test("classifyCodexSessionMeta identifies a guardian review session", () => {
  const line = metaLine({
    id: "guardian-1",
    parent_thread_id: "main-1",
    source: { subagent: { other: "guardian" } },
    thread_source: "subagent"
  });

  assert.deepEqual(classifyCodexSessionMeta(line), {
    kind: "guardian",
    threadId: "guardian-1",
    parentThreadId: "main-1"
  });
});

test("classifyCodexSessionMeta identifies non-guardian subagent sessions", () => {
  const bySource = metaLine({
    id: "agent-1",
    parent_thread_id: "main-1",
    source: { subagent: { other: "collab" } }
  });
  const byThreadSource = metaLine({
    id: "agent-2",
    parent_thread_id: "main-1",
    source: "cli",
    thread_source: "subagent"
  });

  assert.equal(classifyCodexSessionMeta(bySource).kind, "subagent");
  assert.equal(classifyCodexSessionMeta(byThreadSource).kind, "subagent");
});

test("classifyCodexSessionMeta rejects non-meta and malformed lines", () => {
  assert.equal(classifyCodexSessionMeta("not json"), undefined);
  assert.equal(classifyCodexSessionMeta("{}"), undefined);
  assert.equal(
    classifyCodexSessionMeta(JSON.stringify({ type: "response_item", payload: { type: "message" } })),
    undefined
  );
  assert.equal(classifyCodexSessionMeta(metaLine(null)), undefined);
});

test("parseGuardianTranscriptLine maps task_started to review_started", () => {
  const line = JSON.stringify({
    timestamp: "2026-06-12T01:36:41.557Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "turn-1" }
  });

  assert.deepEqual(parseGuardianTranscriptLine(line), { type: "review_started" });
});

test("parseGuardianTranscriptLine extracts the verdict from task_complete", () => {
  const allow = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: '{"outcome":"allow"}' }
  });
  const deny = JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "turn-2",
      last_agent_message:
        '{"risk_level":"high","user_authorization":"low","outcome":"deny","rationale":"too risky"}'
    }
  });

  assert.deepEqual(parseGuardianTranscriptLine(allow), { type: "review_finished", outcome: "allow" });
  assert.deepEqual(parseGuardianTranscriptLine(deny), { type: "review_finished", outcome: "deny" });
});

test("parseGuardianTranscriptLine reports an unknown outcome when the verdict is unreadable", () => {
  const garbled = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "I think it is fine" }
  });
  const missing = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn-1" }
  });
  const unexpected = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: '{"outcome":"maybe"}' }
  });

  assert.deepEqual(parseGuardianTranscriptLine(garbled), { type: "review_finished", outcome: undefined });
  assert.deepEqual(parseGuardianTranscriptLine(missing), { type: "review_finished", outcome: undefined });
  assert.deepEqual(parseGuardianTranscriptLine(unexpected), { type: "review_finished", outcome: undefined });
});

test("parseGuardianTranscriptLine ignores unrelated and malformed records", () => {
  assert.equal(parseGuardianTranscriptLine("not json"), undefined);
  assert.equal(
    parseGuardianTranscriptLine(
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } })
    ),
    undefined
  );
  assert.equal(
    parseGuardianTranscriptLine(
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant" } })
    ),
    undefined
  );
});

test("parseGuardianTranscriptLine skips records from before the session start", () => {
  const old = JSON.stringify({
    timestamp: "2026-06-12T01:00:00.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "turn-0" }
  });
  const fresh = JSON.stringify({
    timestamp: "2026-06-12T02:00:00.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "turn-1" }
  });
  const untimestamped = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", turn_id: "turn-2" }
  });
  const minTimestampMs = Date.parse("2026-06-12T01:30:00.000Z");

  assert.equal(parseGuardianTranscriptLine(old, { minTimestampMs }), undefined);
  assert.deepEqual(parseGuardianTranscriptLine(fresh, { minTimestampMs }), { type: "review_started" });
  assert.deepEqual(parseGuardianTranscriptLine(untimestamped, { minTimestampMs }), {
    type: "review_started"
  });
});

test("parseGuardianTranscriptLines collects events and skips blank lines", () => {
  const lines = [
    "",
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "t1" } }),
    "   ",
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "t1", last_agent_message: '{"outcome":"allow"}' }
    })
  ];

  assert.deepEqual(parseGuardianTranscriptLines(lines), [
    { type: "review_started" },
    { type: "review_finished", outcome: "allow" }
  ]);
});
