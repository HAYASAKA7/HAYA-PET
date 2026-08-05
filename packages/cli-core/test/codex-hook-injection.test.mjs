import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { injectCodexHooks } from "../src/codex-hook-injection.js";

function createCommandPaths(home, prefix = "stable") {
  const nodePath = join(home, prefix + "-node.exe");
  const cliPath = join(home, prefix + "-haya-pet-hook.js");
  writeFileSync(nodePath, "", "utf8");
  writeFileSync(cliPath, "", "utf8");
  return { nodePath, cliPath };
}

test("injectCodexHooks returns session overrides without creating global hooks.json", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const commandStatePath = join(home, "haya-state", "codex-hook-command.json");
    const paths = createCommandPaths(home);
    const result = injectCodexHooks({
      ...paths,
      codexHome: home,
      commandStatePath
    });

    assert.equal(result.hooksPath, join(home, "hooks.json"));
    assert.equal(result.commandStatePath, commandStatePath);
    assert.equal(existsSync(result.hooksPath), false);
    assert.ok(result.configArgs.length > 0);
    assert.equal(result.configArgs[0], "-c");
    assert.ok(result.configArgs.some((arg) => arg.startsWith("hooks.Stop=")));
    assert.ok(result.configArgs.some((arg) => arg.includes("HAYA Pet live status")));
    assert.ok(result.configArgs.some((arg) => arg.includes(paths.cliPath.replaceAll("\\", "\\\\"))));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks removes only legacy HAYA handlers from global hooks.json", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const hooksPath = join(home, "hooks.json");
    writeFileSync(hooksPath, JSON.stringify({
      custom: { preserved: true },
      hooks: {
        Stop: [{
          matcher: "manual",
          hooks: [
            { type: "command", command: "echo user" },
            {
              type: "command",
              command: 'old-node "C:\\app\\haya-pet-hook.js" state idle',
              statusMessage: "HAYA Pet live status"
            }
          ]
        }],
        UserPromptSubmit: [{
          hooks: [{
            type: "command",
            command: 'old-node "C:\\app\\haya-pet.js" state thinking'
          }]
        }]
      }
    }, null, 2), "utf8");

    injectCodexHooks({
      nodePath: "new-node",
      cliPath: "new-hook",
      codexHome: home,
      commandStatePath: join(home, "command.json")
    });

    const next = JSON.parse(readFileSync(hooksPath, "utf8"));
    assert.deepEqual(next.custom, { preserved: true });
    assert.equal(next.hooks.Stop[0].matcher, "manual");
    assert.deepEqual(next.hooks.Stop[0].hooks, [{ type: "command", command: "echo user" }]);
    assert.deepEqual(next.hooks.UserPromptSubmit, []);
    assert.doesNotMatch(JSON.stringify(next), /HAYA Pet live status|haya-pet(?:-hook)?\.js/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks migrates a valid legacy dispatcher path into stable HAYA metadata", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const stable = createCommandPaths(home, "legacy");
    const fallback = createCommandPaths(home, "fallback");
    const laterFallback = createCommandPaths(home, "later");
    const hooksPath = join(home, "hooks.json");
    const commandStatePath = join(home, "haya", "codex-hook-command.json");
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: "command",
            command: stable.nodePath + ' "' + stable.cliPath + '" state idle',
            statusMessage: "HAYA Pet live status"
          }]
        }]
      }
    }), "utf8");

    const first = injectCodexHooks({
      ...fallback,
      codexHome: home,
      commandStatePath
    });
    assert.deepEqual(JSON.parse(readFileSync(commandStatePath, "utf8")), {
      version: 1,
      nodePath: stable.nodePath,
      cliPath: stable.cliPath
    });
    assert.ok(first.configArgs.some((arg) => arg.includes(stable.nodePath.replaceAll("\\", "\\\\"))));
    assert.deepEqual(JSON.parse(readFileSync(hooksPath, "utf8")), { hooks: { Stop: [] } });

    const second = injectCodexHooks({
      ...laterFallback,
      codexHome: home,
      commandStatePath
    });
    assert.ok(second.configArgs.some((arg) => arg.includes(stable.cliPath.replaceAll("\\", "\\\\"))));
    assert.ok(!second.configArgs.some((arg) => arg.includes("later-haya-pet-hook")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks does not rewrite unrelated hooks.json content", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const hooksPath = join(home, "hooks.json");
    writeFileSync(hooksPath, '{\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "echo user" }] }]\n  }\n}\n', "utf8");
    const stableTime = new Date("2024-01-01T00:00:00Z");
    utimesSync(hooksPath, stableTime, stableTime);
    const before = statSync(hooksPath).mtimeMs;

    injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home,
      commandStatePath: join(home, "command.json")
    });

    assert.equal(statSync(hooksPath).mtimeMs, before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks removes legacy profile hooks without copying global trust state", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    const hooksPath = join(home, "hooks.json");
    writeFileSync(join(home, "config.toml"), "[hooks.state.'" + hooksPath + ":stop:0:0']\ntrusted_hash = \"sha256:global\"\n", "utf8");
    writeFileSync(join(home, "sakana.config.toml"), "approvals_reviewer = \"auto_review\"\n\n# haya-pet live-status hooks profile. Managed by haya-pet; safe to delete.\n[[hooks.Stop]]\nmatcher = \"manual\"\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = 'old-node \"C:\\app\\haya-pet.js\" state idle'\n\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"echo user\"\n", "utf8");

    injectCodexHooks({
      nodePath: "n",
      cliPath: "c",
      codexHome: home,
      profileName: "sakana",
      commandStatePath: join(home, "command.json")
    });

    const profile = readFileSync(join(home, "sakana.config.toml"), "utf8");
    assert.ok(profile.includes('approvals_reviewer = "auto_review"'));
    assert.ok(profile.includes('matcher = "manual"'));
    assert.ok(profile.includes('command = "echo user"'));
    assert.ok(!profile.includes("haya-pet.js"));
    assert.ok(!profile.includes("sha256:global"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("injectCodexHooks still surfaces malformed global hooks.json", () => {
  const home = mkdtempSync(join(tmpdir(), "haya-codex-home-"));
  try {
    writeFileSync(join(home, "hooks.json"), "{invalid", "utf8");
    assert.throws(
      () => injectCodexHooks({
        nodePath: "n",
        cliPath: "c",
        codexHome: home,
        commandStatePath: join(home, "command.json")
      }),
      /could not update Codex hooks\.json/
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
