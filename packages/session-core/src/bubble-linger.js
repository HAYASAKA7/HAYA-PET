// When an AI session's process finishes, its bubble should not vanish instantly
// — the user wants to glimpse the final outcome (a green check or a red cross).
// This pure resolver keeps an ended bubble visible for a short linger window,
// then hides it, while the registry keeps the session around a little longer.
//
// It is stateless across calls: the caller threads `lingerState` (a map of
// sessionId -> the timestamp the session was FIRST seen ended) back in each
// time, and re-renders once at `nextWakeMs` so the bubble disappears on schedule
// even if no new session event arrives.

// Process-finished states. A turn merely going quiet is "idle" (still alive) and
// is NOT included here, so live sessions never linger-out.
export const ENDED_STATES = new Set(["exited", "success", "failed"]);

const DEFAULT_LINGER_MS = 2000;

export function resolveVisibleBubbles({ bubbles = [], now = Date.now(), lingerState = {}, lingerMs = DEFAULT_LINGER_MS } = {}) {
  const visible = [];
  const nextLingerState = {};
  let nextWakeMs = Infinity;

  for (const bubble of bubbles) {
    if (!ENDED_STATES.has(bubble.state)) {
      visible.push(bubble);
      continue;
    }

    // Anchor the clock to the first ended state we saw, so a follow-up message
    // (success -> exited) does not restart the countdown.
    const since = lingerState[bubble.sessionId] ?? now;
    nextLingerState[bubble.sessionId] = since;

    const remaining = lingerMs - (now - since);
    if (remaining > 0) {
      visible.push(bubble);
      nextWakeMs = Math.min(nextWakeMs, remaining);
    }
    // remaining <= 0 -> hidden, but kept in nextLingerState so a re-appearing
    // payload (registry still holds the exited session) does not flash it back.
  }

  return {
    visible,
    lingerState: nextLingerState,
    nextWakeMs: Number.isFinite(nextWakeMs) ? nextWakeMs : undefined
  };
}
