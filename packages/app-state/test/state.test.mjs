import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  createDefaultPositionState,
  getSelectedPetId,
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
