// Tails a Claude Code session transcript and reports user-denied tool calls.
// This is the L3 "client log" adapter: Claude fires no hook when the user
// manually denies a permission, so the transcript is the only reliable, non
// time-based signal that a pending approval was resolved by a denial.
//
// Polling (not fs.watch) is used deliberately — fs.watch is unreliable on
// Windows and across network drives, and a ~700ms poll is plenty for a UI cue.
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync
} from "node:fs";
import { basename, join } from "node:path";
import { parseTranscriptLines } from "../../adapters/src/claude-transcript.js";
import { readSessionTranscriptLink } from "./session-transcript-link.js";

const DEFAULT_POLL_MS = 700;

// Claude stores transcripts under ~/.claude/projects/<sanitized-cwd>/, replacing
// path separators and the drive colon with "-" (e.g. D:\a\b -> D--a-b).
export function claudeProjectDirName(cwd) {
  return String(cwd).replace(/[\\/:]/g, "-");
}

// Tolerance (ms) when matching the active session's transcript by mtime, to
// absorb filesystem mtime granularity and tiny pre-launch skew.
const MTIME_SKEW_MS = 2000;

export function watchClaudeTranscript(options = {}) {
  const {
    cwd = process.cwd(),
    homeDir = process.env.USERPROFILE || process.env.HOME,
    startedAt = 0,
    onDenial = () => {},
    onInterrupt = () => {},
    pollIntervalMs = DEFAULT_POLL_MS,
    projectsRoot,
    sessionId,
    sessionDir,
    transcriptPath: fixedPath,
    setInterval: setIntervalFn = setInterval,
    clearInterval: clearIntervalFn = clearInterval
  } = options;

  const root = projectsRoot ?? (homeDir ? join(homeDir, ".claude", "projects") : undefined);
  // Ignore transcripts from earlier sessions so we don't lock onto a stale file
  // before Claude has created THIS session's transcript.
  const minMtime = startedAt > 0 ? startedAt - MTIME_SKEW_MS : 0;

  // Preferred resolution: pin to the exact transcript this session's hook reported
  // (via the session->transcript link). Only when no session identity is available
  // (e.g. hooks off, or older tests) do we fall back to the newest-by-mtime guess —
  // which is unsafe with multiple concurrent sessions in one folder. In production
  // the watcher only runs with hooks on, so the link path is always used.
  const useLink = Boolean(sessionId && sessionDir);

  let transcriptPath = fixedPath;
  let offset = 0;
  let carry = "";

  const tick = () => {
    try {
      if (!transcriptPath) {
        transcriptPath = useLink
          ? resolveLinkedTranscript(sessionDir, sessionId)
          : discoverTranscript(root, cwd, minMtime);
        if (!transcriptPath) {
          return;
        }
        // Begin tailing from the current end so we don't replay old denials
        // from a resumed session.
        offset = safeSize(transcriptPath);
        return;
      }

      const size = safeSize(transcriptPath);
      if (size <= offset) {
        // File truncated/rotated — reset so we don't read stale bytes.
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

      for (const event of parseTranscriptLines(lines)) {
        if (event.type === "tool_denied") {
          onDenial(event);
        } else if (event.type === "interrupted") {
          onInterrupt(event);
        }
      }
    } catch {
      // best-effort: a transcript-format surprise must never crash the wrapper
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
    // Exposed so tests can drive ticks deterministically.
    _tick: tick
  };
}

// Resolve the transcript this session's hook bound itself to. Returns undefined
// until the link exists and points at a real file, so before the first hook fires
// the watcher simply idles (there is nothing to interrupt yet) rather than
// guessing a file that might belong to another session.
function resolveLinkedTranscript(sessionDir, sessionId) {
  const linked = readSessionTranscriptLink({ sessionDir, sessionId });
  if (!linked || !existsSync(linked)) {
    return undefined;
  }
  return linked;
}

export function discoverTranscript(root, cwd, minMtime = 0) {
  if (!root || !existsSync(root)) {
    return undefined;
  }

  // Match the project dir case-insensitively — Claude's sanitized name can differ
  // in case from the live cwd (e.g. "AI" vs "ai" on case-insensitive filesystems).
  // Fall back to all project dirs only if nothing matches.
  const target = claudeProjectDirName(cwd).toLowerCase();
  const allDirs = listDirs(root);
  const matched = allDirs.filter((dir) => basename(dir).toLowerCase() === target);
  const dirs = matched.length > 0 ? matched : allDirs;

  let newest;
  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }
      const full = join(dir, file);
      const mtime = safeMtime(full);
      // Skip transcripts older than the current session start.
      if (mtime < minMtime) {
        continue;
      }
      if (!newest || mtime > newest.mtime) {
        newest = { full, mtime };
      }
    }
  }

  return newest?.full;
}

function listDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
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
