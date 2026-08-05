import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "../../../test/harness.mjs";
import { injectClaudeHooks } from "../src/claude-hook-injection.js";

test("injectClaudeHooks writes a settings file with stable hook commands", () => {
  const injected = injectClaudeHooks({
    nodePath: "/n/node",
    cliPath: "/c/haya-pet.js"
  });

  assert.ok(existsSync(injected.settingsPath), "settings file exists after inject");
  const parsed = JSON.parse(readFileSync(injected.settingsPath, "utf8"));
  assert.ok(parsed.hooks.UserPromptSubmit, "settings contain hooks");
  const cmd = parsed.hooks.UserPromptSubmit[0].hooks[0].command;
  assert.match(cmd, /state thinking$/);
  // No volatile per-session argument baked in (it would re-trigger hook trust).
  assert.doesNotMatch(cmd, /--session/);
});

test("injectClaudeHooks uses a stable path with identical content across calls", () => {
  const a = injectClaudeHooks({ nodePath: "n", cliPath: "c" });
  const b = injectClaudeHooks({ nodePath: "n", cliPath: "c" });
  assert.equal(a.settingsPath, b.settingsPath, "same stable path each launch");
  assert.equal(
    readFileSync(a.settingsPath, "utf8"),
    readFileSync(b.settingsPath, "utf8"),
    "identical bytes so Claude keeps trusting the hooks"
  );
});

test("injectClaudeHooks cleanup is a safe no-op", () => {
  const injected = injectClaudeHooks({ nodePath: "n", cliPath: "c" });
  assert.doesNotThrow(() => injected.cleanup());
  // The stable settings file is intentionally left in place for trust caching.
  assert.ok(existsSync(injected.settingsPath));
});

test("injectClaudeHooks resolves real node + cli paths by default", () => {
  const injected = injectClaudeHooks();
  const parsed = JSON.parse(readFileSync(injected.settingsPath, "utf8"));
  const cmd = parsed.hooks.Stop[0].hooks[0].command;
  assert.match(cmd, /haya-pet-hook\.js/);
  assert.match(cmd, /state idle$/);
  assert.ok(cmd.trim().length > "state idle".length);
});
