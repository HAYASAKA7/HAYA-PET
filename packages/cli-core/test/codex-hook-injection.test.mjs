import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { injectCodexHooks } from "../src/codex-hook-injection.js";

test("injectCodexHooks writes a stable profile into CODEX_HOME and returns its name", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const result = injectCodexHooks({
      nodePath: "C:\\nodedir\\node.exe",
      cliPath: "C:\\app\\haya-pet.js",
      codexHome: home
    });

    assert.equal(result.profileName, "haya-pet");
    assert.equal(result.profilePath, join(home, "haya-pet.config.toml"));

    const toml = readFileSync(result.profilePath, "utf8");
    assert.match(toml, /\[\[hooks\.UserPromptSubmit\]\]/);
    assert.match(toml, /state thinking/);
    // Program unquoted (cmd /c strips a leading quote on Windows).
    const cmdLine = toml.split("\n").find((l) => l.startsWith("command ="));
    assert.doesNotMatch(cmdLine, /^command = "\\"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks honors CODEX_HOME from env and is stable across calls", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const opts = { nodePath: "n", cliPath: "c", env: { CODEX_HOME: home } };
    const a = injectCodexHooks(opts);
    const first = readFileSync(a.profilePath, "utf8");
    const b = injectCodexHooks(opts);
    const second = readFileSync(b.profilePath, "utf8");

    assert.equal(a.profilePath, join(home, "haya-pet.config.toml"));
    assert.equal(first, second, "stable content keeps Codex hook-trust cached");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
