export const AI_CLIENT_STATES = Object.freeze([
  "idle",
  "thinking",
  "running_tool",
  "editing_files",
  "waiting_user",
  "waiting_approval",
  "reviewing",
  "compacting",
  "failed",
  "success",
  "stale",
  "exited"
]);

export const STATE_SOURCES = Object.freeze([
  "wrapper",
  "pty_output",
  "client_log",
  "client_state",
  "official_plugin",
  "manual"
]);

export const PROTOCOL_MESSAGE_TYPES = Object.freeze([
  "register",
  "heartbeat",
  "state",
  "unregister"
]);

const AI_CLIENT_STATE_SET = new Set(AI_CLIENT_STATES);
const STATE_SOURCE_SET = new Set(STATE_SOURCES);
const MESSAGE_TYPE_SET = new Set(PROTOCOL_MESSAGE_TYPES);

export function isAiClientState(value) {
  return AI_CLIENT_STATE_SET.has(value);
}

export function isStateSource(value) {
  return STATE_SOURCE_SET.has(value);
}

export function validateProtocolMessage(message) {
  const errors = [];

  if (!isPlainObject(message)) {
    return { ok: false, errors: ["message must be an object"] };
  }

  if (!MESSAGE_TYPE_SET.has(message.type)) {
    return {
      ok: false,
      errors: [`Unknown protocol message type: ${String(message.type)}`]
    };
  }

  requireNonEmptyString(errors, message.sessionId, "sessionId");

  switch (message.type) {
    case "register":
      validateRegisterMessage(errors, message);
      break;
    case "heartbeat":
      requireFiniteNumber(errors, message.updatedAt, "updatedAt");
      break;
    case "state":
      validateStateMessage(errors, message);
      break;
    case "unregister":
      validateUnregisterMessage(errors, message);
      break;
  }

  return { ok: errors.length === 0, errors };
}

export function assertProtocolMessage(message) {
  const result = validateProtocolMessage(message);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }

  return message;
}

function validateRegisterMessage(errors, message) {
  requireNonEmptyString(errors, message.clientId, "clientId");
  requireNonEmptyString(errors, message.clientDisplayName, "clientDisplayName");
  requirePositiveInteger(errors, message.pid, "pid");

  if (message.terminalPid !== undefined) {
    requirePositiveInteger(errors, message.terminalPid, "terminalPid");
  }

  requireNonEmptyString(errors, message.cwd, "cwd");
  requireNonEmptyString(errors, message.projectName, "projectName");
  requireFiniteNumber(errors, message.startedAt, "startedAt");
}

function validateStateMessage(errors, message) {
  if (!isAiClientState(message.state)) {
    errors.push(`state must be one of: ${AI_CLIENT_STATES.join(", ")}`);
  }

  if (!isStateSource(message.source)) {
    errors.push(`source must be one of: ${STATE_SOURCES.join(", ")}`);
  }

  if (typeof message.summary !== "undefined" && typeof message.summary !== "string") {
    errors.push("summary must be a string when provided");
  }

  if (!Number.isFinite(message.confidence) || message.confidence < 0 || message.confidence > 1) {
    errors.push("confidence must be a number from 0 to 1");
  }

  requireFiniteNumber(errors, message.updatedAt, "updatedAt");
}

function validateUnregisterMessage(errors, message) {
  if (message.exitCode !== undefined && !Number.isInteger(message.exitCode)) {
    errors.push("exitCode must be an integer when provided");
  }

  requireFiniteNumber(errors, message.finishedAt, "finishedAt");
}

function requireNonEmptyString(errors, value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function requireFiniteNumber(errors, value, fieldName) {
  if (!Number.isFinite(value)) {
    errors.push(`${fieldName} must be a finite number`);
  }
}

function requirePositiveInteger(errors, value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${fieldName} must be a positive integer`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
