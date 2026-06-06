import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { stripAnsi } from "../src/strip-ansi.js";

const ESC = String.fromCharCode(27); // 
const BEL = String.fromCharCode(7); // 

test("strips CSI cursor/clear sequences", () => {
  assert.equal(stripAnsi(`${ESC}[2J${ESC}[H${ESC}[mrunning tests\r\n`), "running tests\r\n");
});

test("strips OSC title sequences", () => {
  assert.equal(stripAnsi(`${ESC}]0;C:\\cmd.exe${BEL}plain text`), "plain text");
});

test("strips color codes but keeps the words", () => {
  assert.equal(stripAnsi(`${ESC}[31mError:${ESC}[0m boom`), "Error: boom");
});

test("leaves plain text untouched", () => {
  assert.equal(stripAnsi("waiting for approval"), "waiting for approval");
});

test("handles real ConPTY-style output", () => {
  const raw = `${ESC}[?25l${ESC}[2J${ESC}[mApplying patch to src/index.js\r\n${ESC}]0;cmd${BEL}${ESC}[?25h`;
  assert.ok(stripAnsi(raw).includes("Applying patch to src/index.js"));
});
