import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  DEFAULT_GENERIC_RULES,
  getClientRules,
  matchAiState
} from "../src/heuristics.js";

test("matches generic regex rules to normalized states", () => {
  assert.equal(matchAiState("Do you want to approve this command?"), "waiting_approval");
  assert.equal(matchAiState("$ npm test"), "running_tool");
  assert.equal(matchAiState("Error: build failed"), "failed");
  assert.equal(matchAiState("Reviewing the diff now"), "reviewing");
});

test("returns undefined when no rule matches", () => {
  assert.equal(matchAiState("just some neutral text"), undefined);
});

test("prefers the most urgent state when multiple rules match", () => {
  // contains both "running" and "permission" -> approval should win
  assert.equal(matchAiState("running command, needs permission to continue"), "waiting_approval");
});

test("exposes default generic rules covering the documented categories", () => {
  assert.ok(DEFAULT_GENERIC_RULES.waiting_approval);
  assert.ok(DEFAULT_GENERIC_RULES.running_tool);
  assert.ok(DEFAULT_GENERIC_RULES.failed);
  assert.ok(DEFAULT_GENERIC_RULES.reviewing);
});

test("provides client-specific rules with generic fallback", () => {
  const codexRules = getClientRules("codex");
  assert.ok(codexRules.editing_files);

  const fallback = getClientRules("unknown-client");
  assert.deepEqual(fallback, DEFAULT_GENERIC_RULES);
});

test("ignores invalid patterns instead of throwing", () => {
  assert.doesNotThrow(() => matchAiState("text", { failed: ["(unclosed"] }));
});
