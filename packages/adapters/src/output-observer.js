import { getClientRules, matchAiState } from "./heuristics.js";

// Confidence is intentionally moderate: PTY output is best-effort and lower
// precedence than official hooks or client state files (plan §25).
const DEFAULT_CONFIDENCE = 0.6;
const SUMMARY_MAX_LENGTH = 120;
// Quiet window after which we assume the CLI stopped working (e.g. waiting for
// the user) and revert to idle.
const DEFAULT_IDLE_MS = 2000;
const DEFAULT_ACTIVE_STATE = "running_tool";

const defaultSetTimer = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
};
const defaultClearTimer = (id) => clearTimeout(id);

// Level 2 PTY observer (product plan section 6/24).
//
// Default mode is ACTIVITY-BASED, which is robust for rich TUIs (Claude Code,
// Codex) where output is full of ANSI/redraws and rarely contains tidy keywords:
//   - any visible output  -> "working" (running_tool)
//   - no output for idleMs -> idle
// It deliberately does NOT infer "failed" from output text — a stray "error" in
// normal content must not flip the pet to failed; real failures come from the
// process exit code in the wrapper.
//
// Opt in to keyword heuristics with `useHeuristics: true` to additionally detect
// specific states (e.g. waiting_approval) from recognizable lines.
export function createOutputObserver({
  clientId,
  rules,
  onState,
  now = Date.now,
  confidence = DEFAULT_CONFIDENCE,
  idleMs = DEFAULT_IDLE_MS,
  idleState = "idle",
  activeState = DEFAULT_ACTIVE_STATE,
  useHeuristics = false,
  setTimer = defaultSetTimer,
  clearTimer = defaultClearTimer
} = {}) {
  if (typeof onState !== "function") {
    throw new TypeError("onState must be a function");
  }

  const resolvedRules = rules ?? getClientRules(clientId);
  let buffer = "";
  let currentState;
  let idleTimer;

  function emit(state, summary) {
    currentState = state;
    onState({ state, summary, confidence, source: "pty_output", updatedAt: now() });
  }

  function cancelIdle() {
    if (idleTimer !== undefined) {
      clearTimer(idleTimer);
      idleTimer = undefined;
    }
  }

  function armIdle() {
    if (!idleMs) {
      return;
    }
    cancelIdle();
    idleTimer = setTimer(() => {
      idleTimer = undefined;
      if (currentState !== idleState) {
        emit(idleState, "no recent activity");
      }
    }, idleMs);
  }

  return {
    push(chunk) {
      const text = String(chunk);
      buffer += text;

      let matched = false;
      if (useHeuristics) {
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const state = matchAiState(line, resolvedRules);
          if (state) {
            matched = true;
            if (state !== currentState) {
              emit(state, summarize(line));
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      } else {
        // Activity mode: we don't classify lines, so drop completed ones to keep
        // the buffer bounded.
        const lastNewline = buffer.lastIndexOf("\n");
        if (lastNewline !== -1) {
          buffer = buffer.slice(lastNewline + 1);
        }
      }

      const hadOutput = /\S/.test(text);
      if (hadOutput) {
        if (!matched && currentState !== activeState) {
          emit(activeState, "working");
        }
        armIdle();
      }

      return currentState;
    },

    flush() {
      buffer = "";
      return currentState;
    },

    getState() {
      return currentState;
    },

    stop() {
      cancelIdle();
    },

    reset() {
      buffer = "";
      currentState = undefined;
      cancelIdle();
    }
  };
}

function summarize(line) {
  return line.trim().slice(0, SUMMARY_MAX_LENGTH);
}
