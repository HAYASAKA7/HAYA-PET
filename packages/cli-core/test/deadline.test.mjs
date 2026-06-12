import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { DEADLINE, raceDeadline } from "../src/deadline.js";

test("raceDeadline passes through a value that settles in time", async () => {
  assert.equal(await raceDeadline(Promise.resolve("done"), 50), "done");
});

test("raceDeadline resolves to DEADLINE when the promise hangs", async () => {
  const hang = new Promise(() => {});
  assert.equal(await raceDeadline(hang, 10), DEADLINE);
});

test("raceDeadline propagates a rejection that settles in time", async () => {
  await assert.rejects(() => raceDeadline(Promise.reject(new Error("boom")), 50), /boom/);
});

test("raceDeadline swallows a rejection that loses the race", async () => {
  let rejectLater;
  const losing = new Promise((_resolve, reject) => {
    rejectLater = reject;
  });

  assert.equal(await raceDeadline(losing, 10), DEADLINE);

  // The late rejection must not surface as an unhandled rejection.
  rejectLater(new Error("late failure"));
  await new Promise((resolve) => setImmediate(resolve));
});
