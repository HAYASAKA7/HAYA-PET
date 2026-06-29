import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  buildStatusLabel,
  buildSessionSummary,
  formatElapsed,
  truncateProjectName,
  truncateSummary
} from "../src/summaries.js";

test("maps every normalized state to a human status label", () => {
  assert.equal(buildStatusLabel("waiting_approval"), "Waiting for approval");
  assert.equal(buildStatusLabel("waiting_user"), "Waiting for you");
  assert.equal(buildStatusLabel("running_tool"), "Running tools");
  assert.equal(buildStatusLabel("editing_files"), "Editing files");
  assert.equal(buildStatusLabel("success"), "Done");
  assert.equal(buildStatusLabel("idle"), "Idle");
});

test("falls back to a readable label for unknown states", () => {
  assert.equal(buildStatusLabel("totally_unknown"), "Totally unknown");
});

test("prefers an explicit summary but falls back to the status label", () => {
  assert.equal(
    buildSessionSummary({ state: "running_tool", summary: "npm test" }),
    "npm test"
  );
  assert.equal(
    buildSessionSummary({ state: "waiting_approval" }),
    "Waiting for approval"
  );
});

test("formats elapsed durations compactly", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(5_000), "5s");
  assert.equal(formatElapsed(65_000), "1m 5s");
  assert.equal(formatElapsed(3_725_000), "1h 2m");
});

test("keeps short project names whole", () => {
  assert.equal(truncateProjectName("api"), "api");
  // Exactly at the 10-character budget stays untouched (no ellipsis).
  assert.equal(truncateProjectName("ten-charrr"), "ten-charrr");
});

test("truncates long project names to 10 characters plus an ellipsis", () => {
  assert.equal(truncateProjectName("netdisk-server"), "netdisk-se...");
  assert.equal(truncateProjectName("a-very-long-project-name"), "a-very-lon...");
});

test("honours a custom max length", () => {
  assert.equal(truncateProjectName("netdisk-server", 4), "netd...");
  assert.equal(truncateProjectName("abc", 4), "abc");
});

test("coerces missing or non-string project names to an empty string", () => {
  assert.equal(truncateProjectName(undefined), "");
  assert.equal(truncateProjectName(null), "");
  assert.equal(truncateProjectName(123), "");
});

test("keeps built-in status labels whole in the summary budget", () => {
  // The longest built-in label ("Waiting for approval", 20 chars) and a
  // slightly longer custom message must both fit without an ellipsis.
  assert.equal(truncateSummary("Waiting for approval"), "Waiting for approval");
  assert.equal(truncateSummary("waiting for command approval"), "waiting for command approval");
});

test("truncates a long status or tool-call summary to 32 characters plus an ellipsis", () => {
  assert.equal(
    truncateSummary("Read packages/session-core/src/summaries.js"),
    "Read packages/session-core/src/s..."
  );
});

test("honours a custom summary max length and coerces non-strings", () => {
  assert.equal(truncateSummary("running tools", 4), "runn...");
  assert.equal(truncateSummary(undefined), "");
  assert.equal(truncateSummary(123), "");
});
