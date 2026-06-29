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

// Ellipsis truncation shared by the bubble's title and activity lines: text up
// to `maxLength` characters shows whole; longer text is cut to `maxLength` and
// marked with a trailing "...". Non-strings coerce to "". The full text is kept
// elsewhere on the view model for a hover tooltip.
function truncateWithEllipsis(text, maxLength) {
  const value = typeof text === "string" ? text : "";
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

// Compacts a project name for the session bubble title, which sits beside the
// (always-full) client name in a narrow overlay.
const DEFAULT_PROJECT_NAME_LENGTH = 10;

export function truncateProjectName(name, maxLength = DEFAULT_PROJECT_NAME_LENGTH) {
  return truncateWithEllipsis(name, maxLength);
}

// Compacts the activity/status line the same way, so a long status or tool-call
// summary can't stretch the bubble wider than its (already capped) title. The
// budget comfortably clears the longest built-in status label so those always
// show whole; only genuinely long custom summaries get the ellipsis.
const DEFAULT_SUMMARY_LENGTH = 32;

export function truncateSummary(text, maxLength = DEFAULT_SUMMARY_LENGTH) {
  return truncateWithEllipsis(text, maxLength);
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
