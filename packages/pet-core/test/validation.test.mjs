import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  validateAtlasDimensions,
  validatePetActions,
  validatePet
} from "../src/validation.js";

const FULL_ACTION_FRAMES = {
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6
};

test("accepts the Codex-compatible 1536x1872 atlas", () => {
  const result = validateAtlasDimensions({ width: 1536, height: 1872 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("rejects atlases that are not 1536x1872", () => {
  const result = validateAtlasDimensions({ width: 1024, height: 1872 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("1536")));
});

test("requires every action row to have non-empty used cells", () => {
  const ok = validatePetActions(FULL_ACTION_FRAMES);
  assert.equal(ok.ok, true);

  const missing = { ...FULL_ACTION_FRAMES };
  delete missing.review;
  const missingResult = validatePetActions(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((message) => message.includes("review")));

  const emptyRow = { ...FULL_ACTION_FRAMES, waving: 0 };
  const emptyResult = validatePetActions(emptyRow);
  assert.equal(emptyResult.ok, false);
  assert.ok(emptyResult.errors.some((message) => message.includes("waving")));
});

test("combines manifest, dimension, and action checks", () => {
  const result = validatePet({
    manifest: { id: "p", name: "P", spritesheet: "s.webp" },
    dimensions: { width: 1536, height: 1872 },
    actionFrameCounts: FULL_ACTION_FRAMES
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("surfaces all failures from a broken pet", () => {
  const result = validatePet({
    manifest: { name: "P" },
    dimensions: { width: 100, height: 100 },
    actionFrameCounts: { idle: 6 }
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3);
});
