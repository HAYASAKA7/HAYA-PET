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
  // The full name is preserved; projectLabel is the compact bubble display form.
  assert.equal(view.projectLabel, "netdisk-se...");
  assert.equal(view.state, "waiting_approval");
  assert.equal(view.statusLabel, "Waiting for approval");
  assert.equal(view.summary, "waiting for command approval");
  assert.equal(view.petAction, "waiting");
  assert.equal(view.elapsedMs, 64_000);
  assert.equal(view.elapsedLabel, "1m 4s");
});

test("stacks bubbles by connect time, newest on top, so they never reshuffle mid-session", () => {
  const sessions = [
    { ...baseSession, sessionId: "sess_third", state: "waiting_approval", startedAt: 3_000, updatedAt: 4_000 },
    { ...baseSession, sessionId: "sess_first", state: "idle", startedAt: 1_000, updatedAt: 9_000 },
    { ...baseSession, sessionId: "sess_second", state: "running_tool", startedAt: 2_000, updatedAt: 8_000 }
  ];

  const views = buildBubbleViews(sessions, 10_000);
  assert.deepEqual(views.map((view) => view.sessionId), ["sess_third", "sess_second", "sess_first"]);
});

test("keeps bubble order stable when states and activity change", () => {
  const before = [
    { ...baseSession, sessionId: "sess_first", state: "running_tool", startedAt: 1_000, updatedAt: 2_000 },
    { ...baseSession, sessionId: "sess_second", state: "idle", startedAt: 2_000, updatedAt: 2_500 }
  ];
  // Later, the second session becomes urgent and more recently active.
  const after = [
    { ...baseSession, sessionId: "sess_first", state: "idle", startedAt: 1_000, updatedAt: 3_000 },
    { ...baseSession, sessionId: "sess_second", state: "waiting_approval", startedAt: 2_000, updatedAt: 9_000 }
  ];

  const order = (sessions) => buildBubbleViews(sessions, 10_000).map((view) => view.sessionId);
  assert.deepEqual(order(before), order(after));
});

test("breaks connect-time ties by session id for a deterministic order", () => {
  const sessions = [
    { ...baseSession, sessionId: "sess_b", startedAt: 1_000 },
    { ...baseSession, sessionId: "sess_a", startedAt: 1_000 }
  ];

  const views = buildBubbleViews(sessions, 10_000);
  assert.deepEqual(views.map((view) => view.sessionId), ["sess_a", "sess_b"]);
});

test("keeps a short project name whole in projectLabel", () => {
  const view = buildBubbleView({ ...baseSession, projectName: "api" }, 6_000);
  assert.equal(view.projectName, "api");
  assert.equal(view.projectLabel, "api");
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

test("resolves an interrupt to the 'failed' status kind (red cross) but keeps it a live state", () => {
  assert.equal(resolveBubbleStatusKind("interrupted"), "failed");
  const view = buildBubbleView({ ...baseSession, state: "interrupted", summary: "interrupted" }, 6_000);
  assert.equal(view.statusKind, "failed");
  assert.equal(view.statusLabel, "Interrupted");
  assert.equal(view.petAction, "failed");
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
