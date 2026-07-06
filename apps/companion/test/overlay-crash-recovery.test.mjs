import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createOverlayCrashPolicy } from "../src/main/overlay-crash-recovery.js";

test("createOverlayCrashPolicy recovers the first crash", () => {
  const policy = createOverlayCrashPolicy();
  assert.equal(policy.shouldRecover(), true);
  assert.equal(policy.consecutiveFailures, 1);
});

test("createOverlayCrashPolicy resets after a successful load, so independent crashes always recover", () => {
  const policy = createOverlayCrashPolicy();
  policy.shouldRecover(); // crash 1 -> recover
  policy.markRecovered(); // the reloaded window finished loading
  assert.equal(policy.consecutiveFailures, 0);
  assert.equal(policy.shouldRecover(), true, "a later, independent crash recovers again");
  assert.equal(policy.consecutiveFailures, 1);
});

test("createOverlayCrashPolicy gives up after repeated crashes with no successful load (loop guard)", () => {
  const policy = createOverlayCrashPolicy({ maxConsecutive: 3 });
  assert.equal(policy.shouldRecover(), true); // 1
  assert.equal(policy.shouldRecover(), true); // 2
  assert.equal(policy.shouldRecover(), true); // 3
  assert.equal(policy.shouldRecover(), false, "stops auto-recovering to avoid a crash->recreate->crash spin");
  assert.equal(policy.consecutiveFailures, 3);
});

test("createOverlayCrashPolicy resumes recovering once a reload successfully loads", () => {
  const policy = createOverlayCrashPolicy({ maxConsecutive: 2 });
  policy.shouldRecover(); // 1
  policy.shouldRecover(); // 2
  assert.equal(policy.shouldRecover(), false, "gave up after the cap");
  policy.markRecovered(); // a reload finally stuck
  assert.equal(policy.shouldRecover(), true, "recovery resumes after a stable load");
});
