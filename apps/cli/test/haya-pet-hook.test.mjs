import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { runHookDispatcher } from "../src/haya-pet-hook.js";

test("hook dispatcher exits before connecting or loading without a HAYA session", async () => {
  let connected = 0;
  let loaded = 0;

  const result = await runHookDispatcher(["state", "thinking"], {
    env: {},
    connect: async () => {
      connected += 1;
    },
    loadRuntime: async () => {
      loaded += 1;
    }
  });

  assert.deepEqual(result, { ok: false, reason: "no-session" });
  assert.equal(connected, 0);
  assert.equal(loaded, 0);
});

test("hook dispatcher exits successfully without loading runtime when companion is offline", async () => {
  let loaded = 0;

  const result = await runHookDispatcher(["state", "thinking"], {
    env: { HAYA_PET_SESSION_ID: "sess_a" },
    connect: async () => null,
    loadRuntime: async () => {
      loaded += 1;
    }
  });

  assert.deepEqual(result, { ok: false, reason: "offline" });
  assert.equal(loaded, 0);
});

test("hook dispatcher lazily delegates online events with the connected client", async () => {
  const client = { close: async () => {} };
  let received;

  const result = await runHookDispatcher(["state", "thinking"], {
    env: { HAYA_PET_SESSION_ID: "sess_a" },
    connect: async () => client,
    loadRuntime: async () => ({
      runHookInvocation: async (argv, dependencies) => {
        received = { argv, dependencies };
        return { ok: true };
      }
    })
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(received.argv, ["state", "thinking"]);
  assert.equal(await received.dependencies.createIpcClient(), client);
});
