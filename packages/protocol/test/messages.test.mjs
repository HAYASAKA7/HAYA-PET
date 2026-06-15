import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  AI_CLIENT_STATES,
  STATE_SOURCES,
  assertProtocolMessage,
  isAiClientState,
  isStateSource,
  validateProtocolMessage
} from "../src/messages.js";

test("declares normalized AI states and state sources from the plan", () => {
  assert.deepEqual(AI_CLIENT_STATES, [
    "idle",
    "thinking",
    "running_tool",
    "editing_files",
    "waiting_user",
    "waiting_approval",
    "reviewing",
    "compacting",
    "failed",
    "interrupted",
    "success",
    "stale",
    "exited"
  ]);

  assert.equal(isAiClientState("interrupted"), true);

  assert.deepEqual(STATE_SOURCES, [
    "wrapper",
    "pty_output",
    "client_log",
    "client_state",
    "official_plugin",
    "manual"
  ]);

  assert.equal(isAiClientState("waiting_approval"), true);
  assert.equal(isAiClientState("busy"), false);
  assert.equal(isStateSource("wrapper"), true);
  assert.equal(isStateSource("network"), false);
});

test("accepts valid lifecycle protocol messages", () => {
  const messages = [
    {
      type: "register",
      sessionId: "sess_abc123",
      clientId: "generic",
      clientDisplayName: "Generic",
      pid: 12345,
      terminalPid: 6789,
      cwd: "D:\\Work\\project",
      projectName: "project",
      startedAt: 1780000000
    },
    {
      type: "heartbeat",
      sessionId: "sess_abc123",
      updatedAt: 1780000010
    },
    {
      type: "state",
      sessionId: "sess_abc123",
      state: "waiting_approval",
      summary: "waiting for command approval",
      confidence: 0.86,
      source: "pty_output",
      updatedAt: 1780000010
    },
    {
      type: "unregister",
      sessionId: "sess_abc123",
      exitCode: 0,
      finishedAt: 1780000200
    }
  ];

  for (const message of messages) {
    assert.deepEqual(validateProtocolMessage(message), { ok: true, errors: [] });
    assert.equal(assertProtocolMessage(message), message);
  }
});

test("reports all useful validation errors for invalid state messages", () => {
  const result = validateProtocolMessage({
    type: "state",
    sessionId: "",
    state: "busy",
    confidence: 2,
    source: "network",
    updatedAt: "now"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /sessionId must be a non-empty string/);
  assert.match(result.errors.join("\n"), /state must be one of/);
  assert.match(result.errors.join("\n"), /confidence must be a number from 0 to 1/);
  assert.match(result.errors.join("\n"), /source must be one of/);
  assert.match(result.errors.join("\n"), /updatedAt must be a finite number/);
});

test("rejects unknown message types", () => {
  assert.throws(
    () => assertProtocolMessage({ type: "unknown", sessionId: "sess_abc123" }),
    /Unknown protocol message type: unknown/
  );
});

test("accepts a shutdown control message without a sessionId", () => {
  assert.deepEqual(validateProtocolMessage({ type: "shutdown" }), { ok: true, errors: [] });
  assert.deepEqual(assertProtocolMessage({ type: "shutdown" }), { type: "shutdown" });
});
