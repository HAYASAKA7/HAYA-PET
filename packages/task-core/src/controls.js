// Task control buttons (product plan section 23). The UI must hide or disable
// any control the selected adapter cannot safely support.
export const TASK_CONTROL_IDS = Object.freeze([
  "focus_terminal",
  "open_full",
  "reply",
  "approve",
  "deny",
  "continue",
  "pause",
  "resume",
  "stop",
  "restart",
  "hide"
]);

const CONTROL_LABELS = Object.freeze({
  focus_terminal: "Focus Terminal",
  open_full: "Open Full Session",
  reply: "Reply",
  approve: "Approve",
  deny: "Deny",
  continue: "Continue",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  restart: "Restart",
  hide: "Hide"
});

export function resolveTaskControls(capabilities = {}, status) {
  const hasPendingApproval = status === "waiting_approval";
  const canReply = capabilities.canReply !== undefined && capabilities.canReply !== "unsupported";
  const canApprove = capabilities.canApprove !== undefined && capabilities.canApprove !== "unsupported";

  const enabledById = {
    focus_terminal: Boolean(capabilities.canFocusTerminal),
    open_full: Boolean(capabilities.canOpenTranscript),
    reply: canReply,
    approve: canApprove && hasPendingApproval,
    deny: canApprove && hasPendingApproval,
    continue: Boolean(capabilities.canResume),
    pause: Boolean(capabilities.canPause),
    resume: Boolean(capabilities.canResume),
    stop: Boolean(capabilities.canStop),
    restart: Boolean(capabilities.canStop),
    hide: true
  };

  return TASK_CONTROL_IDS.map((id) => ({
    id,
    label: CONTROL_LABELS[id],
    enabled: enabledById[id]
  }));
}

export function listEnabledControls(capabilities, status) {
  return resolveTaskControls(capabilities, status)
    .filter((control) => control.enabled)
    .map((control) => control.id);
}
