import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { parseTranscriptLine, parseTranscriptLines } from "../src/claude-transcript.js";

function rejectionLine(toolUseId, phrase = "The user doesn't want to proceed with this tool use.") {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: true, content: phrase }]
    }
  });
}

test("parseTranscriptLine detects a user-rejected tool result", () => {
  assert.deepEqual(parseTranscriptLine(rejectionLine("toolu_1")), {
    type: "tool_denied",
    toolUseId: "toolu_1"
  });
});

test("parseTranscriptLine ignores a normal tool error (not a rejection)", () => {
  const line = JSON.stringify({
    message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "command failed: exit 1" }] }
  });
  assert.equal(parseTranscriptLine(line), undefined);
});

test("parseTranscriptLine ignores successful results and other entries", () => {
  const ok = JSON.stringify({
    message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: false, content: "done" }] }
  });
  const assistant = JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
  assert.equal(parseTranscriptLine(ok), undefined);
  assert.equal(parseTranscriptLine(assistant), undefined);
});

test("parseTranscriptLine handles array-form tool_result content", () => {
  const line = JSON.stringify({
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_2",
        is_error: true,
        content: [{ type: "text", text: "The user rejected this command." }]
      }]
    }
  });
  assert.deepEqual(parseTranscriptLine(line), { type: "tool_denied", toolUseId: "toolu_2" });
});

test("parseTranscriptLine never throws on malformed input", () => {
  assert.equal(parseTranscriptLine("not json"), undefined);
  assert.equal(parseTranscriptLine("{}"), undefined);
  assert.equal(parseTranscriptLine(JSON.stringify({ message: { content: "x" } })), undefined);
});

test("parseTranscriptLines collects only denial events from a batch", () => {
  const lines = [
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
    "",
    rejectionLine("toolu_a"),
    "garbage",
    rejectionLine("toolu_b")
  ];
  assert.deepEqual(parseTranscriptLines(lines), [
    { type: "tool_denied", toolUseId: "toolu_a" },
    { type: "tool_denied", toolUseId: "toolu_b" }
  ]);
});
