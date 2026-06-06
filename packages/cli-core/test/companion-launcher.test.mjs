import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { ensureCompanionConnection } from "../src/companion-launcher.js";

const noSleep = async () => {};

test("connects without launching when the companion is already running", async () => {
  let launched = 0;
  const client = { id: "existing" };
  const result = await ensureCompanionConnection({
    connect: async () => client,
    launch: async () => { launched += 1; },
    sleep: noSleep
  });
  assert.equal(result.client, client);
  assert.equal(result.started, false);
  assert.equal(launched, 0);
});

test("launches the companion then connects after it comes up", async () => {
  let launched = 0;
  let attempts = 0;
  const client = { id: "fresh" };
  const result = await ensureCompanionConnection({
    // First check fails (not running); after launch, the 3rd connect succeeds.
    connect: async () => {
      attempts += 1;
      if (attempts <= 3) {
        throw new Error("ECONNREFUSED");
      }
      return client;
    },
    launch: async () => { launched += 1; },
    attempts: 10,
    intervalMs: 1,
    sleep: noSleep
  });
  assert.equal(result.client, client);
  assert.equal(result.started, true);
  assert.equal(launched, 1, "launches exactly once");
});

test("does not launch when autoStart is disabled", async () => {
  let launched = 0;
  const result = await ensureCompanionConnection({
    connect: async () => { throw new Error("no daemon"); },
    launch: async () => { launched += 1; },
    autoStart: false,
    sleep: noSleep
  });
  assert.equal(result.client, null);
  assert.equal(result.started, false);
  assert.equal(launched, 0);
});

test("times out gracefully when the companion never comes up", async () => {
  let launched = 0;
  const result = await ensureCompanionConnection({
    connect: async () => { throw new Error("never listening"); },
    launch: async () => { launched += 1; },
    attempts: 4,
    intervalMs: 1,
    sleep: noSleep
  });
  assert.equal(result.client, null);
  assert.equal(result.started, false);
  assert.equal(result.timedOut, true);
  assert.equal(launched, 1);
});

test("degrades gracefully when launching throws (e.g. electron missing)", async () => {
  const result = await ensureCompanionConnection({
    connect: async () => { throw new Error("no daemon"); },
    launch: async () => { throw new Error("electron not installed"); },
    sleep: noSleep
  });
  assert.equal(result.client, null);
  assert.equal(result.started, false);
  assert.ok(result.error instanceof Error);
});

test("stops polling as soon as a connection succeeds", async () => {
  let connectCalls = 0;
  const client = { id: "x" };
  await ensureCompanionConnection({
    connect: async () => {
      connectCalls += 1;
      if (connectCalls === 1) throw new Error("not yet"); // initial check
      if (connectCalls === 2) return client;              // first poll succeeds
      throw new Error("should not poll again");
    },
    launch: async () => {},
    attempts: 10,
    intervalMs: 1,
    sleep: noSleep
  });
  assert.equal(connectCalls, 2);
});
