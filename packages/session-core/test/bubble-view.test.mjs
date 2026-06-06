import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildBubbleView, buildBubbleViews, resolveBubbleStatusKind } from "../src/bubble-view.js";

const baseSession = {
  sessionId: "sess_a",
  clientId: "codex",
  clientDisplayName: "Codex",
  projectName: "netdisk-server",
  state: "waiting_approval",
  summary: "waiting for command approval",
  startedAt: 1_000,
  updatedAt: 5_000
};

test("builds a bubble view model with label, summary, action, and elapsed", () => {
  const view = buildBubbleView(baseSession, 65_000);

  assert.equal(view.sessionId, "sess_a");
  assert.equal(view.clientId, "codex");
  assert.equal(view.clientName, "Codex");
  assert.equal(view.projectName, "netdisk-server");
  assert.equal(view.state, "waiting_approval");
  assert.equal(view.statusLabel, "Waiting for approval");
  assert.equal(view.summary, "waiting for command approval");
  assert.equal(view.petAction, "waiting");
  assert.equal(view.elapsedMs, 64_000);
  assert.equal(view.elapsedLabel, "1m 4s");
});

test("orders bubbles by session priority then recency", () => {
  const sessions = [
    { ...baseSession, sessionId: "sess_idle", state: "idle", updatedAt: 9_000 },
    { ...baseSession, sessionId: "sess_wait", state: "waiting_approval", updatedAt: 4_000 },
    { ...baseSession, sessionId: "sess_run", state: "running_tool", updatedAt: 8_000 }
  ];

  const views = buildBubbleViews(sessions, 10_000);
  assert.deepEqual(views.map((view) => view.sessionId), ["sess_wait", "sess_run", "sess_idle"]);
});

test("marks the selected/pinned session", () => {
  const views = buildBubbleViews([baseSession], 6_000, { selectedSessionId: "sess_a" });
  assert.equal(views[0].selected, true);
});

test("resolves working states to the 'working' status kind (spinner)", () => {
  for (const state of ["thinking", "running_tool", "editing_files", "reviewing", "compacting"]) {
    assert.equal(resolveBubbleStatusKind(state), "working", state);
  }
});

test("resolves attention states to the 'attention' status kind (yellow)", () => {
  for (const state of ["waiting_user", "waiting_approval", "stale"]) {
    assert.equal(resolveBubbleStatusKind(state), "attention", state);
  }
});

test("resolves failure to the 'failed' status kind (red cross)", () => {
  assert.equal(resolveBubbleStatusKind("failed"), "failed");
});

test("resolves idle/finished states to the 'done' status kind (check mark)", () => {
  for (const state of ["idle", "success", "exited"]) {
    assert.equal(resolveBubbleStatusKind(state), "done", state);
  }
});

test("falls back to a neutral 'idle' kind for unknown states", () => {
  assert.equal(resolveBubbleStatusKind("totally-unknown"), "idle");
  assert.equal(resolveBubbleStatusKind(undefined), "idle");
});

test("exposes statusKind on the bubble view model", () => {
  assert.equal(buildBubbleView({ ...baseSession, state: "running_tool" }, 6_000).statusKind, "working");
  assert.equal(buildBubbleView({ ...baseSession, state: "waiting_approval" }, 6_000).statusKind, "attention");
  assert.equal(buildBubbleView({ ...baseSession, state: "failed" }, 6_000).statusKind, "failed");
  assert.equal(buildBubbleView({ ...baseSession, state: "idle" }, 6_000).statusKind, "done");
});
