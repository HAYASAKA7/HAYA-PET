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
