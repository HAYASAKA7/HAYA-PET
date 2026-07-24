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
  const hayaLocalDir = joinWindows(localAppData, "haya-pet");

  return {
    platform: "windows",
    ipcEndpoint: "\\\\.\\pipe\\haya-petd",
    statePath: joinWindows(hayaLocalDir, "state.json"),
    configPath: joinWindows(appData, "haya-pet", "config.json"),
    logDir: joinWindows(hayaLocalDir, "logs"),
    companionLogPath: joinWindows(hayaLocalDir, "logs", "companion.log"),
    sessionDir: joinWindows(hayaLocalDir, "sessions"),
    electronUserDataDir: joinWindows(hayaLocalDir, "electron-user-data"),
    electronSessionDataDir: joinWindows(hayaLocalDir, "electron-session-data"),
    crashDumpsDir: joinWindows(hayaLocalDir, "crash-dumps"),
    petSearchPaths: [
      joinWindows(homeDir, ".codex", "pets"),
      joinWindows(hayaLocalDir, "pets")
    ]
  };
}

function getUnixPaths(homeDir) {
  const hayaDir = joinUnix(homeDir, ".haya-pet");
  return buildUnixLikePaths("unix", hayaDir, homeDir);
}

function getUnsupportedPaths(homeDir) {
  const hayaDir = joinUnix(homeDir, ".haya-pet");
  return buildUnixLikePaths("unsupported", hayaDir, homeDir);
}

function buildUnixLikePaths(platform, hayaDir, homeDir) {
  return {
    platform,
    ipcEndpoint: joinUnix(hayaDir, "haya-petd.sock"),
    statePath: joinUnix(hayaDir, "state.json"),
    configPath: joinUnix(hayaDir, "config.json"),
    logDir: joinUnix(hayaDir, "logs"),
    companionLogPath: joinUnix(hayaDir, "logs", "companion.log"),
    sessionDir: joinUnix(hayaDir, "sessions"),
    electronUserDataDir: joinUnix(hayaDir, "electron-user-data"),
    electronSessionDataDir: joinUnix(hayaDir, "electron-session-data"),
    crashDumpsDir: joinUnix(hayaDir, "crash-dumps"),
    petSearchPaths: [
      joinUnix(homeDir, ".codex", "pets"),
      joinUnix(hayaDir, "pets")
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
