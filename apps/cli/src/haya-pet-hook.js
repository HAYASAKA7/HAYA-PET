#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_CONNECT_DEADLINE_MS = 150;

export async function runHookDispatcher(argv = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env ?? process.env;
  if (!env.HAYA_PET_SESSION_ID) {
    return { ok: false, reason: "no-session" };
  }

  const connect = dependencies.connect ?? (() => connectWithinDeadline({ ...dependencies, env }));
  let client;
  try {
    client = await connect();
  } catch {
    return { ok: false, reason: "offline" };
  }

  if (!client) {
    return { ok: false, reason: "offline" };
  }

  try {
    const loadRuntime = dependencies.loadRuntime ?? (() => import("./haya-pet.js"));
    const runtime = await loadRuntime();
    return await runtime.runHookInvocation(argv, {
      ...dependencies,
      env,
      createIpcClient: async () => client
    });
  } catch {
    await closeBestEffort(client);
    return { ok: false, reason: "reporter-error" };
  }
}

async function connectWithinDeadline(dependencies) {
  try {
    const [ipc, platform, deadline] = await Promise.all([
      import("../../../packages/daemon-core/src/ipc-server.js"),
      import("../../../packages/platform-core/src/paths.js"),
      import("../../../packages/cli-core/src/deadline.js")
    ]);
    const endpoint = dependencies.ipcEndpoint ?? platform.getDefaultPaths({
      env: dependencies.env
    }).ipcEndpoint;
    const result = await deadline.raceDeadline(
      ipc.createIpcClient({ endpoint }),
      dependencies.connectDeadlineMs ?? DEFAULT_CONNECT_DEADLINE_MS
    );
    return result === deadline.DEADLINE ? null : result;
  } catch {
    return null;
  }
}

async function closeBestEffort(client) {
  try {
    await client.close?.();
  } catch {
    // Hook failures must never disrupt the provider process.
  }
}

function isDirectRun(moduleUrl, scriptPath) {
  if (!scriptPath) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(modulePath) === realpathSync(scriptPath);
  } catch {
    return modulePath === scriptPath;
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  runHookDispatcher().finally(() => {
    // A timed-out pipe connection can remain pending. Hooks are best-effort,
    // so exit explicitly after the dispatcher reaches its deadline.
    process.exit(0);
  });
}
