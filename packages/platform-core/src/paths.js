import { normalizePlatform } from "./platform.js";

export function getDefaultPaths(options = {}) {
  const platform = normalizePlatform(options.platform);
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? env.HOME ?? env.USERPROFILE;

  if (!homeDir) {
    throw new Error("homeDir is required when no HOME or USERPROFILE environment variable is available");
  }

  if (platform === "windows") {
    return getWindowsPaths(env, homeDir);
  }

  if (platform === "macos" || platform === "linux") {
    return getUnixPaths(homeDir);
  }

  return getUnsupportedPaths(homeDir);
}

function getWindowsPaths(env, homeDir) {
  const localAppData = env.LOCALAPPDATA ?? joinWindows(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? joinWindows(homeDir, "AppData", "Roaming");

  return {
    platform: "windows",
    ipcEndpoint: "\\\\.\\pipe\\ai-petd",
    statePath: joinWindows(localAppData, "ai-pet", "state.json"),
    configPath: joinWindows(appData, "ai-pet", "config.json"),
    logDir: joinWindows(localAppData, "ai-pet", "logs"),
    petSearchPaths: [
      joinWindows(homeDir, ".codex", "pets"),
      joinWindows(localAppData, "ai-pet", "pets")
    ]
  };
}

function getUnixPaths(homeDir) {
  return {
    platform: "unix",
    ipcEndpoint: joinUnix(homeDir, ".ai-pet", "ai-petd.sock"),
    statePath: joinUnix(homeDir, ".ai-pet", "state.json"),
    configPath: joinUnix(homeDir, ".ai-pet", "config.json"),
    logDir: joinUnix(homeDir, ".ai-pet", "logs"),
    petSearchPaths: [
      joinUnix(homeDir, ".codex", "pets"),
      joinUnix(homeDir, ".ai-pet", "pets")
    ]
  };
}

function getUnsupportedPaths(homeDir) {
  return {
    platform: "unsupported",
    ipcEndpoint: joinUnix(homeDir, ".ai-pet", "ai-petd.sock"),
    statePath: joinUnix(homeDir, ".ai-pet", "state.json"),
    configPath: joinUnix(homeDir, ".ai-pet", "config.json"),
    logDir: joinUnix(homeDir, ".ai-pet", "logs"),
    petSearchPaths: [
      joinUnix(homeDir, ".codex", "pets"),
      joinUnix(homeDir, ".ai-pet", "pets")
    ]
  };
}

function joinWindows(...parts) {
  return parts.filter(Boolean).join("\\").replace(/\\+/g, "\\");
}

function joinUnix(...parts) {
  const [first, ...rest] = parts.filter(Boolean);
  return [first.replace(/\/+$/g, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}
