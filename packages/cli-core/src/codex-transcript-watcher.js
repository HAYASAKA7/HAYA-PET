// Tails Codex session JSONL and reports tool start/finish activity. Codex hooks
// cover turn lifecycle, but the transcript is the reliable source for tool use
// when PreToolUse is unavailable.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseCodexTranscriptLines } from "../../adapters/src/codex-transcript.js";
import { listJsonlFiles, readFirstLine, readRange, safeMtime, safeSize } from "./codex-rollout-fs.js";

const DEFAULT_POLL_MS = 700;
const MTIME_SKEW_MS = 2000;

export function watchCodexTranscript(options = {}) {
  const {
    homeDir = process.env.USERPROFILE || process.env.HOME,
    cwd,
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
        transcriptPath = discoverCodexTranscript(root, minMtime, { cwd });
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

export function discoverCodexTranscript(root, minMtime = 0, options = {}) {
  if (!root || !existsSync(root)) {
    return undefined;
  }

  const expectedCwd = normalizePathForCompare(options.cwd);
  let newest;
  for (const file of listJsonlFiles(root)) {
    const mtime = safeMtime(file);
    if (mtime < minMtime) {
      continue;
    }
    const meta = readCodexSessionMeta(file);
    if (!meta) {
      continue;
    }

    const isFreshSession = meta.startedAt >= minMtime;
    const isFreshResume = expectedCwd !== undefined && normalizePathForCompare(meta.cwd) === expectedCwd;
    if (!isFreshSession && !isFreshResume) {
      continue;
    }

    if (!newest || mtime > newest.mtime) {
      newest = { file, mtime };
    }
  }
  return newest?.file;
}

function readCodexSessionMeta(file) {
  const line = readFirstLine(file);
  if (line === undefined) {
    return undefined;
  }

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (entry?.type !== "session_meta" || typeof entry.timestamp !== "string") {
    return undefined;
  }

  const timestampMs = Date.parse(entry.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return {
    startedAt: timestampMs,
    cwd: typeof entry.payload?.cwd === "string" ? entry.payload.cwd : undefined
  };
}

function normalizePathForCompare(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}
