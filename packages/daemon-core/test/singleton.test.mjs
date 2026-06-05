import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  parseLock,
  serializeLock,
  resolveSingletonAction
} from "../src/singleton.js";

test("round-trips a lock record", () => {
  const lock = { pid: 1234, startedAt: 100, endpoint: "\\\\.\\pipe\\ai-petd" };
  const parsed = parseLock(serializeLock(lock));
  assert.deepEqual(parsed, lock);
});

test("parses invalid lock content as undefined", () => {
  assert.equal(parseLock("not json"), undefined);
  assert.equal(parseLock(JSON.stringify({ startedAt: 1 })), undefined);
});

test("acquires when no lock is present", () => {
  assert.equal(resolveSingletonAction({ lock: undefined, isAlive: () => true }), "acquire");
});

test("forwards to a live daemon", () => {
  const lock = { pid: 1234, startedAt: 1, endpoint: "x" };
  assert.equal(resolveSingletonAction({ lock, isAlive: (pid) => pid === 1234 }), "forward");
});

test("reclaims a stale lock when the process is dead", () => {
  const lock = { pid: 1234, startedAt: 1, endpoint: "x" };
  assert.equal(resolveSingletonAction({ lock, isAlive: () => false }), "reclaim");
});
