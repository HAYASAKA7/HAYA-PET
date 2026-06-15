const STATUS_LABELS = Object.freeze({
  idle: "Idle",
  thinking: "Thinking",
  running_tool: "Running tools",
  editing_files: "Editing files",
  waiting_user: "Waiting for you",
  waiting_approval: "Waiting for approval",
  reviewing: "Reviewing",
  compacting: "Compacting context",
  failed: "Failed",
  interrupted: "Interrupted",
  success: "Done",
  stale: "Stale",
  exited: "Exited"
});

export function buildStatusLabel(state) {
  return STATUS_LABELS[state] ?? humanize(state);
}

export function buildSessionSummary(session) {
  if (session && typeof session.summary === "string" && session.summary.trim() !== "") {
    return session.summary;
  }

  return buildStatusLabel(session?.state);
}

// Compacts a project name for the session bubble title, which sits beside the
// (always-full) client name in a narrow overlay. Names up to `maxLength`
// characters show whole; longer ones are cut to `maxLength` and marked with an
// ellipsis. The full name is kept elsewhere on the view model for a tooltip.
const DEFAULT_PROJECT_NAME_LENGTH = 10;

export function truncateProjectName(name, maxLength = DEFAULT_PROJECT_NAME_LENGTH) {
  const text = typeof name === "string" ? name : "";
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return `${hours}h ${remainderMinutes}m`;
}

function humanize(value) {
  if (typeof value !== "string" || value === "") {
    return "Unknown";
  }

  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
