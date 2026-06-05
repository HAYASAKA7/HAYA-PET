import { normalizePlatform } from "../../../../packages/platform-core/src/platform.js";

export function getTerminalAttachmentStrategy(options = {}) {
  const platform = normalizePlatform(options.platform);
  const env = options.env ?? process.env;

  if (platform === "windows") {
    return {
      supported: "best-effort",
      strategy: "win32-window-helper",
      reason: "Windows terminal windows require process tree and HWND lookup."
    };
  }

  if (platform === "macos") {
    return {
      supported: "best-effort",
      strategy: "macos-accessibility-helper",
      reason: "macOS terminal attachment requires Accessibility or window-list permissions."
    };
  }

  if (platform === "linux" && env.WAYLAND_DISPLAY) {
    return {
      supported: "fallback",
      strategy: "manual-fallback",
      reason: "Wayland commonly blocks global window positioning and terminal lookup."
    };
  }

  if (platform === "linux") {
    return {
      supported: "best-effort",
      strategy: "x11-window-helper",
      reason: "X11 allows best-effort terminal window discovery."
    };
  }

  return {
    supported: "fallback",
    strategy: "manual-fallback",
    reason: "Unsupported platforms use manual bubble positioning."
  };
}
