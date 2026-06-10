import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  clampScale,
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  resolveScaleFromDrag
} from "../src/pet-scale.js";

const baseSize = { width: 192, height: 208 };

test("scale constants define a sane range around the default", () => {
  assert.equal(DEFAULT_SCALE, 1);
  assert.ok(MIN_SCALE < DEFAULT_SCALE);
  assert.ok(MAX_SCALE > DEFAULT_SCALE);
});

test("clampScale keeps in-range values and clamps out-of-range ones", () => {
  assert.equal(clampScale(1.25), 1.25);
  assert.equal(clampScale(MIN_SCALE), MIN_SCALE);
  assert.equal(clampScale(MAX_SCALE), MAX_SCALE);
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(99), MAX_SCALE);
});

test("clampScale falls back to the default for invalid input", () => {
  assert.equal(clampScale(undefined), DEFAULT_SCALE);
  assert.equal(clampScale(null), DEFAULT_SCALE);
  assert.equal(clampScale(Number.NaN), DEFAULT_SCALE);
  assert.equal(clampScale("big"), DEFAULT_SCALE);
});

test("dragging the grip outward grows the scale", () => {
  const next = resolveScaleFromDrag({
    startScale: 1,
    startPointer: { x: 500, y: 500 },
    pointer: { x: 500 + baseSize.width / 2, y: 500 + baseSize.height / 2 },
    baseSize
  });

  assert.equal(next, 1.5);
});

test("dragging the grip inward shrinks the scale", () => {
  const next = resolveScaleFromDrag({
    startScale: 1,
    startPointer: { x: 500, y: 500 },
    pointer: { x: 500 - baseSize.width / 4, y: 500 - baseSize.height / 4 },
    baseSize
  });

  assert.equal(next, 0.75);
});

test("a zero drag keeps the starting scale", () => {
  const next = resolveScaleFromDrag({
    startScale: 1.3,
    startPointer: { x: 10, y: 10 },
    pointer: { x: 10, y: 10 },
    baseSize
  });

  assert.equal(next, 1.3);
});

test("drag results are clamped to the scale range", () => {
  const grown = resolveScaleFromDrag({
    startScale: 1.8,
    startPointer: { x: 0, y: 0 },
    pointer: { x: 1000, y: 1000 },
    baseSize
  });
  const shrunk = resolveScaleFromDrag({
    startScale: 0.6,
    startPointer: { x: 1000, y: 1000 },
    pointer: { x: 0, y: 0 },
    baseSize
  });

  assert.equal(grown, MAX_SCALE);
  assert.equal(shrunk, MIN_SCALE);
});

test("invalid drag input falls back to the clamped starting scale", () => {
  const next = resolveScaleFromDrag({
    startScale: 1.2,
    startPointer: { x: Number.NaN, y: 0 },
    pointer: { x: 50, y: 50 },
    baseSize
  });

  assert.equal(next, 1.2);
});
