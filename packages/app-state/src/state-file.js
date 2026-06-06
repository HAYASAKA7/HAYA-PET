import { dirname } from "node:path";
import {
  createDefaultPositionState,
  parsePositionState,
  serializePositionState
} from "./state.js";

// Thin filesystem wrapper around the pure state helpers. The fs functions are
// injectable so the load/save behaviour is testable without touching the disk.
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
      } catch {
        // Missing or unreadable file falls back to defaults, same as corrupt JSON.
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
