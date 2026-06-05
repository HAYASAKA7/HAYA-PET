import { isAiClientState } from "../../protocol/src/messages.js";

// Generic regex rules from the product plan (section 35). Patterns are matched
// case-insensitively against a single line of client output.
export const DEFAULT_GENERIC_RULES = Object.freeze({
  waiting_approval: ["approve", "permission", "continue\\?", "allow"],
  waiting_user: ["\\? for", "press enter", "type your", "your input"],
  running_tool: ["running", "executing", "\\$ "],
  failed: ["error", "failed", "exception", "traceback"],
  reviewing: ["review", "diff", "summary"]
});

const CLIENT_RULES = Object.freeze({
  codex: Object.freeze({
    ...DEFAULT_GENERIC_RULES,
    editing_files: ["applying patch", "editing", "writing file", "apply_patch"],
    waiting_approval: ["approve", "permission", "allow command", "run command\\?"]
  }),
  "claude-code": Object.freeze({
    ...DEFAULT_GENERIC_RULES,
    editing_files: ["edit ", "writing to", "applying edit"],
    running_tool: ["running", "executing", "bash", "\\$ "],
    waiting_approval: ["permission", "do you want to proceed", "allow"],
    waiting_user: ["press enter", "your input", "human:"]
  }),
  antigravity: Object.freeze({
    ...DEFAULT_GENERIC_RULES,
    thinking: ["generating", "thinking"]
  })
});

// Most-urgent-first precedence so a line matching several categories resolves
// to the state the user most needs to see (mirrors the session priority model).
const MATCH_PRECEDENCE = Object.freeze([
  "waiting_approval",
  "waiting_user",
  "failed",
  "editing_files",
  "running_tool",
  "reviewing",
  "compacting",
  "thinking",
  "success",
  "idle"
]);

export function getClientRules(clientId) {
  return CLIENT_RULES[clientId] ?? DEFAULT_GENERIC_RULES;
}

export function matchAiState(text, rules = DEFAULT_GENERIC_RULES) {
  if (typeof text !== "string" || text === "") {
    return undefined;
  }

  const compiled = compileRules(rules);

  for (const state of MATCH_PRECEDENCE) {
    const regexes = compiled[state];
    if (!regexes) {
      continue;
    }

    if (regexes.some((regex) => regex.test(text))) {
      return state;
    }
  }

  return undefined;
}

export function compileRules(rules) {
  const compiled = {};

  if (!isPlainObject(rules)) {
    return compiled;
  }

  for (const [state, patterns] of Object.entries(rules)) {
    if (!isAiClientState(state) || !Array.isArray(patterns)) {
      continue;
    }

    const regexes = [];
    for (const pattern of patterns) {
      const regex = safeCompile(pattern);
      if (regex) {
        regexes.push(regex);
      }
    }

    if (regexes.length > 0) {
      compiled[state] = regexes;
    }
  }

  return compiled;
}

function safeCompile(pattern) {
  if (typeof pattern !== "string") {
    return undefined;
  }

  try {
    return new RegExp(pattern, "i");
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
