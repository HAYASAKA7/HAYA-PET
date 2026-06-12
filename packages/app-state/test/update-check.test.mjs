import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { parsePositionState, serializePositionState } from "../src/state.js";
import {
  checkForUpdate,
  fetchLatestVersion,
  getLastUpdateCheck,
  isNewerVersion,
  setUpdateCheck
} from "../src/update-check.js";

test("isNewerVersion compares dotted numeric versions", () => {
  assert.equal(isNewerVersion("0.2.8", "0.2.7"), true);
  assert.equal(isNewerVersion("0.3.0", "0.2.7"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.2.10", "0.2.9"), true);
  assert.equal(isNewerVersion("v0.2.8", "0.2.7"), true);

  assert.equal(isNewerVersion("0.2.7", "0.2.7"), false);
  assert.equal(isNewerVersion("0.2.6", "0.2.7"), false);
  assert.equal(isNewerVersion("0.2", "0.2.0"), false);
});

test("isNewerVersion is conservative about unparseable versions", () => {
  assert.equal(isNewerVersion(undefined, "0.2.7"), false);
  assert.equal(isNewerVersion("0.3.0", undefined), false);
  assert.equal(isNewerVersion("not-a-version", "0.2.7"), false);
  assert.equal(isNewerVersion("0.3.0-beta.1", "0.2.7"), false);
});

test("setUpdateCheck stores the cache immutably and survives (de)serialization", () => {
  const original = parsePositionState("{}");
  const updated = setUpdateCheck(original, { checkedAt: 123, latestVersion: "0.3.0" });

  assert.equal(getLastUpdateCheck(original), undefined, "original state untouched");
  assert.deepEqual(getLastUpdateCheck(updated), { checkedAt: 123, latestVersion: "0.3.0" });

  const reloaded = parsePositionState(serializePositionState(updated));
  assert.deepEqual(getLastUpdateCheck(reloaded), { checkedAt: 123, latestVersion: "0.3.0" });
});

function memoryStateFile(initial = parsePositionState("{}")) {
  let state = initial;
  const saves = [];
  return {
    load: async () => state,
    save: async (next) => {
      state = next;
      saves.push(next);
      return next;
    },
    saves
  };
}

test("checkForUpdate fetches, caches, and reports a newer version", async () => {
  const stateFile = memoryStateFile();
  let fetches = 0;

  const result = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile,
    env: {},
    now: () => 1000,
    fetchLatest: async () => {
      fetches += 1;
      return "0.3.0";
    }
  });

  assert.deepEqual(result, { currentVersion: "0.2.7", latestVersion: "0.3.0" });
  assert.equal(fetches, 1);
  assert.deepEqual(getLastUpdateCheck(stateFile.saves[0]), { checkedAt: 1000, latestVersion: "0.3.0" });
});

test("checkForUpdate uses a fresh cache without fetching", async () => {
  const cached = setUpdateCheck(parsePositionState("{}"), { checkedAt: 1000, latestVersion: "0.3.0" });
  const stateFile = memoryStateFile(cached);

  const result = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile,
    env: {},
    now: () => 1000 + 60_000,
    fetchLatest: async () => {
      throw new Error("must not fetch while the cache is fresh");
    }
  });

  assert.deepEqual(result, { currentVersion: "0.2.7", latestVersion: "0.3.0" });
  assert.equal(stateFile.saves.length, 0, "fresh cache is not re-saved");
});

test("checkForUpdate refetches once the cache expires", async () => {
  const cached = setUpdateCheck(parsePositionState("{}"), { checkedAt: 0, latestVersion: "0.2.8" });
  const stateFile = memoryStateFile(cached);

  const result = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile,
    env: {},
    now: () => 25 * 60 * 60 * 1000,
    ttlMs: 24 * 60 * 60 * 1000,
    fetchLatest: async () => "0.4.0"
  });

  assert.equal(result.latestVersion, "0.4.0");
  assert.equal(stateFile.saves.length, 1);
});

test("checkForUpdate reports nothing when already up to date", async () => {
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    stateFile: memoryStateFile(),
    env: {},
    now: () => 1000,
    fetchLatest: async () => "0.3.0"
  });

  assert.equal(result, undefined);
});

test("checkForUpdate is silent on opt-out, failure, and bad input", async () => {
  const optedOut = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile: memoryStateFile(),
    env: { HAYA_PET_NO_UPDATE_CHECK: "1" },
    fetchLatest: async () => "9.9.9"
  });
  assert.equal(optedOut, undefined);

  const fetchFailed = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile: memoryStateFile(),
    env: {},
    fetchLatest: async () => undefined
  });
  assert.equal(fetchFailed, undefined);

  const loadFailed = await checkForUpdate({
    currentVersion: "0.2.7",
    stateFile: { load: async () => { throw new Error("disk"); }, save: async () => {} },
    env: {},
    fetchLatest: async () => "9.9.9"
  });
  assert.equal(loadFailed, undefined);

  const noVersion = await checkForUpdate({
    currentVersion: undefined,
    stateFile: memoryStateFile(),
    env: {},
    fetchLatest: async () => "9.9.9"
  });
  assert.equal(noVersion, undefined);
});

function fakeResponse({ statusCode = 200, body = "" } = {}) {
  const handlers = {};
  return {
    statusCode,
    setEncoding() {},
    resume() {},
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    emit(event, payload) {
      handlers[event]?.(payload);
    },
    body
  };
}

function fakeGet({ response, requestError } = {}) {
  return (url, options, onResponse) => {
    const handlers = {};
    const request = {
      on(event, handler) {
        handlers[event] = handler;
        return this;
      },
      destroy() {
        this.destroyed = true;
      }
    };
    queueMicrotask(() => {
      if (requestError) {
        handlers.error?.(requestError);
        return;
      }
      onResponse(response);
      response.emit("data", response.body);
      response.emit("end");
    });
    return request;
  };
}

test("fetchLatestVersion extracts the version from the registry response", async () => {
  const version = await fetchLatestVersion({
    get: fakeGet({ response: fakeResponse({ body: '{"name":"x","version":"0.3.0"}' }) })
  });
  assert.equal(version, "0.3.0");
});

test("fetchLatestVersion resolves undefined on bad status, bad JSON, and errors", async () => {
  assert.equal(
    await fetchLatestVersion({ get: fakeGet({ response: fakeResponse({ statusCode: 404, body: "{}" }) }) }),
    undefined
  );
  assert.equal(
    await fetchLatestVersion({ get: fakeGet({ response: fakeResponse({ body: "not json" }) }) }),
    undefined
  );
  assert.equal(
    await fetchLatestVersion({ get: fakeGet({ requestError: new Error("offline") }) }),
    undefined
  );
});

test("fetchLatestVersion times out instead of hanging", async () => {
  const version = await fetchLatestVersion({
    timeoutMs: 5,
    get: () => ({ on() { return this; }, destroy() {} }) // never responds
  });
  assert.equal(version, undefined);
});
