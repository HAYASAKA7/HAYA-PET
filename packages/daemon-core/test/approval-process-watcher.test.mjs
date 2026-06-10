import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  watchForApprovedProcess,
  createApprovalWatchCoordinator
} from "../src/approval-process-watcher.js";

// --- watchForApprovedProcess -------------------------------------------------
// The watcher's contract is event-based, never time-based: it may only report
// "approved" because a real NEW process appeared under the client and stayed
// alive across two consecutive polls. A missed detection is always safe (the
// pet just keeps showing "waiting"); a false detection would hide a pending
// approval warning, so the persistence filter errs toward not firing.

function makeWatcher(snapshots, overrides = {}) {
  // `snapshots` is a queue of process tables the fake lister returns per call.
  const calls = { cleared: 0 };
  const watcher = watchForApprovedProcess({
    rootPid: 100,
    listProcesses: async () => {
      if (snapshots.length === 0) {
        throw new Error("test ran out of snapshots");
      }
      const next = snapshots.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    immediate: false,
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {
      calls.cleared += 1;
    },
    ...overrides
  });
  return { watcher, calls };
}

const ROOT = { pid: 100, ppid: 1 };
const BASE_CHILD = { pid: 110, ppid: 100 };

test("approval watcher ignores descendants that existed at baseline", async () => {
  const approved = [];
  const { watcher } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick(); // baseline
  await watcher._tick();
  await watcher._tick();

  assert.deepEqual(approved, []);
});

test("approval watcher fires once when a new descendant persists across two polls", async () => {
  const approved = [];
  const newChild = { pid: 200, ppid: 100 };
  const { watcher, calls } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD, newChild],
      [ROOT, BASE_CHILD, newChild],
      [ROOT, BASE_CHILD, newChild, { pid: 300, ppid: 100 }]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick(); // baseline
  await watcher._tick(); // candidate seen once — not yet
  assert.deepEqual(approved, []);
  await watcher._tick(); // candidate persisted — fire
  assert.deepEqual(approved, [{ pid: 200 }]);

  // Fires once and stops itself; later ticks are no-ops.
  await watcher._tick();
  assert.equal(approved.length, 1);
  assert.equal(calls.cleared, 1);
});

test("approval watcher ignores a short-lived blip (hook spawn)", async () => {
  const approved = [];
  const blip = { pid: 200, ppid: 100 };
  const { watcher } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD, blip],
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick(); // baseline
  await watcher._tick(); // blip appears
  await watcher._tick(); // blip gone — must not fire
  await watcher._tick();

  assert.deepEqual(approved, []);
});

test("approval watcher detects new grandchildren, not just direct children", async () => {
  const approved = [];
  // New process hangs off the pre-existing shell child (root -> shell -> command).
  const grandchild = { pid: 200, ppid: 110 };
  const { watcher } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD, grandchild],
      [ROOT, BASE_CHILD, grandchild]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick();
  await watcher._tick();
  await watcher._tick();

  assert.deepEqual(approved, [{ pid: 200 }]);
});

test("approval watcher does not detect unrelated processes", async () => {
  const approved = [];
  const unrelated = { pid: 200, ppid: 999 };
  const { watcher } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD, unrelated],
      [ROOT, BASE_CHILD, unrelated]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick();
  await watcher._tick();
  await watcher._tick();

  assert.deepEqual(approved, []);
});

test("approval watcher survives lister errors and keeps working", async () => {
  const approved = [];
  const newChild = { pid: 200, ppid: 100 };
  const { watcher } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      new Error("snapshot failed"),
      [ROOT, BASE_CHILD, newChild],
      [ROOT, BASE_CHILD, newChild]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick(); // baseline
  await watcher._tick(); // error — swallowed
  await watcher._tick(); // candidate
  await watcher._tick(); // persisted — fire

  assert.deepEqual(approved, [{ pid: 200 }]);
});

test("approval watcher stop() prevents any further detection", async () => {
  const approved = [];
  const newChild = { pid: 200, ppid: 100 };
  const { watcher, calls } = makeWatcher(
    [
      [ROOT, BASE_CHILD],
      [ROOT, BASE_CHILD, newChild],
      [ROOT, BASE_CHILD, newChild]
    ],
    { onApproved: (event) => approved.push(event) }
  );

  await watcher._tick();
  watcher.stop();
  await watcher._tick();
  await watcher._tick();

  assert.deepEqual(approved, []);
  assert.equal(calls.cleared, 1);
});

// --- createApprovalWatchCoordinator -------------------------------------------
// Bridges session state changes to per-session watchers: watch only while a
// session with a known pid sits in waiting_approval; stop on any other state.

function makeCoordinator(overrides = {}) {
  const events = { started: [], stopped: [], approved: [] };
  const watchers = new Map();
  const coordinator = createApprovalWatchCoordinator({
    createWatcher: ({ rootPid, onApproved }) => {
      events.started.push(rootPid);
      const watcher = {
        onApproved,
        stop: () => events.stopped.push(rootPid)
      };
      watchers.set(rootPid, watcher);
      return watcher;
    },
    onApproved: (sessionId, event) => events.approved.push({ sessionId, ...event }),
    ...overrides
  });
  return { coordinator, events, watchers };
}

function session(state, overrides = {}) {
  return { sessionId: "sess_a", pid: 100, state, ...overrides };
}

test("coordinator starts a watcher when a session enters waiting_approval", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("thinking"));
  assert.deepEqual(events.started, []);

  coordinator.onSessionChanged(session("waiting_approval"));
  assert.deepEqual(events.started, [100]);
});

test("coordinator does not start a duplicate watcher for the same session", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval"));
  coordinator.onSessionChanged(session("waiting_approval"));

  assert.deepEqual(events.started, [100]);
});

test("coordinator stops the watcher when the session leaves waiting_approval", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval"));
  coordinator.onSessionChanged(session("thinking"));

  assert.deepEqual(events.stopped, [100]);

  // Re-entering waiting_approval starts a fresh watcher.
  coordinator.onSessionChanged(session("waiting_approval"));
  assert.deepEqual(events.started, [100, 100]);
});

test("coordinator ignores sessions without a pid", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval", { pid: undefined }));

  assert.deepEqual(events.started, []);
});

test("coordinator ignores undefined session changes", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(undefined);

  assert.deepEqual(events.started, []);
});

test("coordinator forwards approval with the sessionId and stops tracking", () => {
  const { coordinator, events, watchers } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval"));
  watchers.get(100).onApproved({ pid: 200 });

  assert.deepEqual(events.approved, [{ sessionId: "sess_a", pid: 200 }]);

  // The fired watcher is forgotten — a later waiting_approval starts a new one.
  coordinator.onSessionChanged(session("waiting_approval"));
  assert.deepEqual(events.started, [100, 100]);
});

test("coordinator tracks multiple sessions independently", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval"));
  coordinator.onSessionChanged(session("waiting_approval", { sessionId: "sess_b", pid: 300 }));
  coordinator.onSessionChanged(session("idle"));

  assert.deepEqual(events.started, [100, 300]);
  assert.deepEqual(events.stopped, [100]);
});

test("coordinator stopAll stops every active watcher", () => {
  const { coordinator, events } = makeCoordinator();

  coordinator.onSessionChanged(session("waiting_approval"));
  coordinator.onSessionChanged(session("waiting_approval", { sessionId: "sess_b", pid: 300 }));
  coordinator.stopAll();

  assert.deepEqual(events.stopped.sort(), [100, 300]);
});
