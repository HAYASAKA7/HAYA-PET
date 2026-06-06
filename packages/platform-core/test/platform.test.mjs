import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { getPlatformCapabilities } from "../src/capabilities.js";
import { getDefaultPaths } from "../src/paths.js";
import { normalizePlatform } from "../src/platform.js";

test("normalizes supported and unsupported platforms", () => {
  assert.equal(normalizePlatform("win32"), "windows");
  assert.equal(normalizePlatform("darwin"), "macos");
  assert.equal(normalizePlatform("linux"), "linux");
  assert.equal(normalizePlatform("freebsd"), "unsupported");
});

test("returns Windows local app paths and named pipe endpoint", () => {
  const paths = getDefaultPaths({
    platform: "windows",
    env: {
      LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local",
      APPDATA: "C:\\Users\\A\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\A"
    },
    homeDir: "C:\\Users\\A"
  });

  assert.equal(paths.ipcEndpoint, "\\\\.\\pipe\\haya-petd");
  assert.equal(paths.statePath, "C:\\Users\\A\\AppData\\Local\\haya-pet\\state.json");
  assert.equal(paths.configPath, "C:\\Users\\A\\AppData\\Roaming\\haya-pet\\config.json");
  assert.deepEqual(paths.petSearchPaths, [
    "C:\\Users\\A\\.codex\\pets",
    "C:\\Users\\A\\AppData\\Local\\haya-pet\\pets"
  ]);
});

test("returns macOS local app paths and Unix socket endpoint", () => {
  const paths = getDefaultPaths({
    platform: "macos",
    env: {},
    homeDir: "/Users/a"
  });

  assert.equal(paths.ipcEndpoint, "/Users/a/.haya-pet/haya-petd.sock");
  assert.equal(paths.statePath, "/Users/a/.haya-pet/state.json");
  assert.equal(paths.configPath, "/Users/a/.haya-pet/config.json");
  assert.deepEqual(paths.petSearchPaths, [
    "/Users/a/.codex/pets",
    "/Users/a/.haya-pet/pets"
  ]);
});

test("returns Linux local app paths and Unix socket endpoint", () => {
  const paths = getDefaultPaths({
    platform: "linux",
    env: {},
    homeDir: "/home/a"
  });

  assert.equal(paths.ipcEndpoint, "/home/a/.haya-pet/haya-petd.sock");
  assert.equal(paths.statePath, "/home/a/.haya-pet/state.json");
  assert.equal(paths.configPath, "/home/a/.haya-pet/config.json");
  assert.deepEqual(paths.petSearchPaths, [
    "/home/a/.codex/pets",
    "/home/a/.haya-pet/pets"
  ]);
});

test("reports platform capabilities and Wayland fallbacks", () => {
  assert.deepEqual(getPlatformCapabilities({ platform: "windows", env: {} }), {
    platform: "windows",
    ipcTransport: "named-pipe",
    transparentOverlay: "required",
    terminalAttachment: "best-effort",
    displayManagement: "required",
    fallbackMode: "none"
  });

  assert.equal(
    getPlatformCapabilities({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }).terminalAttachment,
    "fallback"
  );
  assert.equal(
    getPlatformCapabilities({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }).transparentOverlay,
    "best-effort"
  );
});
