import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  KNOWN_CLIENT_IDS,
  getAdapterInfo,
  listAdapters,
  resolveAdapterInfo
} from "../src/adapter-info.js";

test("registers the four initial client targets", () => {
  assert.deepEqual(KNOWN_CLIENT_IDS, ["codex", "claude-code", "antigravity", "generic"]);
  assert.equal(listAdapters().length, 4);
});

test("exposes adapter info fields from the plan", () => {
  const codex = getAdapterInfo("codex");
  assert.equal(codex.id, "codex");
  assert.equal(codex.displayName, "Codex");
  assert.ok([1, 2, 3, 4].includes(codex.supportLevel));
  assert.ok(Array.isArray(codex.knownProcessNames));
});

test("returns undefined for unknown clients", () => {
  assert.equal(getAdapterInfo("nope"), undefined);
});

test("resolves unknown clients to a generic-based adapter", () => {
  const resolved = resolveAdapterInfo("my-ai-cli");
  assert.equal(resolved.id, "my-ai-cli");
  assert.equal(resolved.displayName, "my-ai-cli");
  assert.equal(resolved.supportLevel, 1);

  const known = resolveAdapterInfo("claude-code");
  assert.equal(known.displayName, "Claude Code");
});
