import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { discoverCodexTranscript, watchCodexTranscript } from "../src/codex-transcript-watcher.js";

const noopTimers = { setInterval: () => ({}), clearInterval: () => {} };

function sessionMeta(timestamp, id = "thread-1", cwd) {
  return `${JSON.stringify({
    timestamp,
    type: "session_meta",
    payload: { id, parent_thread_id: null, source: "cli", thread_source: "user", ...(cwd ? { cwd } : {}) }
  })}\n`;
}

function toolStart(toolName = "shell_command", callId = "call_1", timestamp) {
  return `${JSON.stringify({
    ...(timestamp ? { timestamp } : {}),
    type: "response_item",
    payload: { type: "function_call", name: toolName, call_id: callId }
  })}\n`;
}

function turnAborted(timestamp) {
  return `${JSON.stringify({
    ...(timestamp ? { timestamp } : {}),
    type: "event_msg",
    payload: { type: "turn_aborted", reason: "interrupted" }
  })}\n`;
}

test("discoverCodexTranscript finds the newest session jsonl under date folders", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
  const oldDir = join(root, "2026", "06", "07");
  const newDir = join(root, "2026", "06", "08");
  mkdirSync(oldDir, { recursive: true });
  mkdirSync(newDir, { recursive: true });

  const oldFile = join(oldDir, "rollout-old.jsonl");
  const newFile = join(newDir, "rollout-new.jsonl");
  writeFileSync(oldFile, sessionMeta("2026-06-07T10:00:00.000Z", "old-thread"));
  writeFileSync(newFile, sessionMeta("2026-06-08T10:00:00.000Z", "new-thread"));
  appendFileSync(newFile, "{}\n");

  assert.equal(discoverCodexTranscript(root), newFile);
});

test("discoverCodexTranscript skips files older than session start", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
  const dir = join(root, "2026", "06", "08");
  mkdirSync(dir, { recursive: true });

  const oldFile = join(dir, "rollout-old.jsonl");
  writeFileSync(oldFile, sessionMeta("2026-06-08T10:00:00.000Z", "old-thread"));
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(oldFile, past, past);

  assert.equal(discoverCodexTranscript(root, Date.now() - 1000), undefined);
});

test("watchCodexTranscript reports appended tool events", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, "");

  const events = [];
  const watcher = watchCodexTranscript({
    transcriptPath: path,
    onToolEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();
  appendFileSync(path, toolStart("shell_command", "call_shell"));
  watcher._tick();

  assert.deepEqual(events, [
    {
      type: "tool_started",
      toolCallId: "call_shell",
      toolName: "shell_command",
      state: "running_tool"
    }
  ]);

  watcher.stop();
});

test("watchCodexTranscript replays current-session records when a transcript is first discovered", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
  const dir = join(root, "2026", "06", "08");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-new.jsonl");
  writeFileSync(
    path,
    [
      sessionMeta("2026-06-08T11:00:00.500Z", "new-thread"),
      toolStart("shell_command", "call_old", "2026-06-08T10:59:59.000Z"),
      toolStart("shell_command", "call_new", "2026-06-08T11:00:01.000Z")
    ].join("")
  );

  const events = [];
  const watcher = watchCodexTranscript({
    sessionsRoot: root,
    startedAt: Date.parse("2026-06-08T11:00:00.000Z"),
    onToolEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, [
    {
      type: "tool_started",
      toolCallId: "call_new",
      toolName: "shell_command",
      state: "running_tool"
    }
  ]);

  watcher.stop();
});

test("watchCodexTranscript ignores fresh writes to sessions that started before this wrapper", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
  const dir = join(root, "2026", "06", "08");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-old-active.jsonl");
  writeFileSync(
    path,
    [
      sessionMeta("2026-06-08T10:00:00.000Z", "older-thread"),
      toolStart("shell_command", "call_other_session", "2026-06-08T11:00:01.000Z")
    ].join("")
  );

  const events = [];
  const watcher = watchCodexTranscript({
    sessionsRoot: root,
    startedAt: Date.parse("2026-06-08T11:00:00.000Z"),
    onToolEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, []);

  watcher.stop();
});

test("watchCodexTranscript follows a fresh resumed session in the same cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
  const dir = join(root, "2026", "06", "08");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-resumed.jsonl");
  writeFileSync(
    path,
    [
      sessionMeta("2026-06-08T10:00:00.000Z", "resumed-thread", "D:\\Work\\project"),
      turnAborted("2026-06-08T11:00:01.000Z")
    ].join("")
  );
  const fresh = new Date("2026-06-08T11:00:01.500Z");
  utimesSync(path, fresh, fresh);

  const events = [];
  const watcher = watchCodexTranscript({
    sessionsRoot: root,
    cwd: "D:\\Work\\project",
    startedAt: Date.parse("2026-06-08T11:00:00.000Z"),
    onToolEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();

  assert.deepEqual(events, [{ type: "turn_aborted", reason: "interrupted" }]);

  watcher.stop();
});

test("watchCodexTranscript forwards a turn_aborted interrupt event", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, "");

  const events = [];
  const watcher = watchCodexTranscript({
    transcriptPath: path,
    onToolEvent: (event) => events.push(event),
    ...noopTimers
  });

  watcher._tick();
  appendFileSync(path, turnAborted());
  watcher._tick();

  assert.deepEqual(events, [{ type: "turn_aborted", reason: "interrupted" }]);

  watcher.stop();
});
