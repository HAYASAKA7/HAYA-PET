// Tails the Codex guardian-review trunk rollout and reports review lifecycle
// events. With `approvals_reviewer = auto_review` ("Approve for me"), Codex
// never shows the human approval UI for guardian-routed requests — the
// PermissionRequest hook fires at request creation, then a guardian subagent
// decides. No hook fires when the review starts or finishes and the
// GuardianAssessment events are not persisted to the main rollout, so the
// guardian's own rollout (one trunk per parent thread, one turn per review) is
// the only observable, event-backed signal. This watcher exists so the pet can
// show "reviewing" during the auto-review instead of a false "waiting for
// approval", without ever clearing a real pending approval on a guess.
import { join } from "node:path";
import {
  classifyCodexSessionMeta,
  parseGuardianTranscriptLines
} from "../../adapters/src/codex-guardian.js";
import { listJsonlFiles, readFirstLine, readRange, safeMtime, safeSize } from "./codex-rollout-fs.js";
import { readSessionTranscriptLink } from "./session-transcript-link.js";

const DEFAULT_POLL_MS = 700;
const MTIME_SKEW_MS = 2000;

export function watchCodexGuardianReviews(options = {}) {
  const {
    homeDir = process.env.USERPROFILE || process.env.HOME,
    cwd,
    startedAt = 0,
    onReviewEvent = () => {},
    pollIntervalMs = DEFAULT_POLL_MS,
    sessionsRoot,
    sessionId,
    sessionDir,
    setInterval: setIntervalFn = setInterval,
    clearInterval: clearIntervalFn = clearInterval
  } = options;

  const root = sessionsRoot ?? (homeDir ? join(homeDir, ".codex", "sessions") : undefined);
  const minMtime = startedAt > 0 ? startedAt - MTIME_SKEW_MS : 0;
  const expectedCwd = normalizePathForCompare(cwd);

  // session_meta classifications are immutable once written, so cache them by
  // path. A file with no complete first line yet is NOT cached — it is retried
  // on the next poll (the rollout may still be flushing).
  const metaByPath = new Map();
  let mainThreadId;
  let trunkPath;
  let offset = 0;
  let carry = "";

  const classify = (file) => {
    if (metaByPath.has(file)) {
      return metaByPath.get(file);
    }
    const firstLine = readFirstLine(file);
    if (firstLine === undefined) {
      return undefined;
    }
    const meta = classifyCodexSessionMeta(firstLine) ?? null;
    const sessionMeta = readSessionMeta(firstLine);
    const isFreshSession = sessionMeta && sessionMeta.startedAt >= minMtime;
    const isFreshResume =
      meta?.kind === "main" &&
      expectedCwd !== undefined &&
      normalizePathForCompare(sessionMeta?.cwd) === expectedCwd;
    if (meta && minMtime > 0 && !isFreshSession && !isFreshResume) {
      metaByPath.set(file, null);
      return null;
    }
    metaByPath.set(file, meta);
    return meta;
  };

  // Authoritative main thread id from the session->transcript link (the linked
  // rollout's session_meta.payload.id). Lets the guardian bind to OUR main thread
  // even when another session's main rollout has a newer mtime.
  const resolveLinkedMainThreadId = () => {
    if (!sessionId || !sessionDir) {
      return undefined;
    }
    const linked = readSessionTranscriptLink({ sessionDir, sessionId });
    if (!linked) {
      return undefined;
    }
    const firstLine = readFirstLine(linked);
    if (firstLine === undefined) {
      return undefined;
    }
    const meta = classifyCodexSessionMeta(firstLine);
    return meta?.kind === "main" ? meta.threadId : undefined;
  };

  const discoverTrunk = () => {
    // Prefer the linked main thread id; fall back to the newest main rollout by
    // mtime only when no link is available (older behavior, unsafe across
    // concurrent same-cwd sessions).
    if (!mainThreadId) {
      mainThreadId = resolveLinkedMainThreadId();
    }

    let newestMain;
    let newestTrunk;

    for (const file of listJsonlFiles(root)) {
      const mtime = safeMtime(file);
      if (mtime < minMtime) {
        continue;
      }
      const meta = classify(file);
      if (!meta) {
        continue;
      }

      if (meta.kind === "main" && meta.threadId && (!newestMain || mtime > newestMain.mtime)) {
        newestMain = { threadId: meta.threadId, mtime };
      }
      if (meta.kind === "guardian" && meta.parentThreadId && (!newestTrunk || mtime > newestTrunk.mtime)) {
        // Once our main thread id is known, only consider OUR trunk so a
        // concurrent session's (or collab subagent's) newer trunk cannot win.
        if (!mainThreadId || meta.parentThreadId === mainThreadId) {
          newestTrunk = { file, parentThreadId: meta.parentThreadId, mtime };
        }
      }
    }

    // The guardian trunk only appears at the first review, usually long after
    // the main rollout — bind the main thread first, then match the trunk to
    // it so another session's (or a collab subagent's) reviews are ignored.
    mainThreadId = mainThreadId ?? newestMain?.threadId;
    if (mainThreadId && newestTrunk?.parentThreadId === mainThreadId) {
      // Replay the trunk from the start: the first review is usually still in
      // progress when we find the file, and the per-record timestamp filter
      // keeps an earlier session's reviews from replaying as live events.
      trunkPath = newestTrunk.file;
      offset = 0;
      carry = "";
    }
  };

  const tick = () => {
    try {
      if (!trunkPath) {
        discoverTrunk();
        if (!trunkPath) {
          return;
        }
      }

      const size = safeSize(trunkPath);
      if (size <= offset) {
        if (size < offset) {
          offset = size;
          carry = "";
        }
        return;
      }

      const chunk = readRange(trunkPath, offset, size);
      offset = size;

      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";

      for (const event of parseGuardianTranscriptLines(lines, { minTimestampMs: startedAt })) {
        onReviewEvent(event);
      }
    } catch {
      // best-effort: rollout surprises must never crash the wrapper
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

function readSessionMeta(line) {
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
