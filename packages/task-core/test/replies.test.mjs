import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  buildTaskInputRequest,
  validateTaskInputRequest,
  validateTaskInputResult,
  resolveReplyMode
} from "../src/replies.js";

test("builds and validates a task input request", () => {
  const request = buildTaskInputRequest({
    sessionId: "s",
    inputId: "in_1",
    text: "continue please",
    createdAt: 10
  });
  assert.equal(request.type, "task_input");
  assert.equal(validateTaskInputRequest(request).ok, true);
});

test("rejects empty reply text", () => {
  const result = validateTaskInputRequest({
    type: "task_input",
    sessionId: "s",
    inputId: "in_1",
    text: "   ",
    createdAt: 1
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((m) => m.includes("text")));
});

test("validates a task input result", () => {
  assert.equal(
    validateTaskInputResult({
      type: "task_input_result",
      sessionId: "s",
      inputId: "in_1",
      ok: true,
      acceptedAt: 20
    }).ok,
    true
  );
});

test("resolves the safe reply mode from adapter capability", () => {
  assert.equal(resolveReplyMode({ canReply: "supported" }), "send");
  assert.equal(resolveReplyMode({ canReply: "best_effort" }), "best-effort");
  assert.equal(resolveReplyMode({ canReply: "unsupported" }), "open-terminal");
  assert.equal(resolveReplyMode({}), "open-terminal");
});
