import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { showPetMenuPopup } from "../src/main/pet-menu-popup.js";

test("uses the tray to own a Windows overlay menu without focusing the pet window", () => {
  const menu = fakeMenu();
  const ownerWindow = fakeWindow({ focusable: false });
  const tray = fakeTray();
  const position = { x: 240, y: 360 };

  assert.equal(
    showPetMenuPopup({ menu, ownerWindow, tray, platform: "win32", position }),
    true
  );
  assert.deepEqual(tray.popup, { menu, position });
  assert.equal(menu.popupOptions, undefined);
});

test("uses a focusable fallback window as the menu owner", () => {
  const menu = fakeMenu();
  const ownerWindow = fakeWindow({ focusable: true });

  assert.equal(
    showPetMenuPopup({ menu, ownerWindow, tray: fakeTray(), platform: "win32" }),
    true
  );
  assert.deepEqual(menu.popupOptions, { window: ownerWindow });
});

test("keeps the ownerless popup path for non-Windows nonfocusable overlays", () => {
  const menu = fakeMenu();
  const ownerWindow = fakeWindow({ focusable: false });

  assert.equal(showPetMenuPopup({ menu, ownerWindow, platform: "darwin" }), true);
  assert.deepEqual(menu.popupOptions, {});
});

test("does not open a Windows overlay menu without a live tray owner", () => {
  const menu = fakeMenu();
  const ownerWindow = fakeWindow({ focusable: false });

  assert.equal(showPetMenuPopup({ menu, ownerWindow, platform: "win32" }), false);
  assert.equal(
    showPetMenuPopup({
      menu,
      ownerWindow,
      tray: fakeTray({ destroyed: true }),
      platform: "win32"
    }),
    false
  );
  assert.equal(menu.popupOptions, undefined);
});

test("does not open the pet menu without a live owner window", () => {
  const menu = fakeMenu();

  assert.equal(showPetMenuPopup({ menu, ownerWindow: undefined, platform: "win32" }), false);
  assert.equal(
    showPetMenuPopup({
      menu,
      ownerWindow: fakeWindow({ focusable: false, destroyed: true }),
      tray: fakeTray(),
      platform: "win32"
    }),
    false
  );
  assert.equal(menu.popupOptions, undefined);
});

function fakeWindow({ focusable, destroyed = false }) {
  return {
    isDestroyed: () => destroyed,
    isFocusable: () => focusable,
    setFocusable: () => {
      throw new Error("pet window focusability must not change");
    },
    focus: () => {
      throw new Error("pet window must not receive focus");
    }
  };
}

function fakeMenu() {
  return {
    popupOptions: undefined,
    popup(options) {
      this.popupOptions = options;
    }
  };
}

function fakeTray({ destroyed = false } = {}) {
  return {
    popup: undefined,
    isDestroyed: () => destroyed,
    popUpContextMenu(menu, position) {
      this.popup = { menu, position };
    }
  };
}
