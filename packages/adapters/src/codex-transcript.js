// Pure parser for Codex session JSONL records. This is the L3 fallback for live
// tool activity because Codex PreToolUse hooks may not fire in some builds, while
// the session transcript still records every tool call and tool result.

const EDIT_TOOLS = new Set(["apply_patch"]);

export function parseCodexTranscriptLine(line, options = {}) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  // Skip records from before the current session (used when replaying a
  // freshly-discovered transcript so an earlier session's events don't
  // masquerade as live activity). Records without a parseable timestamp are
  // kept — losing live events is worse than a rare stale one.
  const minTimestampMs = options.minTimestampMs ?? 0;
  if (minTimestampMs > 0 && typeof entry.timestamp === "string") {
    const timestampMs = Date.parse(entry.timestamp);
    if (Number.isFinite(timestampMs) && timestampMs < minTimestampMs) {
      return undefined;
    }
  }

  const payload = entry.payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  // The user pressing Esc aborts the turn. Codex fires no Stop hook on an abort,
  // so this event_msg is the only signal the turn ended by interruption — without
  // it the pet stays stuck on "thinking" until the stale sweep.
  if (entry.type === "event_msg" && payload.type === "turn_aborted") {
    return { type: "turn_aborted", reason: typeof payload.reason === "string" ? payload.reason : undefined };
  }

  if (entry.type !== "response_item") {
    return undefined;
  }

  if (payload.type === "function_call" || payload.type === "custom_tool_call") {
    const toolName = typeof payload.name === "string" ? payload.name : undefined;
    const toolCallId = typeof payload.call_id === "string" ? payload.call_id : undefined;
    if (!toolName || !toolCallId) {
      return undefined;
    }
    return {
      type: "tool_started",
      toolCallId,
      toolName,
      state: EDIT_TOOLS.has(toolName) ? "editing_files" : "running_tool"
    };
  }

  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    const toolCallId = typeof payload.call_id === "string" ? payload.call_id : undefined;
    if (!toolCallId) {
      return undefined;
    }
    return { type: "tool_finished", toolCallId };
  }

  return undefined;
}

export function parseCodexTranscriptLines(lines, options = {}) {
  const events = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.trim() === "") {
      continue;
    }
    const event = parseCodexTranscriptLine(line, options);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
