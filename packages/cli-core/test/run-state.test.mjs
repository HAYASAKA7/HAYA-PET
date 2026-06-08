import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { parseStateArgs, runStateCommand } from "../src/run-state.js";

test("runStateCommand appends a debug line when HAYA_PET_HOOK_DEBUG is set", async () => {
  const logPath = join(mkdtempSync(join(tmpdir(), "haya-dbg-")), "hooks.jsonl");
  await runStateCommand(
    { command: "state", state: "waiting_approval", summary: "approval", session: "s1" },
    {
      now: () => 7,
      env: { HAYA_PET_HOOK_DEBUG: logPath },
      ipcEndpoint: "test-endpoint",
      createIpcClient: async () => ({ send: async () => {}, close: async () => {} })
    }
  );

  const line = JSON.parse(readFileSync(logPath, "utf8").trim());
  assert.deepEqual(line, { ts: 7, state: "waiting_approval", sessionId: "s1", summary: "approval" });
});

test("parseStateArgs reads state, summary, and session", () => {
  assert.deepEqual(parseStateArgs(["thinking"]), {
    command: "state",
    state: "thinking",
    summary: undefined,
    session: undefined
  });
  assert.deepEqual(
    parseStateArgs(["running_tool", "--summary", "ran ls", "--session", "sess_x"]),
    { command: "state", state: "running_tool", summary: "ran ls", session: "sess_x" }
  );
});

test("parseStateArgs rejects a missing state and unknown options", () => {
  assert.throws(() => parseStateArgs([]), /state requires a state name/);
  assert.throws(() => parseStateArgs(["thinking", "--bogus"]), /Unknown state option/);
});

test("runStateCommand sends one official_plugin state message", async () => {
  const sent = [];
  const result = await runStateCommand(
    { command: "state", state: "thinking", summary: "hi", session: "sess_1" },
    {
      now: () => 1000,
      createIpcClient: async () => ({
        send: async (message) => sent.push(message),
        close: async () => {}
      })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    type: "state",
    sessionId: "sess_1",
    state: "thinking",
    summary: "hi",
    confidence: 0.9,
    source: "official_plugin",
    updatedAt: 1000
  });
});

test("runStateCommand falls back to HAYA_PET_SESSION_ID", async () => {
  const sent = [];
  const result = await runStateCommand(
    { command: "state", state: "idle", summary: undefined, session: undefined },
    {
      now: () => 5,
      env: { HAYA_PET_SESSION_ID: "sess_env" },
      ipcEndpoint: "test-endpoint",
      createIpcClient: async () => ({
        send: async (m) => sent.push(m),
        close: async () => {}
      })
    }
  );
  assert.equal(result.ok, true);
  assert.equal(sent[0].sessionId, "sess_env");
});

test("runStateCommand is a silent no-op with no session id", async () => {
  let connected = false;
  const result = await runStateCommand(
    { command: "state", state: "idle", summary: undefined, session: undefined },
    { env: {}, createIpcClient: async () => { connected = true; return {}; } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-session");
  assert.equal(connected, false);
});

test("runStateCommand rejects an invalid state name", async () => {
  const result = await runStateCommand(
    { command: "state", state: "not_a_state", summary: undefined, session: "s1" },
    { env: {}, createIpcClient: async () => ({ send: async () => {}, close: async () => {} }) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-state");
});

test("runStateCommand never throws when the daemon is unreachable", async () => {
  const result = await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "s1" },
    { env: {}, createIpcClient: async () => { throw new Error("ECONNREFUSED"); } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-daemon");
});
