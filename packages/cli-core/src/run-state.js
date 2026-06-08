// The `haya-pet state` reporter. Invoked by client hooks (e.g. Claude Code) to
// push a live status into the daemon. It must NEVER throw or block a host CLI's
// hook, so every failure path resolves to a quiet { ok: false, reason }.
import { appendFileSync } from "node:fs";
import { createIpcClient as defaultCreateIpcClient } from "../../daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../platform-core/src/paths.js";
import { isAiClientState } from "../../protocol/src/messages.js";

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

  debugLog(env, now, { state: parsed.state, sessionId, summary: parsed.summary });

  if (!sessionId) {
    return { command: "state", ok: false, reason: "no-session" };
  }
  if (!isAiClientState(parsed.state)) {
    return { command: "state", ok: false, reason: "invalid-state" };
  }

  const createIpcClient = dependencies.createIpcClient ?? defaultCreateIpcClient;

  try {
    const endpoint = dependencies.ipcEndpoint ?? getDefaultPaths({
      platform: dependencies.platform,
      env,
      homeDir: dependencies.homeDir
    }).ipcEndpoint;
    const client = await createIpcClient({ endpoint });
    await client.send({
      type: "state",
      sessionId,
      state: parsed.state,
      summary: parsed.summary,
      confidence: 0.9,
      source: "official_plugin",
      updatedAt: now()
    });
    await client.close();
    return { command: "state", ok: true };
  } catch {
    return { command: "state", ok: false, reason: "no-daemon" };
  }
}
