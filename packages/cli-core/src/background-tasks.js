// Pure helpers for the Claude "subagent still running at Stop" cue.
//
// When the main Claude agent ends its turn it fires `Stop`, whose payload carries
// a `background_tasks` array — a live snapshot of work still running at that
// instant (the hooks docs omit this field; it was verified against live traces).
// If a backgrounded *subagent* is still running, the main agent is paused but real
// work continues, so the pet keeps a "working" cue with a message rather than
// dropping to idle. When that subagent finishes, Claude fires `Stop` AGAIN with an
// empty `background_tasks`, which naturally clears the cue — so this needs no
// timers, no persisted state, and no subagent-event wiring. The only check is at
// the main agent's Stop, exactly as scoped.
//
// Scoped to `type: "subagent"` ONLY. Background *shells* are intentionally
// excluded: their completion isn't reliably observable here, and a status we
// cannot retract is worse than none.

// A single, fixed cue message. The user only wants to know that a subagent is
// still working after the main agent paused — NOT which one or how many.
const SUBAGENT_RUNNING_SUMMARY = "Subagent running";

// Parse a Claude hook payload (JSON on stdin) and return its background_tasks
// array. Defensive: any non-JSON / missing / wrong-typed input yields [].
export function extractBackgroundTasks(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.background_tasks) ? parsed.background_tasks : [];
  } catch {
    return [];
  }
}

// The still-running *subagent* tasks. Shells and finished tasks are dropped.
export function runningSubagentTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return [];
  }
  return tasks.filter((task) => task && task.type === "subagent" && task.status === "running");
}

// A fixed cue message when any subagent is still running, or undefined when none
// are (the caller then leaves the reported state untouched). Intentionally not
// detailed — just "a subagent is still working".
export function summarizeSubagentTasks(tasks) {
  return runningSubagentTasks(tasks).length > 0 ? SUBAGENT_RUNNING_SUMMARY : undefined;
}

// Decide the effective state/summary for a reported state given the Stop payload's
// background_tasks. Only an `idle` report with a running subagent is upgraded to a
// working cue; everything else passes through unchanged — including the follow-up
// Stop whose background_tasks is empty, which is what retracts the cue.
export function applySubagentBackgroundTasks({ state, summary, backgroundTasks }) {
  if (state !== "idle") {
    return { state, summary };
  }
  const message = summarizeSubagentTasks(backgroundTasks);
  if (!message) {
    return { state, summary };
  }
  return { state: "running_tool", summary: message };
}
