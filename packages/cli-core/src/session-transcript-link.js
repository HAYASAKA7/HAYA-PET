// Records which transcript file belongs to which haya-pet session, so a wrapper's
// transcript watcher can tail ITS OWN session's transcript instead of guessing
// "the newest .jsonl in the project dir".
//
// Why this exists: two Claude Code sessions running in the same folder share one
// project dir (~/.claude/projects/<sanitized-cwd>/), each with its own UUID file.
// Picking newest-by-mtime can bind a watcher to a DIFFERENT concurrent session's
// transcript — so an interrupt (or denial) in session A leaks onto idle session B.
// The only ground-truth source of a session's transcript path is the Claude hook
// payload (`transcript_path` on stdin), which the `haya-pet state` reporter sees.
// The reporter writes the path here (keyed by HAYA_PET_SESSION_ID); the wrapper's
// watcher reads it to pin to the exact file.
//
// Local-only and best-effort: every operation swallows errors so it can never
// break a hook or the wrapped command, and nothing here is ever sent off-device.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Session ids are our own (`sess_<uuid>`), but sanitize defensively so the value
// can never escape the sessions dir or produce an invalid filename.
function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function sessionLinkPath(sessionDir, sessionId) {
  return join(sessionDir, `${sanitizeSessionId(sessionId)}.json`);
}

export function writeSessionTranscriptLink(options = {}, dependencies = {}) {
  const { sessionDir, sessionId, transcriptPath } = options;
  if (!sessionDir || !sessionId || typeof transcriptPath !== "string" || transcriptPath === "") {
    return false;
  }
  const mkdir = dependencies.mkdirSync ?? mkdirSync;
  const write = dependencies.writeFileSync ?? writeFileSync;
  try {
    mkdir(sessionDir, { recursive: true });
    write(sessionLinkPath(sessionDir, sessionId), JSON.stringify({ transcriptPath }), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readSessionTranscriptLink(options = {}, dependencies = {}) {
  const { sessionDir, sessionId } = options;
  if (!sessionDir || !sessionId) {
    return undefined;
  }
  const read = dependencies.readFileSync ?? readFileSync;
  try {
    const parsed = JSON.parse(read(sessionLinkPath(sessionDir, sessionId), "utf8"));
    return typeof parsed?.transcriptPath === "string" && parsed.transcriptPath !== ""
      ? parsed.transcriptPath
      : undefined;
  } catch {
    return undefined;
  }
}

export function removeSessionTranscriptLink(options = {}, dependencies = {}) {
  const { sessionDir, sessionId } = options;
  if (!sessionDir || !sessionId) {
    return;
  }
  const rm = dependencies.rmSync ?? rmSync;
  try {
    rm(sessionLinkPath(sessionDir, sessionId), { force: true });
  } catch {
    // best-effort cleanup; a stale link is harmless (session ids are unique per run)
  }
}
