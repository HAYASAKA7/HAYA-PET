// Pure parser for Codex guardian-review rollouts. When `approvals_reviewer` is
// `auto_review` (legacy alias `guardian_subagent`, the TUI's "Approve for me"),
// Codex routes approval requests to a guardian subagent instead of prompting the
// user — the PermissionRequest hook still fires at request creation, but the
// human approval UI never appears. The only persisted trace of the review is a
// separate "guardian trunk" rollout under ~/.codex/sessions whose session_meta
// carries source.subagent.other == "guardian" and parent_thread_id == the main
// thread; each review is one turn there (task_started → task_complete with the
// verdict JSON in last_agent_message). Verified against codex-cli 0.139.0
// (codex-rs guardian/review_session.rs; rollout/src/policy.rs excludes the
// GuardianAssessment events themselves from persistence).

// Classify a rollout's first JSONL line (the session_meta record) so watchers
// can tell main sessions, guardian review sessions, and other subagents apart.
export function classifyCodexSessionMeta(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (entry?.type !== "session_meta") {
    return undefined;
  }

  const payload = entry.payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const threadId = typeof payload.id === "string" ? payload.id : undefined;
  const parentThreadId =
    typeof payload.parent_thread_id === "string" ? payload.parent_thread_id : undefined;

  return { kind: resolveSessionKind(payload), threadId, parentThreadId };
}

function resolveSessionKind(payload) {
  const subagentSource =
    typeof payload.source === "object" && payload.source !== null
      ? payload.source.subagent
      : undefined;

  if (typeof subagentSource === "object" && subagentSource !== null) {
    if (subagentSource.other === "guardian") {
      return "guardian";
    }
    return "subagent";
  }

  if (payload.thread_source === "subagent") {
    return "subagent";
  }

  return "main";
}

// Parse one guardian-trunk JSONL line into a review lifecycle event. Each review
// turn yields task_started (the guardian began assessing an approval request)
// and task_complete (verdict in last_agent_message: `{"outcome":"allow"|"deny"}`,
// optionally with risk_level/rationale). An unreadable verdict maps to
// outcome: undefined so callers can leave the pet state untouched (safe: the
// existing waiting cue stays up rather than being cleared on a guess).
export function parseGuardianTranscriptLine(line, options = {}) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (entry?.type !== "event_msg") {
    return undefined;
  }

  // Same replay guard as the main transcript parser: skip records from before
  // the current session, keep records without a parseable timestamp.
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

  if (payload.type === "task_started") {
    return { type: "review_started" };
  }

  if (payload.type === "task_complete") {
    return { type: "review_finished", outcome: parseVerdictOutcome(payload.last_agent_message) };
  }

  return undefined;
}

function parseVerdictOutcome(lastAgentMessage) {
  if (typeof lastAgentMessage !== "string") {
    return undefined;
  }

  let verdict;
  try {
    verdict = JSON.parse(lastAgentMessage);
  } catch {
    return undefined;
  }

  const outcome = verdict?.outcome;
  return outcome === "allow" || outcome === "deny" ? outcome : undefined;
}

export function parseGuardianTranscriptLines(lines, options = {}) {
  const events = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.trim() === "") {
      continue;
    }
    const event = parseGuardianTranscriptLine(line, options);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
