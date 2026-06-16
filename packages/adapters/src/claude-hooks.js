// Pure builders for Claude Code per-session hook settings. No I/O here — callers
// resolve paths and write the file. Each hook entry runs the `haya-pet state`
// reporter with a fixed state (and optional summary) baked into the command.

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const EDIT_TOOLS_MATCHER = EDIT_TOOLS.join("|");
// Negative lookahead: match any tool that is NOT one of the edit tools, so the
// two PreToolUse entries never both fire for the same tool.
const NON_EDIT_MATCHER = `^(?!(${EDIT_TOOLS_MATCHER})$).*`;

// The hook table. Each entry → one Claude hook that reports a fixed pet state.
// `matcher` (when present) filters the event: tool name for PreToolUse, or the
// notification type for Notification. `summary` is an optional short label that
// both shows in the bubble and identifies the event in HAYA_PET_HOOK_DEBUG logs.
//
// Notification is split by type: only `permission_prompt` means "waiting for
// approval"; `idle_prompt` (Claude sat idle waiting for input) means idle. Other
// notification types (auth_success, elicitation_*) are intentionally ignored.
//
// PermissionDenied / PostToolUseFailure / StopFailure are subscribed so the pet
// recovers from a denied or failed tool call — Claude fires no Stop on a denial,
// so without these the pet would stay on `waiting_approval` until the next turn.
const HOOK_TABLE = Object.freeze([
  { event: "UserPromptSubmit", state: "thinking" },
  { event: "PreToolUse", matcher: EDIT_TOOLS_MATCHER, state: "editing_files" },
  { event: "PreToolUse", matcher: NON_EDIT_MATCHER, state: "running_tool" },
  { event: "PostToolUse", state: "thinking" },
  { event: "PostToolUseFailure", state: "thinking", summary: "tool-failed" },
  // PermissionRequest fires the instant the dialog appears — earlier than the
  // permission_prompt Notification, so the "waiting for approval" cue is snappy.
  { event: "PermissionRequest", state: "waiting_approval" },
  { event: "Notification", matcher: "permission_prompt", state: "waiting_approval" },
  { event: "Notification", matcher: "idle_prompt", state: "idle", summary: "idle" },
  { event: "PermissionDenied", state: "idle", summary: "denied" },
  { event: "PreCompact", state: "compacting" },
  { event: "Stop", state: "idle" },
  { event: "StopFailure", state: "idle", summary: "stopped" }
]);

// Resolve the pet state for a Claude event. `detail` is the tool name for
// PreToolUse or the notification type for Notification. Exposed for testing and
// to keep the mapping logic in one place.
export function mapClaudeEventToState(event, detail) {
  if (event === "PreToolUse") {
    return EDIT_TOOLS.includes(detail) ? "editing_files" : "running_tool";
  }
  if (event === "Notification") {
    if (detail === "permission_prompt") return "waiting_approval";
    if (detail === "idle_prompt") return "idle";
    return undefined;
  }
  const entry = HOOK_TABLE.find((row) => row.event === event && row.matcher === undefined);
  return entry?.state;
}

export function buildClaudeHookSettings({ nodePath, cliPath }) {
  const command = (state, summary) => {
    const base = `${quote(nodePath)} ${quote(cliPath)} state ${state}`;
    return summary ? `${base} --summary ${summary}` : base;
  };

  const hooks = {};
  for (const row of HOOK_TABLE) {
    const hookEntry = { hooks: [{ type: "command", command: command(row.state, row.summary) }] };
    if (row.matcher !== undefined) {
      hookEntry.matcher = row.matcher;
    }
    (hooks[row.event] ??= []).push(hookEntry);
  }

  return { hooks };
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}
