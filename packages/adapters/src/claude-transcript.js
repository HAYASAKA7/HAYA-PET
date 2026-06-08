// Pure parser for Claude Code session transcript (JSONL) lines. The transcript
// is ground truth for what actually happened in a turn — in particular it records
// a `tool_result` for every tool call, including when the USER REJECTS a
// permission prompt (Claude fires no hook on a manual denial, so this is the only
// reliable signal that a pending approval was resolved by a denial).
//
// The transcript format is stable but undocumented, so every access is defensive.

// Marker phrases Claude writes into a rejected tool's result. Matched
// case-insensitively; kept broad so a wording tweak doesn't silently break us.
const REJECTION_MARKERS = Object.freeze([
  "user doesn't want to proceed",
  "user rejected",
  "tool use was rejected",
  "rejected the tool",
  "user has denied",
  "user chose not to"
]);

// Returns a resolution event for a single transcript line, or undefined.
// Currently we only surface denials — the approve path is already covered by the
// PostToolUse hook, and emitting on every result would race with it.
export function parseTranscriptLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content) {
    if (block?.type === "tool_result" && block.is_error === true) {
      const text = extractText(block.content).toLowerCase();
      if (REJECTION_MARKERS.some((marker) => text.includes(marker))) {
        return { type: "tool_denied", toolUseId: block.tool_use_id };
      }
    }
  }

  return undefined;
}

// Parse a batch of newly-appended lines, returning the resolution events found.
export function parseTranscriptLines(lines) {
  const events = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.trim() === "") {
      continue;
    }
    const event = parseTranscriptLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function extractText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join(" ");
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  return "";
}
