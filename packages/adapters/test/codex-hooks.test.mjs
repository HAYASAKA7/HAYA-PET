// SPIKE tests for the Codex hook adapter prototype.
import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  buildCodexHookConfigArgs,
  buildCodexHookSettings,
  mapCodexEventToState,
  serializeCodexHooksToml
} from "../src/codex-hooks.js";

test("buildCodexHookConfigArgs emits one TOML override per hook event", () => {
  const args = buildCodexHookConfigArgs({
    hooks: {
      Stop: [{
        matcher: "manual",
        hooks: [{
          type: "command",
          command: 'C:\\node.exe "C:\\pet\\hook.js" state idle',
          statusMessage: "HAYA Pet live status"
        }]
      }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node pet.js state thinking" }] }]
    }
  });

  assert.deepEqual(args.filter((value) => value === "-c"), ["-c", "-c"]);
  assert.match(args[1], /^hooks\.Stop=\[/);
  assert.match(args[1], /matcher = "manual"/);
  assert.match(args[1], /statusMessage = "HAYA Pet live status"/);
  assert.match(args[1], /C:\\\\node\.exe/);
  assert.match(args[3], /^hooks\.UserPromptSubmit=\[/);
});

test("buildCodexHookConfigArgs serializes supported scalar values and rejects unsupported ones", () => {
  const [flag, value] = buildCodexHookConfigArgs({
    hooks: { Stop: [{ enabled: true, priority: 1, hooks: [] }] }
  });

  assert.equal(flag, "-c");
  assert.match(value, /enabled = true/);
  assert.match(value, /priority = 1/);
  assert.throws(
    () => buildCodexHookConfigArgs({ hooks: { Stop: [{ value: undefined }] } }),
    /Unsupported TOML value/
  );
});

test("mapCodexEventToState covers activity events", () => {
  assert.equal(mapCodexEventToState("UserPromptSubmit"), "thinking");
  assert.equal(mapCodexEventToState("PostToolUse"), "thinking");
  assert.equal(mapCodexEventToState("PermissionRequest"), undefined);
  assert.equal(mapCodexEventToState("PreCompact"), "compacting");
  assert.equal(mapCodexEventToState("PostCompact"), "thinking");
  assert.equal(mapCodexEventToState("SubagentStart"), "running_tool");
  assert.equal(mapCodexEventToState("SubagentStop"), "thinking");
  assert.equal(mapCodexEventToState("Stop"), "idle");
  assert.equal(mapCodexEventToState("Unknown"), undefined);
});

test("mapCodexEventToState branches PreToolUse on tool name (apply_patch vs command)", () => {
  assert.equal(mapCodexEventToState("PreToolUse", "apply_patch"), "editing_files");
  assert.equal(mapCodexEventToState("PreToolUse", "shell_command"), "running_tool");
  assert.equal(mapCodexEventToState("PreToolUse", "read_file"), "running_tool");
});

test("mapCodexEventToState branches PostCompact on compaction trigger", () => {
  assert.equal(mapCodexEventToState("PostCompact", "manual"), "idle");
  assert.equal(mapCodexEventToState("PostCompact", "auto"), "thinking");
  assert.equal(mapCodexEventToState("PostCompact"), "thinking");
});

test("Stop is the only idle signal — SubagentStop stays working", () => {
  // Regression guard for the key Codex-vs-Claude difference: a subagent finishing
  // mid-turn must NOT flip the pet to idle.
  assert.notEqual(mapCodexEventToState("SubagentStop"), "idle");
  assert.equal(mapCodexEventToState("Stop"), "idle");
});

test("buildCodexHookSettings bakes node + cli, no volatile session id", () => {
  const settings = buildCodexHookSettings({
    nodePath: "/usr/bin/node",
    cliPath: "/app/haya-pet.js"
  });

  const cmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].type, "command");
  // Program (node) must be UNQUOTED and must not lead with a quote — cmd /c on
  // Windows strips a leading quote and breaks the hook. The cli path is quoted.
  assert.doesNotMatch(cmd, /^"/);
  assert.match(cmd, /^\/usr\/bin\/node /);
  assert.match(cmd, /"\/app\/haya-pet\.js"/);
  assert.match(cmd, /state thinking$/);
  assert.doesNotMatch(JSON.stringify(settings), /--session/);
});

test("buildCodexHookSettings is stable across calls (for hook-trust caching)", () => {
  const a = buildCodexHookSettings({ nodePath: "n", cliPath: "c" });
  const b = buildCodexHookSettings({ nodePath: "n", cliPath: "c" });
  assert.deepEqual(a, b);
});

test("buildCodexHookSettings splits PreToolUse into edit + command matchers", () => {
  const pre = buildCodexHookSettings({ nodePath: "n", cliPath: "c" }).hooks.PreToolUse;
  assert.equal(pre.length, 2);
  const edit = pre.find((e) => /editing_files/.test(e.hooks[0].command));
  const other = pre.find((e) => /running_tool/.test(e.hooks[0].command));
  assert.equal(edit.matcher, "apply_patch");
  assert.equal(other.matcher, "shell_command");
});

test("buildCodexHookSettings splits PostCompact into manual + auto triggers", () => {
  const post = buildCodexHookSettings({ nodePath: "n", cliPath: "c" }).hooks.PostCompact;
  assert.equal(post.length, 2);
  const manual = post.find((e) => e.matcher === "manual");
  const auto = post.find((e) => e.matcher === "auto");
  assert.match(manual.hooks[0].command, /state idle --summary compacted$/);
  assert.match(auto.hooks[0].command, /state thinking --summary compacted$/);
});

test("buildCodexHookSettings routes PermissionRequest through the Codex reporter", () => {
  const permission = buildCodexHookSettings({ nodePath: "n", cliPath: "c" }).hooks.PermissionRequest;
  assert.equal(permission.length, 1);
  assert.match(permission[0].hooks[0].command, /codex-permission-request$/);
  assert.doesNotMatch(permission[0].hooks[0].command, /--defer-ms/);
});

test("no matcher uses look-around (Codex's Rust regex crate rejects it)", () => {
  // Regression guard: a `(?!…)` / `(?=…)` matcher is a hard parse error in Codex
  // and disables that hook. Keep all matchers look-around-free.
  const settings = buildCodexHookSettings({ nodePath: "n", cliPath: "c" });
  for (const entries of Object.values(settings.hooks)) {
    for (const entry of entries) {
      if (entry.matcher !== undefined) {
        assert.doesNotMatch(entry.matcher, /\(\?[=!<]/, `look-around in matcher "${entry.matcher}"`);
      }
    }
  }
});

test("serializeCodexHooksToml emits [[hooks.X]] tables with unquoted program", () => {
  const settings = buildCodexHookSettings({
    nodePath: "C:\\nodedir\\node.exe",
    cliPath: "C:\\app\\haya-pet.js"
  });
  const toml = serializeCodexHooksToml(settings, { header: "test header" });

  assert.match(toml, /^# test header\n/);
  assert.match(toml, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.match(toml, /\[\[hooks\.UserPromptSubmit\.hooks\]\]/);
  assert.match(toml, /type = "command"/);
  // matcher present for PreToolUse
  assert.match(toml, /matcher = "apply_patch"/);
  // The command value (a TOML basic string) must NOT start with an escaped quote
  // right after the opening quote — i.e. the program is unquoted: command = "C:\\...
  const cmdLine = toml.split("\n").find((l) => l.startsWith("command ="));
  assert.doesNotMatch(cmdLine, /^command = "\\"/);
  // Backslashes are TOML-escaped (doubled).
  assert.match(toml, /C:\\\\nodedir\\\\node\.exe/);
});

test("serializeCodexHooksToml round-trips backslashes/quotes safely", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ type: "command", command: 'a\\b "c"' }] }] } };
  const toml = serializeCodexHooksToml(settings);
  // a\b "c"  ->  "a\\b \"c\""
  assert.match(toml, /command = "a\\\\b \\"c\\""/);
});

test("buildCodexHookSettings includes Codex's event set (and omits Claude-only events)", () => {
  const settings = buildCodexHookSettings({ nodePath: "n", cliPath: "c" });
  for (const event of [
    "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
    "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop"
  ]) {
    assert.ok(settings.hooks[event], `missing hook event ${event}`);
  }
  // Claude-only events Codex does not emit must not be registered.
  for (const event of ["Notification", "PermissionDenied", "PostToolUseFailure", "StopFailure"]) {
    assert.equal(settings.hooks[event], undefined, `unexpected Claude-only event ${event}`);
  }
});
