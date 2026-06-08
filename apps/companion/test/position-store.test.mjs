import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  createDefaultPositionState,
  parsePositionState,
  serializePositionState,
  updateGlobalPetPosition
} from "../src/main/position-store.js";

test("creates default position state", () => {
  assert.deepEqual(createDefaultPositionState(), {
    globalPet: {
      open: true,
      selectedPetId: undefined,
      manual: false
    },
    sessions: {},
    settings: {
      displayMode: "hybrid",
      attachBubblesToTerminals: true,
      claudeHooks: false
    }
  });
});

test("updates global pet position as a manual placement", () => {
  const state = updateGlobalPetPosition(createDefaultPositionState(), {
    x: 100,
    y: 200,
    width: 192,
    height: 208,
    displayId: "primary"
  });

  assert.equal(state.globalPet.manual, true);
  assert.equal(state.globalPet.x, 100);
  assert.equal(state.globalPet.displayId, "primary");
});

test("serializes and parses position state", () => {
  const state = updateGlobalPetPosition(createDefaultPositionState(), {
    x: 100,
    y: 200,
    width: 192,
    height: 208,
    displayId: "primary"
  });

  assert.deepEqual(parsePositionState(serializePositionState(state)), state);
});

test("invalid stored position state falls back to defaults", () => {
  assert.deepEqual(parsePositionState("{not-json}"), createDefaultPositionState());
  assert.deepEqual(parsePositionState("{}"), createDefaultPositionState());
});
