import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseLock,
  resolveSingletonAction,
  serializeLock
} from "../../../../packages/daemon-core/src/singleton.js";

// IPC-socket / PID-file singleton fallback (product plan section 39). Electron's
// app.requestSingleInstanceLock() is the primary guard; this lock lets wrappers
// and non-Electron callers detect and reclaim a stale daemon.
export async function acquireDaemonLock({ lockPath, pid = process.pid, endpoint, now = Date.now, isAlive = defaultIsAlive }) {
  const existing = await readLock(lockPath);
  const action = resolveSingletonAction({ lock: existing, isAlive });

  if (action === "forward") {
    return { acquired: false, action, lock: existing };
  }

  const lock = { pid, startedAt: now(), endpoint };
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, serializeLock(lock));

  return { acquired: true, action, lock };
}

export async function releaseDaemonLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readLock(lockPath) {
  try {
    return parseLock(await readFile(lockPath, "utf8"));
  } catch {
    return undefined;
  }
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
