import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  DEFAULT_FRAME_DURATION_MS,
  getFrameDurationMs,
  parsePetManifest
} from "../src/manifest.js";

test("parses a minimal pet manifest with defaults", () => {
  const result = parsePetManifest({
    id: "example-pet",
    name: "Example Pet",
    spritesheet: "spritesheet.webp"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.id, "example-pet");
  assert.equal(result.manifest.name, "Example Pet");
  assert.equal(result.manifest.spritesheet, "spritesheet.webp");
  assert.equal(result.manifest.cellWidth, 192);
  assert.equal(result.manifest.cellHeight, 208);
  assert.equal(result.manifest.frameDurationMs, DEFAULT_FRAME_DURATION_MS);
});

test("accepts Codex-style displayName and spritesheetPath aliases", () => {
  const result = parsePetManifest({
    id: "toru-pixel",
    displayName: "Toru Pixel",
    description: "A pixel pet",
    spritesheetPath: "spritesheet.webp"
  });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.id, "toru-pixel");
  assert.equal(result.manifest.name, "Toru Pixel");
  assert.equal(result.manifest.spritesheet, "spritesheet.webp");
});

test("prefers canonical fields over aliases when both are present", () => {
  const result = parsePetManifest({
    id: "p",
    name: "Canonical",
    displayName: "Alias",
    spritesheet: "real.webp",
    spritesheetPath: "alias.webp"
  });

  assert.equal(result.manifest.name, "Canonical");
  assert.equal(result.manifest.spritesheet, "real.webp");
});

test("rejects manifests missing required fields", () => {
  const result = parsePetManifest({ name: "No Id" });

  assert.equal(result.ok, false);
  assert.equal(result.manifest, undefined);
  assert.ok(result.errors.some((message) => message.includes("id")));
  assert.ok(result.errors.some((message) => message.includes("spritesheet")));
});

test("rejects cell dimensions that do not match the Codex atlas", () => {
  const result = parsePetManifest({
    id: "p",
    name: "P",
    spritesheet: "s.webp",
    cellWidth: 200,
    cellHeight: 208
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("cellWidth")));
});

test("normalizes per-action frame duration overrides", () => {
  const result = parsePetManifest({
    id: "p",
    name: "P",
    spritesheet: "s.webp",
    frameDurationMs: 100,
    actionFrameDurations: { idle: 250 },
    actionLoopPausesMs: { review: 1000 }
  });

  assert.equal(result.ok, true);
  assert.equal(getFrameDurationMs(result.manifest, "idle"), 250);
  assert.equal(getFrameDurationMs(result.manifest, "running"), 100);
  assert.deepEqual(result.manifest.actionLoopPausesMs, { review: 1000 });
});

test("rejects non-object manifests", () => {
  const result = parsePetManifest("not-json");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("object")));
});
