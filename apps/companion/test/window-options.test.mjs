import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getPlatformCapabilities } from "../../../packages/platform-core/src/capabilities.js";
import { buildPetWindowOptions } from "../src/main/window-options.js";

test("builds non-focus-stealing transparent overlay options", () => {
  const options = buildPetWindowOptions({
    platform: "windows",
    capabilities: getPlatformCapabilities({ platform: "windows", env: {} }),
    bounds: { x: 100, y: 200, width: 192, height: 208 }
  });

  assert.equal(options.overlayMode, "transparent-overlay");
  assert.deepEqual(options.browserWindow, {
    x: 100,
    y: 200,
    width: 192,
    height: 208,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    backgroundColor: "#00000000"
  });
});

test("uses transparent overlay mode for macOS and Linux X11 capabilities", () => {
  assert.equal(
    buildPetWindowOptions({
      platform: "macos",
      capabilities: getPlatformCapabilities({ platform: "macos", env: {} }),
      bounds: { width: 192, height: 208 }
    }).overlayMode,
    "transparent-overlay"
  );

  assert.equal(
    buildPetWindowOptions({
      platform: "linux",
      capabilities: getPlatformCapabilities({ platform: "linux", env: { DISPLAY: ":0" } }),
      bounds: { width: 192, height: 208 }
    }).overlayMode,
    "transparent-overlay"
  );
});

test("uses fallback window mode when platform capabilities do not guarantee overlay positioning", () => {
  const options = buildPetWindowOptions({
    platform: "linux",
    capabilities: getPlatformCapabilities({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }),
    bounds: { width: 384, height: 416 }
  });

  assert.equal(options.overlayMode, "fallback-window");
  assert.equal(options.browserWindow.transparent, false);
  assert.equal(options.browserWindow.frame, true);
  assert.equal(options.browserWindow.focusable, true);
  assert.equal(options.browserWindow.skipTaskbar, false);
});
