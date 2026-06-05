const PRIORITY_RANKS = Object.freeze({
  waiting_approval: 1,
  waiting_user: 2,
  failed: 3,
  running_tool: 4,
  editing_files: 4,
  thinking: 5,
  reviewing: 5,
  compacting: 5,
  success: 6,
  stale: 6,
  idle: 7,
  exited: 8
});

export function getSessionPriorityRank(session) {
  return PRIORITY_RANKS[session.state] ?? 6;
}

export function selectPrioritySession(sessions, options = {}) {
  if (!Array.isArray(sessions)) {
    throw new TypeError("sessions must be an array");
  }

  const candidates = sessions.filter(Boolean);
  if (candidates.length === 0) {
    return undefined;
  }

  if (options.pinnedSessionId) {
    const pinnedSession = candidates.find((session) => session.sessionId === options.pinnedSessionId);
    if (pinnedSession) {
      return pinnedSession;
    }
  }

  return candidates.slice().sort(compareSessionsByPriority)[0];
}

function compareSessionsByPriority(left, right) {
  const rankDelta = getSessionPriorityRank(left) - getSessionPriorityRank(right);
  if (rankDelta !== 0) {
    return rankDelta;
  }

  const updatedDelta = numericTimestamp(right.updatedAt) - numericTimestamp(left.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return String(left.sessionId).localeCompare(String(right.sessionId));
}

function numericTimestamp(value) {
  return Number.isFinite(value) ? value : 0;
}
