import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  createDefaultPositionState,
  getPetScale,
  getSelectedPetId,
  parsePositionState,
  serializePositionState,
  setPetScale,
  setSelectedPet
} from "../src/state.js";

test("default state has no selected pet", () => {
  assert.equal(getSelectedPetId(createDefaultPositionState()), undefined);
});

test("setSelectedPet stores the id immutably", () => {
  const state = createDefaultPositionState();
  const next = setSelectedPet(state, "cat");

  assert.equal(getSelectedPetId(next), "cat");
  // original is untouched
  assert.equal(getSelectedPetId(state), undefined);
  assert.notEqual(next.globalPet, state.globalPet);
});

test("setSelectedPet preserves other globalPet fields", () => {
  const state = { ...createDefaultPositionState(), globalPet: { open: true, x: 10, y: 20, manual: true } };
  const next = setSelectedPet(state, "dog");

  assert.equal(next.globalPet.x, 10);
  assert.equal(next.globalPet.y, 20);
  assert.equal(next.globalPet.manual, true);
  assert.equal(next.globalPet.selectedPetId, "dog");
});

test("getSelectedPetId tolerates missing state", () => {
  assert.equal(getSelectedPetId(undefined), undefined);
  assert.equal(getSelectedPetId({}), undefined);
});

test("setPetScale stores the scale immutably", () => {
  const state = createDefaultPositionState();
  const next = setPetScale(state, 1.5);

  assert.equal(getPetScale(next), 1.5);
  assert.equal(getPetScale(state), undefined);
  assert.notEqual(next.globalPet, state.globalPet);
});

test("setPetScale preserves other globalPet fields", () => {
  const state = { ...createDefaultPositionState(), globalPet: { open: true, x: 10, y: 20, manual: true } };
  const next = setPetScale(state, 0.75);

  assert.equal(next.globalPet.x, 10);
  assert.equal(next.globalPet.manual, true);
  assert.equal(next.globalPet.scale, 0.75);
});

test("getPetScale returns undefined for missing or invalid values", () => {
  assert.equal(getPetScale(undefined), undefined);
  assert.equal(getPetScale(createDefaultPositionState()), undefined);
  assert.equal(getPetScale(setPetScale(createDefaultPositionState(), Number.NaN)), undefined);
  assert.equal(getPetScale({ globalPet: { scale: "big" } }), undefined);
});

test("scale survives a serialize/parse round-trip and old files parse without it", () => {
  const withScale = parsePositionState(serializePositionState(setPetScale(createDefaultPositionState(), 1.25)));
  assert.equal(getPetScale(withScale), 1.25);

  const legacy = parsePositionState(JSON.stringify({ globalPet: { open: true, x: 1, y: 2 } }));
  assert.equal(getPetScale(legacy), undefined);
});
