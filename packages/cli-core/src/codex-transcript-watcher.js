// Tails Codex session JSONL and reports tool start/finish activity. Codex hooks
// cover turn lifecycle, but the transcript is the reliable source for tool use
// when PreToolUse is unavailable.
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync
} from "node:fs";
import { join } from "node:path";
import { parseCodexTranscriptLines } from "../../adapters/src/codex-transcript.js";

const DEFAULT_POLL_MS = 700;
const MTIME_SKEW_MS = 2000;

export function watchCodexTranscript(options = {}) {
  const {
    homeDir = process.env.USERPROFILE || process.env.HOME,
    startedAt = 0,
    onToolEvent = () => {},
    pollIntervalMs = DEFAULT_POLL_MS,
    sessionsRoot,
    transcriptPath: fixedPath,
    setInterval: setIntervalFn = setInterval,
    clearInterval: clearIntervalFn = clearInterval
  } = options;

  const root = sessionsRoot ?? (homeDir ? join(homeDir, ".codex", "sessions") : undefined);
  const minMtime = startedAt > 0 ? startedAt - MTIME_SKEW_MS : 0;

  let transcriptPath = fixedPath;
  let offset = 0;
  let carry = "";

  const tick = () => {
    try {
      if (!transcriptPath) {
        transcriptPath = discoverCodexTranscript(root, minMtime);
        if (!transcriptPath) {
          return;
        }
        // Replay from the start rather than skipping to the end: Codex may
        // have written the session's first tool calls before our first poll,
        // and skipping them would lose the initial running-tool status. The
        // per-record timestamp filter below keeps an earlier session's records
        // (in a resumed/rotated file) from replaying as live activity.
      }

      const size = safeSize(transcriptPath);
      if (size <= offset) {
        if (size < offset) {
          offset = size;
          carry = "";
        }
        return;
      }

      const chunk = readRange(transcriptPath, offset, size);
      offset = size;

      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";

      for (const event of parseCodexTranscriptLines(lines, { minTimestampMs: startedAt })) {
        onToolEvent(event);
      }
    } catch {
      // best-effort: transcript surprises must never crash the wrapper
    }
  };

  const timer = setIntervalFn(tick, pollIntervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    stop() {
      clearIntervalFn(timer);
    },
    _tick: tick
  };
}

export function discoverCodexTranscript(root, minMtime = 0) {
  if (!root || !existsSync(root)) {
    return undefined;
  }

  let newest;
  for (const file of listJsonlFiles(root)) {
    const mtime = safeMtime(file);
    if (mtime < minMtime) {
      continue;
    }
    if (!newest || mtime > newest.mtime) {
      newest = { file, mtime };
    }
  }
  return newest?.file;
}

function listJsonlFiles(root) {
  const files = [];
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

function safeSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function safeMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function readRange(path, start, end) {
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
