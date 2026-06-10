// Detects that the user ACCEPTED a client's permission prompt by observing the
// client's process tree. Claude Code (and similar CLIs) emit no hook and write
// no transcript record at the moment of a manual approval — the only real-world
// signal is that the approved command actually starts running as a new process
// under the client. This watcher turns that into an event.
//
// Safety contract (the project rule this exists to honor): a pending-approval
// warning must NEVER be cleared by a guess or a timer. The watcher only reports
// "approved" when a NEW descendant process appears after the prompt and is still
// alive on the next poll. Short-lived blips (our own hook reporter, the user's
// hooks) die between polls and are filtered out. A missed detection is always
// safe — the pet just keeps showing "waiting" until the tool finishes.

const DEFAULT_POLL_INTERVAL_MS = 1500;

// Polls a full-process-table lister and fires `onApproved` ONCE when a new
// descendant of `rootPid` persists across two consecutive snapshots.
export function watchForApprovedProcess(options = {}) {
  const {
    rootPid,
    listProcesses,
    onApproved = () => {},
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    immediate = true,
    setInterval: setIntervalFn = setInterval,
    clearInterval: clearIntervalFn = clearInterval
  } = options;

  let baseline;
  let candidates = new Set();
  let stopped = false;
  let ticking = false;

  const tick = async () => {
    if (stopped || ticking) {
      return;
    }
    ticking = true;
    try {
      const table = await listProcesses();
      const descendants = collectDescendants(table, rootPid);

      if (!baseline) {
        // First successful snapshot: everything already running (the client
        // itself, its shell, the hook that reported the prompt) is baseline
        // and can never count as the approved command.
        baseline = descendants;
        return;
      }

      const fresh = new Set();
      for (const pid of descendants) {
        if (baseline.has(pid)) {
          continue;
        }
        if (candidates.has(pid)) {
          // Seen in two consecutive snapshots — a real, persistent process.
          stop();
          onApproved({ pid });
          return;
        }
        fresh.add(pid);
      }
      candidates = fresh;
    } catch {
      // Snapshots are best-effort; a failed poll must never break the daemon.
    } finally {
      ticking = false;
    }
  };

  const timer = setIntervalFn(tick, pollIntervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    clearIntervalFn(timer);
  }

  if (immediate) {
    // Take the baseline right away rather than a full poll interval later, so a
    // quickly-approved command is less likely to slip into the baseline.
    void tick();
  }

  return { stop, _tick: tick };
}

// Walks the process table for all (transitive) descendants of rootPid. The
// client may sit behind shim layers (cmd.exe -> claude.exe -> command), so the
// whole subtree counts, not just direct children.
export function collectDescendants(table, rootPid) {
  const childrenByParent = new Map();
  for (const entry of table) {
    if (!Number.isInteger(entry?.pid) || !Number.isInteger(entry?.ppid)) {
      continue;
    }
    const siblings = childrenByParent.get(entry.ppid);
    if (siblings) {
      siblings.push(entry.pid);
    } else {
      childrenByParent.set(entry.ppid, [entry.pid]);
    }
  }

  const descendants = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.pop();
    for (const child of childrenByParent.get(parent) ?? []) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }
  return descendants;
}

// Bridges session state changes to per-session watchers: watch a session's
// process tree only while it sits in waiting_approval (and has a known pid),
// stop the moment any other state arrives (finish, denial, exit), and report
// detections with the owning sessionId.
export function createApprovalWatchCoordinator(options = {}) {
  const { createWatcher, onApproved = () => {} } = options;
  const watchers = new Map();

  return {
    onSessionChanged(session) {
      if (!session || typeof session.sessionId !== "string") {
        return;
      }

      const { sessionId, pid, state } = session;

      if (state === "waiting_approval" && Number.isInteger(pid)) {
        if (!watchers.has(sessionId)) {
          const watcher = createWatcher({
            rootPid: pid,
            onApproved: (event) => {
              watchers.delete(sessionId);
              onApproved(sessionId, event);
            }
          });
          watchers.set(sessionId, watcher);
        }
        return;
      }

      const watcher = watchers.get(sessionId);
      if (watcher) {
        watchers.delete(sessionId);
        watcher.stop();
      }
    },

    stopAll() {
      for (const watcher of watchers.values()) {
        watcher.stop();
      }
      watchers.clear();
    }
  };
}
