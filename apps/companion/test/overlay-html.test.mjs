import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "../../../test/harness.mjs";

test("resize grip uses an aria label instead of a native title tooltip", () => {
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  assert.match(html, /id="pet-resize-grip"[^>]*aria-label="Drag to resize · double-click to reset"/);
  assert.match(html, /id="pet-resize-grip"[^>]*data-tooltip="Drag to resize · double-click to reset"/);
  assert.doesNotMatch(html, /id="pet-resize-grip"[^>]*\stitle=/);
});