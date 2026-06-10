// Pure parser for Codex session JSONL records. This is the L3 fallback for live
// tool activity because Codex PreToolUse hooks may not fire in some builds, while
// the session transcript still records every tool call and tool result.

const EDIT_TOOLS = new Set(["apply_patch"]);

export function parseCodexTranscriptLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (entry?.type !== "response_item") {
    return undefined;
  }

  const payload = entry.payload;
  if (!payload || typeof payload !== "object") {
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

export function parseCodexTranscriptLines(lines) {
  const events = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.trim() === "") {
      continue;
    }
    const event = parseCodexTranscriptLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
