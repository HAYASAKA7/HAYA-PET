// Hard deadline for IPC awaits in processes that something else waits on.
// A hook reporter is a child process of the wrapped AI client, and the client
// may wait for its hook children at shutdown (observed: Codex /quit hanging on
// its goodbye while an orphaned reporter sat on a never-settling pipe await).
// Racing the interaction against a deadline guarantees the await terminates,
// which in turn guarantees the process can exit.

export const DEADLINE = Symbol("deadline");

// Resolves to the promise's value, or to DEADLINE after `ms` if the promise
// hasn't settled by then. The promise keeps running if it loses the race —
// callers are expected to exit (or proceed) regardless; its eventual rejection
// is swallowed so a late failure can't become an unhandled rejection.
export function raceDeadline(promise, ms) {
  promise.catch(() => {});

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
