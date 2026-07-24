import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildCompanionLaunchOptions } from "../src/haya-pet.js";

test("buildCompanionLaunchOptions captures detached companion output in the HAYA log", () => {
  const log = { fd: 42 };
  const options = buildCompanionLaunchOptions({
    logStream: log
  });

  assert.equal(options.detached, true);
  assert.equal(options.windowsHide, false);
  assert.deepEqual(options.stdio, ["ignore", log, log]);
});