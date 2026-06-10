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
