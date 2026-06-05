import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "../../../test/harness.mjs";
import { runGenericCommand } from "../src/run-command.js";

function createClock(start = 1000, step = 10) {
  let current = start;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

test("emits generic command lifecycle messages and preserves exit code", async () => {
  const messages = [];
  const cwd = process.cwd();

  const result = await runGenericCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(7), 40)"],
    cwd,
    clientId: "generic",
    clientDisplayName: "Generic",
    sessionId: "sess_test",
    heartbeatIntervalMs: 5,
    now: createClock(),
    stdio: "ignore",
    send: async (message) => {
      messages.push(message);
    }
  });

  assert.equal(result.exitCode, 7);
  assert.equal(result.sessionId, "sess_test");

  assert.equal(messages[0].type, "register");
  assert.equal(messages[0].sessionId, "sess_test");
  assert.equal(messages[0].clientId, "generic");
  assert.equal(messages[0].clientDisplayName, "Generic");
  assert.equal(messages[0].cwd, cwd);
  assert.equal(messages[0].projectName, basename(cwd));
  assert.equal(messages[0].pid, result.pid);

  const stateMessage = messages.find((message) => message.type === "state");
  assert.equal(stateMessage.state, "running_tool");
  assert.equal(stateMessage.source, "wrapper");
  assert.equal(stateMessage.summary, "process running");

  assert.ok(messages.some((message) => message.type === "heartbeat"));

  const unregister = messages[messages.length - 1];
  assert.equal(unregister.type, "unregister");
  assert.equal(unregister.sessionId, "sess_test");
  assert.equal(unregister.exitCode, 7);
});

test("maps successful generic command exit to a success state before unregister", async () => {
  const messages = [];

  const result = await runGenericCommand({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    sessionId: "sess_success",
    heartbeatIntervalMs: 50,
    now: createClock(),
    stdio: "ignore",
    send: async (message) => {
      messages.push(message);
    }
  });

  assert.equal(result.exitCode, 0);

  const finalState = messages.filter((message) => message.type === "state").at(-1);
  assert.equal(finalState.state, "success");
  assert.equal(finalState.summary, "process exited successfully");
  assert.equal(messages.at(-1).type, "unregister");
});

test("maps failed generic command exit to a failed state before unregister", async () => {
  const messages = [];

  const result = await runGenericCommand({
    command: process.execPath,
    args: ["-e", "process.exit(3)"],
    cwd: process.cwd(),
    sessionId: "sess_failed",
    heartbeatIntervalMs: 50,
    now: createClock(),
    stdio: "ignore",
    send: async (message) => {
      messages.push(message);
    }
  });

  assert.equal(result.exitCode, 3);

  const finalState = messages.filter((message) => message.type === "state").at(-1);
  assert.equal(finalState.state, "failed");
  assert.equal(finalState.summary, "process exited with code 3");
  assert.equal(messages.at(-1).exitCode, 3);
});
