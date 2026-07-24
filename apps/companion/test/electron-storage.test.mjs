import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { configureElectronStorage } from "../src/main/electron-storage.js";

test("configureElectronStorage isolates Electron profile and crash paths", () => {
  const calls = [];
  const madeDirs = [];
  const app = {
    setName: (name) => calls.push(["setName", name]),
    setAppLogsPath: (path) => calls.push(["setAppLogsPath", path]),
    setPath: (name, path) => calls.push(["setPath", name, path])
  };

  configureElectronStorage(app, {
    logDir: "C:\\Users\\A\\AppData\\Local\\haya-pet\\logs",
    electronUserDataDir: "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-user-data",
    electronSessionDataDir: "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-session-data",
    crashDumpsDir: "C:\\Users\\A\\AppData\\Local\\haya-pet\\crash-dumps"
  }, {
    mkdir: (path) => madeDirs.push(path)
  });

  assert.deepEqual(madeDirs, [
    "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-user-data",
    "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-session-data",
    "C:\\Users\\A\\AppData\\Local\\haya-pet\\crash-dumps"
  ]);
  assert.deepEqual(calls, [
    ["setName", "HAYA Pet"],
    ["setAppLogsPath", "C:\\Users\\A\\AppData\\Local\\haya-pet\\logs"],
    ["setPath", "userData", "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-user-data"],
    ["setPath", "sessionData", "C:\\Users\\A\\AppData\\Local\\haya-pet\\electron-session-data"],
    ["setPath", "crashDumps", "C:\\Users\\A\\AppData\\Local\\haya-pet\\crash-dumps"]
  ]);
});

test("configureElectronStorage reports path failures without throwing", () => {
  const errors = [];
  const app = {
    setName: () => {},
    setPath: (name) => {
      if (name === "sessionData") {
        throw new Error("bad path");
      }
    }
  };

  configureElectronStorage(app, {
    electronUserDataDir: "/tmp/haya/electron-user-data",
    electronSessionDataDir: "/tmp/haya/electron-session-data",
    crashDumpsDir: "/tmp/haya/crash-dumps"
  }, {
    mkdir: () => {},
    onError: (error) => errors.push(error)
  });

  assert.deepEqual(errors, [
    { name: "sessionData", path: "/tmp/haya/electron-session-data", message: "bad path" }
  ]);
});