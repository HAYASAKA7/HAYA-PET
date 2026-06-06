// Orchestrates "connect to the companion, auto-starting it if it isn't running"
// so `haya-pet run` works without anyone manually launching the overlay first.
//
// Pure and dependency-injected: the caller supplies how to `connect` (open an
// IPC client, throwing if nothing is listening) and how to `launch` (spawn the
// companion). This keeps the real Electron/IPC wiring out of the tested logic.

const DEFAULT_ATTEMPTS = 25; // attempts * intervalMs ≈ how long we wait for boot
const DEFAULT_INTERVAL_MS = 200;

export async function ensureCompanionConnection({
  connect,
  launch,
  autoStart = true,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  sleep = defaultSleep
} = {}) {
  if (typeof connect !== "function") {
    throw new TypeError("connect must be a function");
  }

  // 1) Already running? Use it as-is.
  const existing = await tryConnect(connect);
  if (existing) {
    return { client: existing, started: false };
  }

  if (!autoStart || typeof launch !== "function") {
    return { client: null, started: false };
  }

  // 2) Launch the companion. A launch failure (e.g. Electron not installed)
  //    must not break the wrapped command — degrade to "no pet".
  try {
    await launch();
  } catch (error) {
    return { client: null, started: false, error };
  }

  // 3) Poll until it's listening, or give up (still letting the command run).
  for (let i = 0; i < attempts; i += 1) {
    await sleep(intervalMs);
    const client = await tryConnect(connect);
    if (client) {
      return { client, started: true };
    }
  }

  return { client: null, started: false, timedOut: true };
}

async function tryConnect(connect) {
  try {
    return await connect();
  } catch {
    return null;
  }
}

function defaultSleep(ms) {
  // Deliberately NOT unref'd: during the connect-retry poll this timer is often
  // the only pending handle, and an unref'd timer would let Node exit the
  // process mid-poll (before the wrapped command ever runs). The timer is
  // short-lived and always settles, so it can't hang the process.
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
