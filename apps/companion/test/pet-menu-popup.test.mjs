import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import * as petMenuPopup from "../src/main/pet-menu-popup.js";

test("temporarily makes the pet window a focusable menu owner", () => {
  const calls = [];
  const ownerWindow = fakeWindow({ focusable: false, calls });
  const menu = fakeMenu(calls);

  assert.equal(petMenuPopup.showPetMenuPopup(menu, ownerWindow), true);
  assert.deepEqual(calls, ["setFocusable:true", "focus", "popup"]);
  assert.equal(menu.popupOptions.window, ownerWindow);

  menu.popupOptions.callback();

  assert.deepEqual(calls, ["setFocusable:true", "focus", "popup", "setFocusable:false"]);
});

test("uses a focusable fallback window without changing its focusability", () => {
  const calls = [];
  const ownerWindow = fakeWindow({ focusable: true, calls });
  const menu = fakeMenu(calls);

  assert.equal(petMenuPopup.showPetMenuPopup(menu, ownerWindow), true);
  assert.deepEqual(calls, ["popup"]);
  assert.equal(menu.popupOptions.window, ownerWindow);

  menu.popupOptions.callback();

  assert.deepEqual(calls, ["popup"]);
});

test("does not open the pet menu without a live owner window", () => {
  const calls = [];
  const menu = fakeMenu(calls);

  assert.equal(petMenuPopup.showPetMenuPopup(menu, undefined), false);
  assert.equal(
    petMenuPopup.showPetMenuPopup(menu, fakeWindow({ focusable: false, destroyed: true, calls })),
    false
  );
  assert.deepEqual(calls, []);
});

test("restores a nonfocusable owner when opening the menu throws", () => {
  const calls = [];
  const ownerWindow = fakeWindow({ focusable: false, calls });
  const error = new Error("popup failed");
  const menu = fakeMenu(calls, error);

  assert.throws(() => petMenuPopup.showPetMenuPopup(menu, ownerWindow), error);
  assert.deepEqual(calls, ["setFocusable:true", "focus", "popup", "setFocusable:false"]);
});

function fakeWindow({ focusable, destroyed = false, calls }) {
  return {
    isDestroyed: () => destroyed,
    isFocusable: () => focusable,
    setFocusable: (next) => calls.push(`setFocusable:${next}`),
    focus: () => calls.push("focus")
  };
}

function fakeMenu(calls, popupError) {
  return {
    popupOptions: undefined,
    popup(options) {
      this.popupOptions = options;
      calls.push("popup");
      if (popupError) {
        throw popupError;
      }
    }
  };
}
