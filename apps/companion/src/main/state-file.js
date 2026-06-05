import { dirname } from "node:path";
import {
  createDefaultPositionState,
  parsePositionState,
  serializePositionState
} from "./position-store.js";

// Thin filesystem wrapper around the pure position-store helpers. The fs
// functions are injectable so the load/save behaviour is testable without
// touching the real disk.
export function createStateFile({ statePath, readFile, writeFile, mkdir } = {}) {
  if (typeof statePath !== "string" || statePath.trim() === "") {
    throw new Error("statePath is required");
  }

  const read = readFile ?? defaultReadFile;
  const write = writeFile ?? defaultWriteFile;
  const ensureDir = mkdir ?? defaultMkdir;

  return {
    statePath,

    async load() {
      try {
        const text = await read(statePath, "utf8");
        return parsePositionState(text);
      } catch (error) {
        if (error && error.code !== "ENOENT") {
          // A readable-but-broken file should not crash the daemon; fall back
          // to defaults the same way corrupt JSON does.
        }
        return createDefaultPositionState();
      }
    },

    async save(state) {
      await ensureDir(dirname(statePath), { recursive: true });
      await write(statePath, serializePositionState(state));
      return state;
    }
  };
}

async function defaultReadFile(path, encoding) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, encoding);
}

async function defaultWriteFile(path, content) {
  const { writeFile } = await import("node:fs/promises");
  return writeFile(path, content);
}

async function defaultMkdir(path, options) {
  const { mkdir } = await import("node:fs/promises");
  return mkdir(path, options);
}
