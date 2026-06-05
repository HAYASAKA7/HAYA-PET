import { mapAiStateToPetAction } from "../../pet-core/src/atlas.js";

export const TASK_STATUSES = Object.freeze([
  "starting",
  "thinking",
  "running",
  "running_command",
  "editing_files",
  "searching",
  "waiting_user",
  "waiting_approval",
  "reviewing",
  "compacting",
  "blocked",
  "failed",
  "completed",
  "paused",
  "stopped",
  "stale",
  "exited"
]);

const TASK_STATUS_SET = new Set(TASK_STATUSES);

const TASK_STATUS_TO_AI_STATE = Object.freeze({
  starting: "thinking",
  thinking: "thinking",
  running: "running_tool",
  running_command: "running_tool",
  editing_files: "editing_files",
  searching: "running_tool",
  waiting_user: "waiting_user",
  waiting_approval: "waiting_approval",
  reviewing: "reviewing",
  compacting: "compacting",
  blocked: "waiting_user",
  failed: "failed",
  completed: "success",
  paused: "idle",
  stopped: "exited",
  stale: "stale",
  exited: "exited"
});

const TASK_STATUS_PILLS = Object.freeze({
  starting: "Starting",
  thinking: "Thinking",
  running: "Running",
  running_command: "Running command",
  editing_files: "Editing files",
  searching: "Searching",
  waiting_user: "Waiting for you",
  waiting_approval: "Waiting for approval",
  reviewing: "Reviewing",
  compacting: "Compacting context",
  blocked: "Blocked",
  failed: "Failed",
  completed: "Completed",
  paused: "Paused",
  stopped: "Stopped",
  stale: "Stale",
  exited: "Exited"
});

export function isTaskStatus(value) {
  return TASK_STATUS_SET.has(value);
}

export function mapTaskStatusToAiState(status) {
  const aiState = TASK_STATUS_TO_AI_STATE[status];
  if (!aiState) {
    throw new Error(`Unknown task status: ${status}`);
  }

  return aiState;
}

export function mapTaskStatusToPetAction(status) {
  return mapAiStateToPetAction(mapTaskStatusToAiState(status));
}

export function buildTaskStatusPill(status) {
  return TASK_STATUS_PILLS[status] ?? humanize(status);
}

function humanize(value) {
  if (typeof value !== "string" || value === "") {
    return "Unknown";
  }

  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
