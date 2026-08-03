import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { resolvePetMenuPopupOptions } from "../src/main/pet-menu-popup.js";

test("does not parent the pet context menu to a non-focusable overlay window", () => {
  const ownerWindow = fakeWindow({ focusable: false });

  assert.deepEqual(resolvePetMenuPopupOptions(ownerWindow), {});
});

test("parents the pet context menu to a focusable fallback window", () => {
  const ownerWindow = fakeWindow({ focusable: true });

  assert.deepEqual(resolvePetMenuPopupOptions(ownerWindow), { window: ownerWindow });
});

function fakeWindow({ focusable }) {
  return {
    isDestroyed: () => false,
    isFocusable: () => focusable
  };
}
