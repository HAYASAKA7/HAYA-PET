// Daemon singleton enforcement helpers (product plan section 39). The pure
// decision logic here lets the Electron main process and tests share the same
// stale-lock detection without touching the filesystem.

export function serializeLock({ pid, startedAt, endpoint }) {
  return `${JSON.stringify({ pid, startedAt, endpoint })}\n`;
}

export function parseLock(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) {
    return undefined;
  }

  if (!Number.isFinite(parsed.startedAt) || typeof parsed.endpoint !== "string") {
    return undefined;
  }

  return { pid: parsed.pid, startedAt: parsed.startedAt, endpoint: parsed.endpoint };
}

export function resolveSingletonAction({ lock, isAlive }) {
  if (typeof isAlive !== "function") {
    throw new TypeError("isAlive must be a function");
  }

  if (!lock) {
    return "acquire";
  }

  return isAlive(lock.pid) ? "forward" : "reclaim";
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
