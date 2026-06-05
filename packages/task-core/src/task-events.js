import { isStateSource } from "../../protocol/src/messages.js";
import { isTaskStatus } from "./task-status.js";

export const TASK_EVENT_TYPES = Object.freeze([
  "user_message",
  "assistant_message",
  "assistant_delta",
  "status_changed",
  "tool_started",
  "tool_output",
  "tool_finished",
  "file_changed",
  "diff_ready",
  "test_started",
  "test_finished",
  "approval_requested",
  "approval_resolved",
  "error",
  "summary",
  "task_completed"
]);

const TASK_EVENT_TYPE_SET = new Set(TASK_EVENT_TYPES);

export function isTaskEventType(value) {
  return TASK_EVENT_TYPE_SET.has(value);
}

export function normalizeTaskEvent(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["event must be an object"] };
  }

  const errors = [];

  requireNonEmptyString(errors, input.id, "id");
  requireNonEmptyString(errors, input.sessionId, "sessionId");

  if (!isTaskEventType(input.type)) {
    errors.push(`type must be one of: ${TASK_EVENT_TYPES.join(", ")}`);
  }

  if (!Number.isFinite(input.timestamp)) {
    errors.push("timestamp must be a finite number");
  }

  if (input.status !== undefined && !isTaskStatus(input.status)) {
    errors.push("status must be a valid task status when provided");
  }

  if (input.source !== undefined && !isStateSource(input.source)) {
    errors.push("source must be a valid state source when provided");
  }

  if (input.title !== undefined && typeof input.title !== "string") {
    errors.push("title must be a string when provided");
  }

  if (input.text !== undefined && typeof input.text !== "string") {
    errors.push("text must be a string when provided");
  }

  if (input.confidence !== undefined) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      errors.push("confidence must be a number from 0 to 1 when provided");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [], event: buildEvent(input) };
}

function buildEvent(input) {
  const event = {
    id: input.id,
    sessionId: input.sessionId,
    type: input.type,
    timestamp: input.timestamp
  };

  for (const field of ["title", "text", "status", "confidence", "source", "payload"]) {
    if (input[field] !== undefined) {
      event[field] = input[field];
    }
  }

  return event;
}

function requireNonEmptyString(errors, value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
