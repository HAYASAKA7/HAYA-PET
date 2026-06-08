import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { runGenericCommand } from "../src/run-command.js";

test("runGenericCommand passes a custom env into the child", async () => {
  const sent = [];
  const result = await runGenericCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.env.HAYA_PET_SESSION_ID || 'MISSING')"],
    cwd: process.cwd(),
    clientId: "generic",
    clientDisplayName: "Generic",
    stdio: "ignore",
    observe: false,
    heartbeatIntervalMs: 10,
    env: { ...process.env, HAYA_PET_SESSION_ID: "sess_env_pass" },
    send: async (message) => sent.push(message)
  });

  assert.equal(result.exitCode, 0);
  const register = sent.find((m) => m.type === "register");
  assert.ok(register && register.pid, "child launched with the custom env");
});

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
  assert.equal(stateMessage.state, "idle");
  assert.equal(stateMessage.source, "wrapper");
  assert.equal(stateMessage.summary, "session started");

  assert.ok(messages.some((message) => message.type === "heartbeat"));

  const unregister = messages[messages.length - 1];
  assert.equal(unregister.type, "unregister");
  assert.equal(unregister.sessionId, "sess_test");
  assert.equal(unregister.exitCode, 7);
});

test("launches a Windows .cmd shim via the shell and reports a valid pid", async () => {
  if (process.platform !== "win32") {
    return; // shell resolution of .cmd shims is Windows-specific
  }

  const dir = mkdtempSync(join(tmpdir(), "haya-pet-cmd-"));
  const cmdPath = join(dir, "fake-cli.cmd");
  writeFileSync(cmdPath, "@echo off\r\nexit /b 5\r\n");

  try {
    const messages = [];
    const result = await runGenericCommand({
      command: cmdPath,
      args: [],
      cwd: process.cwd(),
      sessionId: "sess_cmd",
      heartbeatIntervalMs: 50,
      now: createClock(),
      stdio: "ignore",
      send: async (message) => messages.push(message)
    });

    assert.equal(result.exitCode, 5);
    const register = messages.find((message) => message.type === "register");
    assert.ok(register, "should send a register message");
    assert.ok(Number.isInteger(register.pid) && register.pid > 0, "pid must be a positive integer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("observe mode infers state from PTY output via the observer", async () => {
  const messages = [];
  const ESC = String.fromCharCode(27);

  const result = await runGenericCommand({
    command: "claude",
    args: [],
    cwd: process.cwd(),
    clientId: "claude-code",
    clientDisplayName: "Claude Code",
    sessionId: "sess_obs",
    heartbeatIntervalMs: 1000,
    now: createClock(),
    observe: true,
    send: async (message) => messages.push(message),
    // Injected PTY: emits a tool-use line (with ANSI noise), then exits 0.
    spawnPty: async ({ onData }) => {
      onData(`${ESC}[mRunning tests${ESC}[0m\r\n`);
      return {
        pid: 4321,
        exit: new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0 }), 10)),
        write() {},
        kill() {}
      };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.pid, 4321);

  const register = messages.find((m) => m.type === "register");
  assert.equal(register.pid, 4321);

  const inferred = messages.find((m) => m.type === "state" && m.source === "pty_output");
  assert.ok(inferred, "should emit a state inferred from PTY output");
  assert.equal(inferred.state, "running_tool");

  assert.equal(messages.at(-1).type, "unregister");
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
