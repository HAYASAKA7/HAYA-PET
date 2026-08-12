// Shared best-effort filesystem helpers for tailing Codex rollout JSONL files
// (~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl). Used by the main transcript
// watcher and the guardian-review watcher. Every helper swallows fs errors —
// rollout surprises must never crash the wrapper.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

// A session_meta first line is normally a few KB, but guardian trunks embed the
// reviewer's full base instructions (~10 KB observed); leave generous headroom.
const FIRST_LINE_MAX_BYTES = 262_144;

export function listJsonlFiles(root, options = {}) {
  return walkJsonlFiles(root, options.readdir ?? readdirSync);
}

// Linked production watchers already know their main rollout, so guardian
// discovery only needs date folders where a new guardian trunk can be created
// during this run. Avoid walking years of Codex history on every poll. The
// generic fallback preserves tests and custom roots that do not use Codex's
// YYYY/MM/DD layout.
export function listRecentJsonlFiles(root, options = {}) {
  const minTimestampMs = Number(options.minTimestampMs);
  if (!Number.isFinite(minTimestampMs) || minTimestampMs <= 0) {
    return listJsonlFiles(root, options);
  }

  const readdir = options.readdir ?? readdirSync;
  const nowValue = typeof options.now === "function" ? options.now() : Date.now();
  const nowMs = Number.isFinite(nowValue) ? nowValue : Date.now();
  const rootEntries = safeReadDir(root, readdir);
  const calendarLayout = rootEntries.some((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name));
  if (!calendarLayout) {
    return walkJsonlFiles(root, readdir);
  }

  const files = [];
  for (const parts of recentDateParts(minTimestampMs, nowMs)) {
    files.push(...walkJsonlFiles(join(root, parts.year, parts.month, parts.day), readdir));
  }
  return files;
}

function walkJsonlFiles(root, readdir) {
  const files = [];
  if (!root || !existsSync(root)) {
    return files;
  }

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }

  return files;
}

function safeReadDir(path, readdir) {
  try {
    return readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function recentDateParts(minTimestampMs, nowMs) {
  const DAY_MS = 86_400_000;
  const timestamps = [minTimestampMs, nowMs];
  const keys = new Map();

  for (const timestamp of timestamps) {
    for (const offset of [-DAY_MS, 0, DAY_MS]) {
      const date = new Date(timestamp + offset);
      addDateParts(keys, date.getFullYear(), date.getMonth() + 1, date.getDate());
      addDateParts(keys, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  return [...keys.values()];
}

function addDateParts(target, year, month, day) {
  const parts = {
    year: String(year).padStart(4, "0"),
    month: String(month).padStart(2, "0"),
    day: String(day).padStart(2, "0")
  };
  target.set(`${parts.year}/${parts.month}/${parts.day}`, parts);
}

export function safeSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function safeMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function readRange(path, start, end) {
  const length = end - start;
  if (length <= 0) {
    return "";
  }
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// First newline-terminated line of a file, or undefined while none exists yet
// (a rollout that was just created and not flushed). Callers must treat
// undefined as "retry later", never as a final classification.
export function readFirstLine(path, maxBytes = FIRST_LINE_MAX_BYTES) {
  let chunk;
  try {
    chunk = readRange(path, 0, Math.min(safeSize(path), maxBytes));
  } catch {
    return undefined;
  }

  const newlineIndex = chunk.indexOf("\n");
  if (newlineIndex === -1) {
    return undefined;
  }
  return chunk.slice(0, newlineIndex);
}
