import { mkdirSync } from "node:fs";

export const ELECTRON_APP_NAME = "HAYA Pet";

export function configureElectronStorage(app, paths = {}, options = {}) {
  const mkdir = options.mkdir ?? ((path) => mkdirSync(path, { recursive: true }));
  const onError = typeof options.onError === "function" ? options.onError : () => {};

  trySetName(app, onError);
  trySetAppLogsPath(app, paths.logDir, onError);

  setElectronPath(app, "userData", paths.electronUserDataDir, mkdir, onError);
  setElectronPath(app, "sessionData", paths.electronSessionDataDir, mkdir, onError);
  setElectronPath(app, "crashDumps", paths.crashDumpsDir, mkdir, onError);
}

function trySetName(app, onError) {
  try {
    app?.setName?.(ELECTRON_APP_NAME);
  } catch (error) {
    onError({ name: "appName", path: undefined, message: error?.message ?? String(error) });
  }
}

function trySetAppLogsPath(app, logDir, onError) {
  if (!logDir || typeof app?.setAppLogsPath !== "function") {
    return;
  }
  try {
    app.setAppLogsPath(logDir);
  } catch (error) {
    onError({ name: "logs", path: logDir, message: error?.message ?? String(error) });
  }
}

function setElectronPath(app, name, path, mkdir, onError) {
  if (!path || typeof app?.setPath !== "function") {
    return;
  }
  try {
    mkdir(path);
    app.setPath(name, path);
  } catch (error) {
    onError({ name, path, message: error?.message ?? String(error) });
  }
}