import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { injectCodexHooks } from "../src/codex-hook-injection.js";

test("injectCodexHooks writes stable user-level hooks into CODEX_HOME", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const result = injectCodexHooks({
      nodePath: "C:\\nodedir\\node.exe",
      cliPath: "C:\\app\\haya-pet.js",
      codexHome: home
    });

    assert.equal(result.hooksPath, join(home, "hooks.json"));

    const json = JSON.parse(readFileSync(result.hooksPath, "utf8"));
    const promptHook = json.hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(promptHook.type, "command");
    assert.match(promptHook.command, /state thinking/);
    assert.equal(promptHook.statusMessage, "HAYA Pet live status");
    // Program unquoted (cmd /c strips a leading quote on Windows).
    assert.doesNotMatch(promptHook.command, /^"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks honors CODEX_HOME from env and is stable across calls", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const opts = { nodePath: "n", cliPath: "c", env: { CODEX_HOME: home } };
    const a = injectCodexHooks(opts);
    const first = readFileSync(a.hooksPath, "utf8");
    const b = injectCodexHooks(opts);
    const second = readFileSync(b.hooksPath, "utf8");

    assert.equal(a.hooksPath, join(home, "hooks.json"));
    assert.equal(first, second, "stable content keeps Codex hook-trust cached");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks preserves user hooks and replaces prior HAYA hooks", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    writeFileSync(join(home, "hooks.json"), JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo user" },
              { type: "command", command: "old-node old-cli state idle", statusMessage: "HAYA Pet live status" }
            ]
          }
        ]
      }
    }, null, 2), "utf8");

    injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home
    });

    const next = JSON.parse(readFileSync(join(home, "hooks.json"), "utf8"));
    const stopCommands = next.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command));
    assert.ok(stopCommands.includes("echo user"), "existing user hook is preserved");
    assert.ok(stopCommands.some((command) => command === 'n "c" state idle'), "fresh HAYA hook is installed");
    assert.ok(!stopCommands.some((command) => command.includes("old-node")), "stale HAYA hook is removed");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
