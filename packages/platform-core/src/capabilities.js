import { normalizePlatform } from "./platform.js";

export function getPlatformCapabilities(options = {}) {
  const platform = normalizePlatform(options.platform);
  const env = options.env ?? process.env;

  if (platform === "windows") {
    return {
      platform,
      ipcTransport: "named-pipe",
      transparentOverlay: "required",
      terminalAttachment: "best-effort",
      displayManagement: "required",
      mouseMoveForwarding: "required",
      fallbackMode: "none"
    };
  }

  if (platform === "macos") {
    return {
      platform,
      ipcTransport: "unix-socket",
      transparentOverlay: "required",
      terminalAttachment: "best-effort",
      displayManagement: "required",
      mouseMoveForwarding: "required",
      fallbackMode: "none"
    };
  }

  if (platform === "linux") {
    const isWayland = Boolean(env.WAYLAND_DISPLAY);
    return {
      platform,
      ipcTransport: "unix-socket",
      transparentOverlay: isWayland ? "best-effort" : "required",
      terminalAttachment: isWayland ? "fallback" : "best-effort",
      displayManagement: "required",
      mouseMoveForwarding: "unsupported",
      fallbackMode: isWayland ? "wayland-cluster" : "none"
    };
  }

  return {
    platform,
    ipcTransport: "unsupported",
    transparentOverlay: "fallback",
    terminalAttachment: "fallback",
    displayManagement: "fallback",
    mouseMoveForwarding: "unsupported",
    fallbackMode: "normal-window"
  };
}
