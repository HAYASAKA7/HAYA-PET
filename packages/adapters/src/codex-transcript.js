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

  if (entry.type === "event_msg") {
    // The user pressing Esc aborts the turn. Codex fires no Stop hook on an abort,
    // so this event_msg is the only signal the turn ended by interruption — without
    // it the pet stays stuck on "thinking" until the stale sweep.
    if (payload.type === "turn_aborted") {
      return { type: "turn_aborted", reason: typeof payload.reason === "string" ? payload.reason : undefined };
    }

    if (payload.type === "token_count") {
      const limitType = payload.rate_limits?.rate_limit_reached_type;
      if (typeof limitType === "string" && limitType.trim() !== "") {
        return { type: "usage_limit_reached", limitType: limitType.trim() };
      }
    }

    if (payload.type === "context_compacted") {
      return { type: "context_compacted" };
    }

    if (payload.type === "task_complete") {
      const hasFinalMessage = typeof payload.last_agent_message === "string" && payload.last_agent_message.trim() !== "";
      const sawFirstToken = Number.isFinite(payload.time_to_first_token_ms);
      if (!hasFinalMessage && !sawFirstToken) {
        return { type: "turn_failed", reason: "empty_response" };
      }
      return { type: "turn_complete" };
    }
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
  const parserState = options.parserState && typeof options.parserState === "object" ? options.parserState : {};
  for (const line of lines) {
    if (typeof line !== "string" || line.trim() === "") {
      continue;
    }
    const event = parseCodexTranscriptLine(line, options);
    if (!event) {
      continue;
    }

    if (event.type === "context_compacted") {
      parserState.afterContextCompacted = true;
      events.push(event);
      continue;
    }

    // Manual /compact writes context_compacted and then an empty task_complete.
    // PostCompact hooks already report the visible state, so this completion is
    // bookkeeping, not a provider/model failure.
    if (event.type === "turn_failed" && event.reason === "empty_response" && parserState.afterContextCompacted) {
      parserState.afterContextCompacted = false;
      continue;
    }

    if (event.type === "turn_complete" || event.type === "turn_aborted" || event.type === "usage_limit_reached") {
      parserState.afterContextCompacted = false;
    }
    events.push(event);
  }
  return events;
}
