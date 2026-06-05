import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolveTaskControls, listEnabledControls } from "../src/controls.js";

const WRAPPER_CAPS = {
  canReply: "unsupported",
  canApprove: "unsupported",
  canPause: false,
  canResume: false,
  canStop: true,
  canFocusTerminal: true,
  canOpenTranscript: false,
  canShowDiffs: false,
  canShowFiles: false,
  canShowTests: false
};

const PTY_CAPS = {
  canReply: "best_effort",
  canApprove: "best_effort",
  canPause: false,
  canResume: false,
  canStop: true,
  canFocusTerminal: true,
  canOpenTranscript: false,
  canShowDiffs: false,
  canShowFiles: false,
  canShowTests: false
};

test("disables reply and approval for wrapper-only adapters", () => {
  const controls = resolveTaskControls(WRAPPER_CAPS, "waiting_approval");
  const reply = controls.find((c) => c.id === "reply");
  const approve = controls.find((c) => c.id === "approve");
  assert.equal(reply.enabled, false);
  assert.equal(approve.enabled, false);
  const focus = controls.find((c) => c.id === "focus_terminal");
  assert.equal(focus.enabled, true);
});

test("enables approval only when a pending approval exists", () => {
  const waiting = resolveTaskControls(PTY_CAPS, "waiting_approval");
  assert.equal(waiting.find((c) => c.id === "approve").enabled, true);

  const running = resolveTaskControls(PTY_CAPS, "running_command");
  assert.equal(running.find((c) => c.id === "approve").enabled, false);
});

test("listEnabledControls returns only enabled control ids", () => {
  const enabled = listEnabledControls(WRAPPER_CAPS, "running_command");
  assert.ok(enabled.includes("focus_terminal"));
  assert.ok(enabled.includes("stop"));
  assert.ok(enabled.includes("hide"));
  assert.ok(!enabled.includes("reply"));
  assert.ok(!enabled.includes("approve"));
});

test("always allows hide regardless of capabilities", () => {
  const controls = resolveTaskControls(WRAPPER_CAPS, "idle");
  assert.equal(controls.find((c) => c.id === "hide").enabled, true);
});
