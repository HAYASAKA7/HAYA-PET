import { mapAiStateToPetAction } from "../../pet-core/src/atlas.js";
import { buildSessionSummary, buildStatusLabel, formatElapsed } from "./summaries.js";

// Collapses the full AI-state vocabulary into the four progress kinds the
// bubble panel renders: a spinning "working" circle, a "done" check mark (held
// until the next turn refreshes it), a yellow "attention" cue when the session
// needs the user, and a red "failed" cross. Unknown states fall back to a
// neutral "idle" dot rather than guessing.
const STATUS_KIND_BY_STATE = Object.freeze({
  thinking: "working",
  running_tool: "working",
  editing_files: "working",
  reviewing: "working",
  compacting: "working",
  waiting_user: "attention",
  waiting_approval: "attention",
  stale: "attention",
  failed: "failed",
  // An interrupt shows the same red ✕ as a failure, but it is a live (non-ended)
  // state — see bubble-linger ENDED_STATES — so the bubble stays put.
  interrupted: "failed",
  idle: "done",
  success: "done",
  exited: "done"
});

export function resolveBubbleStatusKind(state) {
  return STATUS_KIND_BY_STATE[state] ?? "idle";
}

export function buildBubbleView(session, now = Date.now(), options = {}) {
  const elapsedMs = Math.max(0, numeric(now) - numeric(session.startedAt));

  return {
    sessionId: session.sessionId,
    clientId: session.clientId,
    clientName: session.clientDisplayName ?? session.clientId,
    projectName: session.projectName,
    state: session.state,
    statusLabel: buildStatusLabel(session.state),
    statusKind: resolveBubbleStatusKind(session.state),
    summary: buildSessionSummary(session),
    petAction: safePetAction(session.state),
    elapsedMs,
    elapsedLabel: formatElapsed(elapsedMs),
    selected: options.selectedSessionId === session.sessionId
  };
}

export function buildBubbleViews(sessions, now = Date.now(), options = {}) {
  if (!Array.isArray(sessions)) {
    throw new TypeError("sessions must be an array");
  }

  return sessions
    .filter(Boolean)
    .slice()
    .sort(compareByConnectTime)
    .map((session) => buildBubbleView(session, now, options));
}

// Bubbles stack by connect time — the newest session on top, the first one at
// the bottom — and never reshuffle while sessions are in progress. State
// urgency only drives the collapsed-folder dot and the pet animation, not the
// list order.
function compareByConnectTime(left, right) {
  const startedDelta = numeric(right.startedAt) - numeric(left.startedAt);
  if (startedDelta !== 0) {
    return startedDelta;
  }

  return String(left.sessionId).localeCompare(String(right.sessionId));
}

function safePetAction(state) {
  try {
    return mapAiStateToPetAction(state);
  } catch {
    return "idle";
  }
}

function numeric(value) {
  return Number.isFinite(value) ? value : 0;
}
