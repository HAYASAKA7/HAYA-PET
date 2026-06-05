import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getTerminalAttachmentStrategy } from "../src/main/terminal-locator.js";

test("uses Windows helper strategy on Windows", () => {
  assert.deepEqual(getTerminalAttachmentStrategy({ platform: "windows", env: {} }), {
    supported: "best-effort",
    strategy: "win32-window-helper",
    reason: "Windows terminal windows require process tree and HWND lookup."
  });
});

test("uses macOS accessibility helper strategy on macOS", () => {
  assert.deepEqual(getTerminalAttachmentStrategy({ platform: "macos", env: {} }), {
    supported: "best-effort",
    strategy: "macos-accessibility-helper",
    reason: "macOS terminal attachment requires Accessibility or window-list permissions."
  });
});

test("uses X11 helper strategy for Linux X11", () => {
  assert.deepEqual(getTerminalAttachmentStrategy({ platform: "linux", env: { DISPLAY: ":0" } }), {
    supported: "best-effort",
    strategy: "x11-window-helper",
    reason: "X11 allows best-effort terminal window discovery."
  });
});

test("uses manual fallback strategy for Linux Wayland", () => {
  assert.deepEqual(getTerminalAttachmentStrategy({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }), {
    supported: "fallback",
    strategy: "manual-fallback",
    reason: "Wayland commonly blocks global window positioning and terminal lookup."
  });
});
