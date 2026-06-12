// Shared best-effort filesystem helpers for tailing Codex rollout JSONL files
// (~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl). Used by the main transcript
// watcher and the guardian-review watcher. Every helper swallows fs errors —
// rollout surprises must never crash the wrapper.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

// A session_meta first line is normally a few KB, but guardian trunks embed the
// reviewer's full base instructions (~10 KB observed); leave generous headroom.
const FIRST_LINE_MAX_BYTES = 262_144;

export function listJsonlFiles(root) {
  const files = [];
  if (!root || !existsSync(root)) {
    return files;
  }

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
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
