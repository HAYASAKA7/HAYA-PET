import { mapAiStateToPetAction } from "../../pet-core/src/atlas.js";

// Sessions that are done — removed from the active bubble list.
const TERMINAL_STATES = new Set(["exited", "success"]);

// States that should NOT drive a looping stable action. success/exited are
// terminal; failed is a timed reaction (a stray error must not pin the pet on
// the "failed" animation forever).
const NON_STABLE_STATES = new Set(["exited", "success", "failed"]);

// States that play a one-shot reaction exactly once when first entered.
const ONE_SHOT_BY_STATE = Object.freeze({
  success: "jumping",
  failed: "failed"
});

// Active-work states. Transitioning from one of these to idle means a turn
// finished, which plays a "done" reaction (the session stays alive/idle).
const WORKING_STATES = new Set(["thinking", "running_tool", "editing_files", "reviewing", "compacting"]);

// Pure resolver for the global pet's stable action and one-shot reactions from
// the current session bubbles. Tracks the previous per-session state so success
// jumps / failure reactions fire once, then the pet settles to the most urgent
// ongoing work, or idle when nothing is active.
export function resolveCompanionPetState({ bubbles = [], prioritySessionId, previousStates = {} } = {}) {
  const oneShots = [];
  const nextStates = {};

  for (const bubble of bubbles) {
    nextStates[bubble.sessionId] = bubble.state;
    const previous = previousStates[bubble.sessionId];
    const reaction = ONE_SHOT_BY_STATE[bubble.state];

    if (reaction && previous !== bubble.state) {
      oneShots.push(reaction);
    } else if (bubble.state === "idle" && WORKING_STATES.has(previous)) {
      // A turn just finished (work went quiet) — celebrate, then settle to idle.
      oneShots.push("jumping");
    }
  }

  const activeBubbles = bubbles.filter((bubble) => !TERMINAL_STATES.has(bubble.state));
  const drivable = activeBubbles.filter((bubble) => !NON_STABLE_STATES.has(bubble.state));
  const priority = drivable.find((bubble) => bubble.sessionId === prioritySessionId) ?? drivable[0];
  const stableAction = priority ? safeAction(priority.state) : "idle";

  return { stableAction, oneShots, activeBubbles, nextStates };
}

function safeAction(state) {
  try {
    return mapAiStateToPetAction(state);
  } catch {
    return "idle";
  }
}
