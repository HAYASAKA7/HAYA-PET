import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { parseCodexTranscriptLine, parseCodexTranscriptLines } from "../src/codex-transcript.js";

test("parseCodexTranscriptLine reports shell tool starts as running tools", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "shell_command",
      call_id: "call_shell"
    }
  }));

  assert.deepEqual(event, {
    type: "tool_started",
    toolCallId: "call_shell",
    toolName: "shell_command",
    state: "running_tool"
  });
});

test("parseCodexTranscriptLine reports apply_patch starts as file editing", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      call_id: "call_patch"
    }
  }));

  assert.deepEqual(event, {
    type: "tool_started",
    toolCallId: "call_patch",
    toolName: "apply_patch",
    state: "editing_files"
  });
});

test("parseCodexTranscriptLine reports tool output as tool finished", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_shell",
      output: "done"
    }
  }));

  assert.deepEqual(event, {
    type: "tool_finished",
    toolCallId: "call_shell"
  });
});

test("parseCodexTranscriptLines ignores malformed and unrelated lines", () => {
  const lines = [
    "",
    "{not-json",
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "shell_command", call_id: "call_1" } })
  ];

  assert.deepEqual(parseCodexTranscriptLines(lines), [
    {
      type: "tool_started",
      toolCallId: "call_1",
      toolName: "shell_command",
      state: "running_tool"
    }
  ]);
});

test("parseCodexTranscriptLines can skip records older than the session start", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-06-08T10:59:59.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "shell_command", call_id: "call_old" }
    }),
    JSON.stringify({
      timestamp: "2026-06-08T11:00:01.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "shell_command", call_id: "call_new" }
    })
  ];

  assert.deepEqual(parseCodexTranscriptLines(lines, { minTimestampMs: Date.parse("2026-06-08T11:00:00.000Z") }), [
    {
      type: "tool_started",
      toolCallId: "call_new",
      toolName: "shell_command",
      state: "running_tool"
    }
  ]);
});

test("parseCodexTranscriptLine detects a user-interrupted turn", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "event_msg",
    payload: { type: "turn_aborted", reason: "interrupted" }
  }));

  assert.deepEqual(event, { type: "turn_aborted", reason: "interrupted" });
});

test("parseCodexTranscriptLine detects a reached Codex usage limit", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        rate_limit_reached_type: "primary"
      }
    }
  }));

  assert.deepEqual(event, { type: "usage_limit_reached", limitType: "primary" });
});

test("parseCodexTranscriptLine reports a normal completed turn", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      last_agent_message: "done",
      time_to_first_token_ms: 250
    }
  }));

  assert.deepEqual(event, { type: "turn_complete" });
});

test("parseCodexTranscriptLine reports a failed turn when Codex completes without a model response", () => {
  const event = parseCodexTranscriptLine(JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      last_agent_message: null,
      duration_ms: 4430
    }
  }));

  assert.deepEqual(event, { type: "turn_failed", reason: "empty_response" });
});
test("parseCodexTranscriptLines ignores Codex manual compact's empty completion", () => {
  const parserState = {};
  const compacted = JSON.stringify({
    type: "event_msg",
    payload: { type: "context_compacted" }
  });
  const emptyCompletion = JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "019f3f3a-92c8-7f43-be08-c4fd1311cbe9",
      last_agent_message: null,
      completed_at: 1783472266,
      duration_ms: 35023
    }
  });

  assert.deepEqual(parseCodexTranscriptLines([compacted], { parserState }), [
    { type: "context_compacted" }
  ]);
  assert.deepEqual(parseCodexTranscriptLines([emptyCompletion], { parserState }), []);
});
test("parseCodexTranscriptLine skips a turn_aborted older than the session start", () => {
  const old = JSON.stringify({
    timestamp: "2026-06-08T10:59:59.000Z",
    type: "event_msg",
    payload: { type: "turn_aborted", reason: "interrupted" }
  });

  assert.equal(
    parseCodexTranscriptLine(old, { minTimestampMs: Date.parse("2026-06-08T11:00:00.000Z") }),
    undefined
  );
});
