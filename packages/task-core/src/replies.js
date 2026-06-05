export function buildTaskInputRequest({ sessionId, inputId, text, createdAt }) {
  return {
    type: "task_input",
    sessionId,
    inputId,
    text,
    createdAt
  };
}

export function validateTaskInputRequest(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["task input request must be an object"] };
  }

  const errors = [];

  if (input.type !== "task_input") {
    errors.push('type must be "task_input"');
  }

  requireNonEmptyString(errors, input.sessionId, "sessionId");
  requireNonEmptyString(errors, input.inputId, "inputId");
  requireNonEmptyString(errors, input.text, "text");

  if (!Number.isFinite(input.createdAt)) {
    errors.push("createdAt must be a finite number");
  }

  return { ok: errors.length === 0, errors };
}

export function validateTaskInputResult(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["task input result must be an object"] };
  }

  const errors = [];

  if (input.type !== "task_input_result") {
    errors.push('type must be "task_input_result"');
  }

  requireNonEmptyString(errors, input.sessionId, "sessionId");
  requireNonEmptyString(errors, input.inputId, "inputId");

  if (typeof input.ok !== "boolean") {
    errors.push("ok must be a boolean");
  }

  if (input.error !== undefined && typeof input.error !== "string") {
    errors.push("error must be a string when provided");
  }

  return { ok: errors.length === 0, errors };
}

// Translate adapter reply capability into a safe UI mode. The reply button must
// never blindly type into a terminal when the adapter cannot verify the client
// is waiting for input (product plan section 21).
export function resolveReplyMode(capabilities = {}) {
  switch (capabilities.canReply) {
    case "supported":
      return "send";
    case "best_effort":
      return "best-effort";
    default:
      return "open-terminal";
  }
}

function requireNonEmptyString(errors, value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
