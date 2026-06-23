import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { extractAgentId, extractTranscriptPath, parseStateArgs, runStateCommand } from "../src/run-state.js";
import { readSessionTranscriptLink } from "../src/session-transcript-link.js";

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

test("extractTranscriptPath pulls transcript_path out of a Claude hook payload", () => {
  assert.equal(
    extractTranscriptPath(JSON.stringify({ session_id: "x", transcript_path: "/p/a.jsonl", cwd: "/p" })),
    "/p/a.jsonl"
  );
  // Defensive: junk, missing field, wrong type, and empty all yield undefined.
  assert.equal(extractTranscriptPath("{not json"), undefined);
  assert.equal(extractTranscriptPath(JSON.stringify({ session_id: "x" })), undefined);
  assert.equal(extractTranscriptPath(JSON.stringify({ transcript_path: 42 })), undefined);
  assert.equal(extractTranscriptPath(""), undefined);
  assert.equal(extractTranscriptPath(undefined), undefined);
});

test("extractAgentId pulls agent_id out of a subagent hook payload", () => {
  assert.equal(
    extractAgentId(JSON.stringify({ hook_event_name: "PreToolUse", agent_id: "a9a8317d", agent_type: "Explore" })),
    "a9a8317d"
  );
  // Main-agent events carry no agent_id; junk and wrong types yield undefined.
  assert.equal(extractAgentId(JSON.stringify({ hook_event_name: "Stop" })), undefined);
  assert.equal(extractAgentId(JSON.stringify({ agent_id: 42 })), undefined);
  assert.equal(extractAgentId(JSON.stringify({ agent_id: "" })), undefined);
  assert.equal(extractAgentId("{not json"), undefined);
  assert.equal(extractAgentId(undefined), undefined);
});

test("runStateCommand ignores subagent-originated events so they never drive main status", async () => {
  let connected = false;
  const sent = [];
  const result = await runStateCommand(
    { command: "state", state: "running_tool", summary: undefined, session: "sess_main" },
    {
      now: () => 9,
      agentId: "a9a8317d3457d6364",
      createIpcClient: async () => {
        connected = true;
        return { send: async (m) => sent.push(m), close: async () => {} };
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "subagent-event");
  assert.equal(connected, false);
  assert.equal(sent.length, 0);
});

test("runStateCommand records the session->transcript link when given a transcript path", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "sess_link" },
    {
      now: () => 1,
      sessionDir,
      transcriptPath: "/p/.claude/projects/D--p/abc.jsonl",
      createIpcClient: async () => ({ send: async () => {}, close: async () => {} })
    }
  );

  assert.equal(
    readSessionTranscriptLink({ sessionDir, sessionId: "sess_link" }),
    "/p/.claude/projects/D--p/abc.jsonl"
  );
});

test("runStateCommand writes no link when no transcript path is supplied", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "sess_nolink" },
    {
      now: () => 1,
      sessionDir,
      createIpcClient: async () => ({ send: async () => {}, close: async () => {} })
    }
  );

  assert.equal(readSessionTranscriptLink({ sessionDir, sessionId: "sess_nolink" }), undefined);
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
  assert.throws(() => parseStateArgs(["waiting_approval", "--defer-ms", "1200"]), /Unknown state option/);
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

test("runStateCommand upgrades a Stop idle to a working cue when a subagent still runs", async () => {
  const sent = [];
  const result = await runStateCommand(
    { command: "state", state: "idle", summary: undefined, session: "sess_bg" },
    {
      now: () => 42,
      backgroundTasks: [
        { id: "x", type: "subagent", status: "running", description: "Survey repo structure" }
      ],
      createIpcClient: async () => ({ send: async (m) => sent.push(m), close: async () => {} })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(sent[0].state, "running_tool");
  assert.equal(sent[0].summary, "Subagent running");
});

test("runStateCommand reports plain idle when the follow-up Stop has no running subagents", async () => {
  const sent = [];
  await runStateCommand(
    { command: "state", state: "idle", summary: undefined, session: "sess_done" },
    {
      now: () => 43,
      backgroundTasks: [],
      createIpcClient: async () => ({ send: async (m) => sent.push(m), close: async () => {} })
    }
  );

  assert.equal(sent[0].state, "idle");
  assert.equal(sent[0].summary, undefined);
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

// The reporter is a child process the wrapped AI client may WAIT on at its own
// shutdown (Codex /quit hung on its goodbye because a reporter sat forever on
// a pipe await). Every IPC phase must therefore hit a hard deadline.
test("runStateCommand times out instead of hanging when the connect never settles", async () => {
  const result = await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "s1" },
    {
      env: {},
      ipcEndpoint: "test-endpoint",
      reportDeadlineMs: 20,
      createIpcClient: () => new Promise(() => {})
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
});

test("runStateCommand times out instead of hanging when send or close never settle", async () => {
  const hangingSend = await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "s1" },
    {
      env: {},
      ipcEndpoint: "test-endpoint",
      reportDeadlineMs: 20,
      createIpcClient: async () => ({ send: () => new Promise(() => {}), close: async () => {} })
    }
  );
  assert.equal(hangingSend.reason, "timeout");

  const hangingClose = await runStateCommand(
    { command: "state", state: "thinking", summary: undefined, session: "s1" },
    {
      env: {},
      ipcEndpoint: "test-endpoint",
      reportDeadlineMs: 20,
      createIpcClient: async () => ({ send: async () => {}, close: () => new Promise(() => {}) })
    }
  );
  assert.equal(hangingClose.reason, "timeout");
});
