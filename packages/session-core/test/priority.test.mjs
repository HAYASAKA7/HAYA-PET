import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { selectPrioritySession } from "../src/priority.js";

function session(sessionId, state, updatedAt) {
  return {
    sessionId,
    clientId: "generic",
    clientDisplayName: "Generic",
    pid: 1000 + updatedAt,
    cwd: "D:\\Work\\project",
    projectName: "project",
    state,
    source: "wrapper",
    startedAt: 1,
    updatedAt
  };
}

test("returns undefined when there are no sessions", () => {
  assert.equal(selectPrioritySession([]), undefined);
});

test("uses the pinned session before automatic urgency", () => {
  const selected = selectPrioritySession([
    session("codex", "running_tool", 30),
    session("claude", "waiting_approval", 20)
  ], { pinnedSessionId: "codex" });

  assert.equal(selected.sessionId, "codex");
});

test("prioritizes urgent waiting states before active work and recency", () => {
  const selected = selectPrioritySession([
    session("idle", "idle", 100),
    session("thinking", "thinking", 90),
    session("running", "running_tool", 80),
    session("failed", "failed", 70),
    session("waiting-user", "waiting_user", 60),
    session("approval", "waiting_approval", 50)
  ]);

  assert.equal(selected.sessionId, "approval");
});

test("breaks ties within a priority group by most recent update", () => {
  const selected = selectPrioritySession([
    session("older", "running_tool", 20),
    session("newer", "editing_files", 40)
  ]);

  assert.equal(selected.sessionId, "newer");
});
