import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildBubbleView, buildBubbleViews } from "../src/bubble-view.js";

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
