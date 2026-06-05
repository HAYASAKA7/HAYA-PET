import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getAdapterCapabilities } from "../src/capabilities.js";

test("generic wrapper cannot safely reply or approve", () => {
  const caps = getAdapterCapabilities("generic");
  assert.equal(caps.canReply, "unsupported");
  assert.equal(caps.canApprove, "unsupported");
  assert.equal(caps.canStop, true);
});

test("PTY-capable adapters report best-effort reply/approval", () => {
  const codex = getAdapterCapabilities("codex");
  assert.equal(codex.canReply, "best_effort");
  assert.equal(codex.canApprove, "best_effort");

  const claude = getAdapterCapabilities("claude-code");
  assert.equal(claude.canReply, "best_effort");
});

test("unknown clients fall back to safe wrapper capabilities", () => {
  const caps = getAdapterCapabilities("mystery");
  assert.equal(caps.canReply, "unsupported");
  assert.equal(caps.canApprove, "unsupported");
  assert.equal(typeof caps.canFocusTerminal, "boolean");
});

test("capability objects declare every documented field", () => {
  const caps = getAdapterCapabilities("codex");
  for (const field of [
    "canReply",
    "canApprove",
    "canPause",
    "canResume",
    "canStop",
    "canFocusTerminal",
    "canOpenTranscript",
    "canShowDiffs",
    "canShowFiles",
    "canShowTests"
  ]) {
    assert.ok(field in caps, `missing ${field}`);
  }
});
