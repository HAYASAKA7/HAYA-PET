import { getClientRules, matchAiState } from "./heuristics.js";

// Confidence is intentionally moderate: PTY output heuristics are best-effort
// and lower precedence than official hooks or client state files (plan §25).
const DEFAULT_CONFIDENCE = 0.7;
const SUMMARY_MAX_LENGTH = 120;

// Level 2 PTY observer core (product plan section 6/24). Pure and stream-free:
// callers feed output chunks (from a real PTY/pipe) and receive debounced state
// change events. It never echoes raw output anywhere — only derived state and a
// short trimmed summary line.
export function createOutputObserver({ clientId, rules, onState, now = Date.now, confidence = DEFAULT_CONFIDENCE } = {}) {
  if (typeof onState !== "function") {
    throw new TypeError("onState must be a function");
  }

  const resolvedRules = rules ?? getClientRules(clientId);
  let buffer = "";
  let currentState;

  function handleLine(line) {
    const state = matchAiState(line, resolvedRules);
    if (!state || state === currentState) {
      return;
    }

    currentState = state;
    onState({
      state,
      summary: summarize(line),
      confidence,
      source: "pty_output",
      updatedAt: now()
    });
  }

  return {
    push(chunk) {
      buffer += String(chunk);

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }

      return currentState;
    },

    flush() {
      if (buffer.trim() !== "") {
        handleLine(buffer);
      }
      buffer = "";
      return currentState;
    },

    getState() {
      return currentState;
    },

    reset() {
      buffer = "";
      currentState = undefined;
    }
  };
}

function summarize(line) {
  return line.trim().slice(0, SUMMARY_MAX_LENGTH);
}
