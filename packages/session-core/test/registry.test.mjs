import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createSessionRegistry } from "../src/registry.js";

function registerMessage(sessionId, overrides = {}) {
  return {
    type: "register",
    sessionId,
    clientId: "generic",
    clientDisplayName: "Generic",
    pid: 12345,
    cwd: "D:\\Work\\project",
    projectName: "project",
    startedAt: 1000,
    ...overrides
  };
}

test("registers sessions from protocol messages", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("sess_a"));

  assert.deepEqual(registry.listSessions().map((session) => session.sessionId), ["sess_a"]);
  assert.deepEqual(registry.getSession("sess_a"), {
    sessionId: "sess_a",
    clientId: "generic",
    clientDisplayName: "Generic",
    pid: 12345,
    terminalPid: undefined,
    cwd: "D:\\Work\\project",
    projectName: "project",
    state: "idle",
    source: "wrapper",
    startedAt: 1000,
    updatedAt: 1000
  });
});

test("applies state and heartbeat messages without losing session metadata", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("sess_a"));
  registry.applyMessage({
    type: "state",
    sessionId: "sess_a",
    state: "waiting_approval",
    summary: "waiting for command approval",
    confidence: 0.9,
    source: "pty_output",
    updatedAt: 1200
  });
  registry.applyMessage({
    type: "heartbeat",
    sessionId: "sess_a",
    updatedAt: 1300
  });

  const session = registry.getSession("sess_a");
  assert.equal(session.state, "waiting_approval");
  assert.equal(session.summary, "waiting for command approval");
  assert.equal(session.confidence, 0.9);
  assert.equal(session.source, "pty_output");
  assert.equal(session.updatedAt, 1300);
  assert.equal(session.projectName, "project");
});

test("ignores late state messages older than the latest accepted state", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("sess_a"));
  registry.applyMessage({
    type: "state",
    sessionId: "sess_a",
    state: "interrupted",
    summary: "interrupted",
    confidence: 0.9,
    source: "client_log",
    updatedAt: 2000
  });
  registry.applyMessage({
    type: "state",
    sessionId: "sess_a",
    state: "thinking",
    confidence: 0.9,
    source: "official_plugin",
    updatedAt: 1500
  });

  const session = registry.getSession("sess_a");
  assert.equal(session.state, "interrupted");
  assert.equal(session.summary, "interrupted");
  assert.equal(session.source, "client_log");
  assert.equal(session.updatedAt, 2000);
});

test("heartbeats do not block later-delivered state messages", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("sess_a"));
  registry.applyMessage({
    type: "heartbeat",
    sessionId: "sess_a",
    updatedAt: 3000
  });
  registry.applyMessage({
    type: "state",
    sessionId: "sess_a",
    state: "running_tool",
    summary: "shell_command",
    confidence: 0.85,
    source: "client_log",
    updatedAt: 2000
  });

  const session = registry.getSession("sess_a");
  assert.equal(session.state, "running_tool");
  assert.equal(session.summary, "shell_command");
  assert.equal(session.updatedAt, 3000);
});

test("unregister marks sessions as exited and preserves exit details", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("sess_a"));
  registry.applyMessage({
    type: "unregister",
    sessionId: "sess_a",
    exitCode: 7,
    finishedAt: 1400
  });

  assert.equal(registry.getSession("sess_a").state, "exited");
  assert.equal(registry.getSession("sess_a").exitCode, 7);
  assert.equal(registry.getSession("sess_a").finishedAt, 1400);
  assert.equal(registry.getSession("sess_a").updatedAt, 1400);
});

test("selects the priority session from registered sessions", () => {
  const registry = createSessionRegistry();

  registry.applyMessage(registerMessage("codex", { startedAt: 1000 }));
  registry.applyMessage(registerMessage("claude", { startedAt: 1100 }));
  registry.applyMessage({
    type: "state",
    sessionId: "codex",
    state: "running_tool",
    confidence: 0.7,
    source: "wrapper",
    updatedAt: 1200
  });
  registry.applyMessage({
    type: "state",
    sessionId: "claude",
    state: "waiting_approval",
    confidence: 0.8,
    source: "pty_output",
    updatedAt: 1150
  });

  assert.equal(registry.getPrioritySession().sessionId, "claude");
  assert.equal(registry.getPrioritySession({ pinnedSessionId: "codex" }).sessionId, "codex");
});

test("marks stale non-exited sessions after heartbeat timeout", () => {
  const registry = createSessionRegistry({ staleAfterMs: 100 });

  registry.applyMessage(registerMessage("active", { startedAt: 1000 }));
  registry.applyMessage(registerMessage("finished", { startedAt: 1000 }));
  registry.applyMessage({
    type: "unregister",
    sessionId: "finished",
    exitCode: 0,
    finishedAt: 1050
  });

  const staleSessions = registry.markStaleSessions(1201);

  assert.deepEqual(staleSessions.map((session) => session.sessionId), ["active"]);
  assert.equal(registry.getSession("active").state, "stale");
  assert.equal(registry.getSession("active").source, "wrapper");
  assert.equal(registry.getSession("finished").state, "exited");
});

test("drops sessions with no activity past the drop timeout", () => {
  const registry = createSessionRegistry({ staleAfterMs: 100, dropAfterMs: 500 });
  registry.applyMessage(registerMessage("dead", { startedAt: 1000 }));

  // Past staleAfterMs but within dropAfterMs -> marked stale, still present.
  registry.markStaleSessions(1200);
  assert.equal(registry.getSession("dead").state, "stale");

  // Marking stale must not refresh updatedAt, so the drop clock still elapses.
  registry.markStaleSessions(1600);
  assert.equal(registry.getSession("dead"), undefined);
  assert.deepEqual(registry.listSessions(), []);
});

test("does not re-mark an already-stale session every sweep", () => {
  const registry = createSessionRegistry({ staleAfterMs: 100, dropAfterMs: 100000 });
  registry.applyMessage(registerMessage("idle1", { startedAt: 1000 }));

  assert.deepEqual(registry.markStaleSessions(1200).map((s) => s.sessionId), ["idle1"]);
  // already stale -> not reported again
  assert.deepEqual(registry.markStaleSessions(1300), []);
});

test("rejects updates for unknown sessions", () => {
  const registry = createSessionRegistry();

  assert.throws(
    () => registry.applyMessage({ type: "heartbeat", sessionId: "missing", updatedAt: 1 }),
    /Unknown session: missing/
  );
});
