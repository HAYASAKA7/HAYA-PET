import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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

test("injectCodexHooks keeps a valid existing HAYA command path when launch paths change", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const stableNodeDir = join(home, "stable-node");
    const stableCliDir = join(home, "stable-cli");
    mkdirSync(stableNodeDir, { recursive: true });
    mkdirSync(stableCliDir, { recursive: true });
    const stableNode = join(stableNodeDir, "node.exe");
    const stableCli = join(stableCliDir, "haya-pet.js");
    writeFileSync(stableNode, "", "utf8");
    writeFileSync(stableCli, "", "utf8");

    writeFileSync(join(home, "hooks.json"), JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `${stableNode} "${stableCli}" state idle`,
                statusMessage: "HAYA Pet live status"
              }
            ]
          }
        ]
      }
    }, null, 2), "utf8");

    injectCodexHooks({
      nodePath: join(home, "new-node", "node.exe"),
      cliPath: join(home, "new-cli", "haya-pet.js"),
      codexHome: home
    });

    const next = JSON.parse(readFileSync(join(home, "hooks.json"), "utf8"));
    const commands = Object.values(next.hooks)
      .flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)));
    assert.ok(commands.length > 1, "managed Codex hook set is regenerated");
    assert.ok(
      commands.every((command) => command.startsWith(`${stableNode} "${stableCli}" `)),
      "existing valid command path remains stable so Codex trust still matches"
    );
    assert.ok(!commands.some((command) => command.includes("new-node")), "changed launch node path is ignored");
    assert.ok(!commands.some((command) => command.includes("new-cli")), "changed launch cli path is ignored");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks does not rewrite hooks.json when merged content is unchanged", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const result = injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home
    });
    const stableTime = new Date("2024-01-01T00:00:00Z");
    utimesSync(result.hooksPath, stableTime, stableTime);
    const before = statSync(result.hooksPath).mtimeMs;

    injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home
    });

    assert.equal(statSync(result.hooksPath).mtimeMs, before, "unchanged hook content should not churn file metadata");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks mirrors trusted hooks.json hashes into selected Codex profile", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const hooksPath = join(home, "hooks.json");
    const trustedPrompt = `[hooks.state.'${hooksPath}:user_prompt_submit:0:0']\ntrusted_hash = "sha256:prompt"\n`;
    const trustedStop = `[hooks.state.'${hooksPath}:stop:0:0']\ntrusted_hash = "sha256:stop"\n`;
    const legacyHooks = `# haya-pet live-status hooks profile. Managed by haya-pet; safe to delete.\n[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = 'old-node "C:\\app\\haya-pet.js" state thinking'\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = 'old-node "C:\\app\\haya-pet.js" state idle'\n\n`;

    writeFileSync(join(home, "config.toml"), `approval_policy = "on-request"\n\n[hooks.state]\n\n${trustedPrompt}\n${trustedStop}\n[hooks.state.'C:\\other\\hooks.json:stop:0:0']\ntrusted_hash = "sha256:other"\n`, "utf8");
    writeFileSync(join(home, "fugu.config.toml"), `approvals_reviewer = "auto_review"\n\n${legacyHooks}[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "echo user"\n\n[hooks.state]\n\n[hooks.state.'${hooksPath}:user_prompt_submit:0:0']\ntrusted_hash = "sha256:stale"\n\n[hooks.state.'C:\\other\\hooks.json:stop:0:0']\ntrusted_hash = "sha256:profile-other"\n`, "utf8");

    injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home,
      profileName: "fugu"
    });

    const profile = readFileSync(join(home, "fugu.config.toml"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(profile.includes('approvals_reviewer = "auto_review"'), "profile config is preserved");
    assert.ok(profile.includes(trustedPrompt), "prompt trust hash is copied from base config");
    assert.ok(profile.includes(trustedStop), "stop trust hash is copied from base config");
    assert.ok(!profile.includes("sha256:stale"), "stale profile trust hash is replaced");
    assert.ok(!profile.includes("old-node"), "legacy HAYA profile hooks are removed");
    assert.ok(profile.includes('command = "echo user"'), "user profile hooks are preserved");
    assert.ok(profile.includes('trusted_hash = "sha256:profile-other"'), "unrelated trust state is preserved");
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
