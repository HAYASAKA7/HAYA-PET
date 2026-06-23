// The `haya-pet state` reporter. Invoked by client hooks (e.g. Claude Code) to
// push a live status into the daemon. It must NEVER throw or block a host CLI's
// hook, so every failure path resolves to a quiet { ok: false, reason }.
import { appendFileSync } from "node:fs";
import { createIpcClient as defaultCreateIpcClient } from "../../daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../platform-core/src/paths.js";
import { isAiClientState } from "../../protocol/src/messages.js";
import { DEADLINE, raceDeadline } from "./deadline.js";
import { writeSessionTranscriptLink } from "./session-transcript-link.js";
import { applySubagentBackgroundTasks, extractBackgroundTasks } from "./background-tasks.js";

// Hard ceiling on the whole connect→send→close interaction. The reporter is a
// child process of the wrapped AI client, and the client may wait for its hook
// children at shutdown (observed: Codex /quit stuck on its goodbye while an
// orphaned reporter hung forever on a pipe await). Hitting the deadline only
// loses one best-effort status update; hanging loses the user's terminal.
const REPORT_DEADLINE_MS = 2000;

// Best-effort diagnostic: when HAYA_PET_HOOK_DEBUG points at a file, append one
// JSONL line per reporter invocation so we can see the exact sequence of states
// a client's hooks fire. Never throws.
function debugLog(env, now, entry) {
  const target = env.HAYA_PET_HOOK_DEBUG;
  if (!target) {
    return;
  }
  try {
    appendFileSync(target, `${JSON.stringify({ ts: now(), ...entry })}\n`);
  } catch {
    // diagnostics must never break a hook
  }
}

export function parseStateArgs(args) {
  const [state, ...rest] = args;
  if (!state) {
    throw new Error("state requires a state name");
  }

  let summary;
  let session;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--summary") {
      summary = rest[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--session") {
      session = rest[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown state option: ${arg}`);
  }

  return { command: "state", state, summary, session };
}

export async function runStateCommand(parsed, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const sessionId = parsed.session ?? env.HAYA_PET_SESSION_ID;
  const agentId = dependencies.agentId;

  debugLog(
    env,
    now,
    agentId
      ? { state: parsed.state, sessionId, summary: parsed.summary, agentId }
      : { state: parsed.state, sessionId, summary: parsed.summary }
  );

  // A subagent's own activity must NEVER drive the main session's status. A
  // backgrounded subagent's tool calls fire the PARENT session's PreToolUse/
  // PostToolUse hooks, which would otherwise overwrite the main agent's status
  // (and the "Subagent running" cue) with running_tool/thinking/editing_files as
  // the subagent works. The payload's `agent_id` is the documented field that
  // distinguishes subagent hook calls from main-thread calls — when it's present
  // the event came from a subagent, so we drop it entirely. The ONE place a
  // subagent surfaces is the main agent's own Stop (no agent_id), via
  // background_tasks; see applySubagentBackgroundTasks below.
  if (agentId) {
    return { command: "state", ok: false, reason: "subagent-event" };
  }

  if (!sessionId) {
    return { command: "state", ok: false, reason: "no-session" };
  }
  if (!isAiClientState(parsed.state)) {
    return { command: "state", ok: false, reason: "invalid-state" };
  }

  // Record this session's real transcript path (ground truth from the Claude hook
  // payload, captured at the process entry and passed in via dependencies) so the
  // wrapper's watcher tails THIS session's file rather than the newest in the
  // project dir — which can bind it to a concurrent session and leak that
  // session's interrupt/denial. Best-effort and synchronous; never blocks the hook.
  recordTranscriptLink(sessionId, env, dependencies);

  // When the main agent's Stop reports idle but its background_tasks (from the hook
  // payload, passed in via dependencies) still lists a running subagent, keep a
  // working cue with a message instead — the main agent is paused but real work
  // continues. The follow-up Stop carries an empty list and clears it. Scoped to
  // subagents only; see background-tasks.js.
  const effective = applySubagentBackgroundTasks({
    state: parsed.state,
    summary: parsed.summary,
    backgroundTasks: dependencies.backgroundTasks
  });

  const createIpcClient = dependencies.createIpcClient ?? defaultCreateIpcClient;
  const deadlineMs = dependencies.reportDeadlineMs ?? REPORT_DEADLINE_MS;

  try {
    const endpoint = dependencies.ipcEndpoint ?? getDefaultPaths({
      platform: dependencies.platform,
      env,
      homeDir: dependencies.homeDir
    }).ipcEndpoint;

    const outcome = await raceDeadline(
      (async () => {
        const client = await createIpcClient({ endpoint });
        await client.send({
          type: "state",
          sessionId,
          state: effective.state,
          summary: effective.summary,
          confidence: 0.9,
          source: "official_plugin",
          updatedAt: now()
        });
        await client.close();
      })(),
      deadlineMs
    );

    if (outcome === DEADLINE) {
      debugLog(env, now, { state: parsed.state, sessionId, timeout: true });
      return { command: "state", ok: false, reason: "timeout" };
    }
    return { command: "state", ok: true };
  } catch {
    return { command: "state", ok: false, reason: "no-daemon" };
  }
}

// Persist the session -> transcript binding for the wrapper's watcher. The
// transcript path is supplied by the caller (read from the hook payload at the
// process entry); when it's absent we simply skip — there is nothing to bind and
// guessing is exactly the bug this avoids.
function recordTranscriptLink(sessionId, env, dependencies) {
  const transcriptPath = dependencies.transcriptPath;
  if (typeof transcriptPath !== "string" || transcriptPath === "") {
    return;
  }
  try {
    const sessionDir =
      dependencies.sessionDir ??
      getDefaultPaths({
        platform: dependencies.platform,
        env,
        homeDir: dependencies.homeDir
      }).sessionDir;
    writeSessionTranscriptLink({ sessionDir, sessionId, transcriptPath }, dependencies);
  } catch {
    // never break a hook over a best-effort binding write
  }
}

// Pull `transcript_path` out of a Claude hook payload (JSON on stdin). Pure and
// defensive: any non-JSON, missing-field, or wrong-type input yields undefined.
export function extractTranscriptPath(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    const value = parsed?.transcript_path;
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

// Pull `agent_id` out of a Claude hook payload (JSON on stdin). Present only for
// subagent-originated events (the documented field distinguishing subagent hook
// calls from main-thread calls); absent for main-agent events. Pure and
// defensive: any non-JSON, missing-field, or wrong-type input yields undefined.
export function extractAgentId(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    const value = parsed?.agent_id;
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

// Read the Claude hook payload from stdin and return everything the reporter
// needs from it in one read (stdin can only be consumed once): the session's
// transcript_path (for the watcher binding) and the live background_tasks snapshot
// (for the subagent-at-Stop cue). Used by the real `haya-pet state` process (a
// Claude hook child) — NOT by internal callers, so tests and other commands never
// touch stdin. Bounded and best-effort: a TTY (manual invocation) or a
// slow/absent payload resolves to empty results rather than ever hanging the host
// client's hook.
export async function readHookPayloadFromStdin(options = {}) {
  const raw = await readHookPayloadRaw(options);
  return {
    transcriptPath: extractTranscriptPath(raw),
    backgroundTasks: extractBackgroundTasks(raw),
    agentId: extractAgentId(raw)
  };
}

// Accumulate the raw payload string from stdin under a hard deadline and byte cap.
// Always resolves (never rejects); an error or no payload yields "".
function readHookPayloadRaw(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const timeoutMs = options.timeoutMs ?? 400;
  const maxBytes = options.maxBytes ?? 1_000_000;

  return new Promise((resolve) => {
    if (!stdin || stdin.isTTY) {
      resolve("");
      return;
    }

    let data = "";
    let settled = false;
    let timer;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        stdin.removeListener("data", onData);
        stdin.removeListener("end", onEnd);
        stdin.removeListener("error", onError);
        stdin.pause();
      } catch {
        // detaching is best-effort
      }
      resolve(data);
    };

    const onData = (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        finish();
      }
    };
    const onEnd = () => finish();
    const onError = () => {
      data = "";
      finish();
    };

    try {
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.on("end", onEnd);
      stdin.on("error", onError);
      stdin.resume();
      timer = setTimeout(finish, timeoutMs);
      if (timer && typeof timer.unref === "function") {
        timer.unref();
      }
    } catch {
      finish();
    }
  });
}
