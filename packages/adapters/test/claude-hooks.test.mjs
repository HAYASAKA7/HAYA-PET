import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildClaudeHookSettings, mapClaudeEventToState } from "../src/claude-hooks.js";

test("mapClaudeEventToState covers activity events", () => {
  assert.equal(mapClaudeEventToState("UserPromptSubmit"), "thinking");
  assert.equal(mapClaudeEventToState("PostToolUse"), "thinking");
  assert.equal(mapClaudeEventToState("PostToolUseFailure"), "thinking");
  assert.equal(mapClaudeEventToState("PreCompact"), "compacting");
  assert.equal(mapClaudeEventToState("Stop"), "idle");
  assert.equal(mapClaudeEventToState("StopFailure"), "idle");
  assert.equal(mapClaudeEventToState("PermissionDenied"), "idle");
  assert.equal(mapClaudeEventToState("PermissionRequest"), "waiting_approval");
  assert.equal(mapClaudeEventToState("Unknown"), undefined);
});

test("mapClaudeEventToState ignores Claude SubagentStop", () => {
  assert.equal(mapClaudeEventToState("SubagentStop"), undefined);
});

test("mapClaudeEventToState branches PreToolUse on tool name", () => {
  assert.equal(mapClaudeEventToState("PreToolUse", "Bash"), "running_tool");
  assert.equal(mapClaudeEventToState("PreToolUse", "Edit"), "editing_files");
  assert.equal(mapClaudeEventToState("PreToolUse", "MultiEdit"), "editing_files");
});

test("mapClaudeEventToState branches Notification on type (approval vs idle)", () => {
  assert.equal(mapClaudeEventToState("Notification", "permission_prompt"), "waiting_approval");
  assert.equal(mapClaudeEventToState("Notification", "idle_prompt"), "idle");
  // Other notification types are ignored, not treated as approval.
  assert.equal(mapClaudeEventToState("Notification", "auth_success"), undefined);
});

test("mapClaudeEventToState branches PostCompact on compaction trigger", () => {
  // Manual /compact returns to an idle prompt; auto compaction resumes the turn.
  assert.equal(mapClaudeEventToState("PostCompact", "manual"), "idle");
  assert.equal(mapClaudeEventToState("PostCompact", "auto"), "thinking");
  // Unknown/missing trigger defaults to the "still working" assumption, which the
  // next real event corrects — never leaving the pet stuck on `compacting`.
  assert.equal(mapClaudeEventToState("PostCompact"), "thinking");
});

test("buildClaudeHookSettings bakes node + cli, no volatile session id", () => {
  const settings = buildClaudeHookSettings({
    nodePath: "/usr/bin/node",
    cliPath: "/app/haya-pet.js"
  });

  const cmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].type, "command");
  assert.match(cmd, /"\/usr\/bin\/node"/);
  assert.match(cmd, /"\/app\/haya-pet\.js"/);
  assert.match(cmd, /state thinking$/);
  assert.doesNotMatch(JSON.stringify(settings), /--session/);
});

test("buildClaudeHookSettings is stable across calls (for trust caching)", () => {
  const a = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" });
  const b = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" });
  assert.deepEqual(a, b);
});

test("buildClaudeHookSettings splits Notification into approval + idle matchers", () => {
  const settings = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" });
  const note = settings.hooks.Notification;
  assert.equal(note.length, 2);

  const approval = note.find((e) => e.matcher === "permission_prompt");
  const idle = note.find((e) => e.matcher === "idle_prompt");
  assert.match(approval.hooks[0].command, /state waiting_approval$/);
  assert.match(idle.hooks[0].command, /state idle --summary idle$/);
});

test("buildClaudeHookSettings splits PostCompact into manual + auto triggers", () => {
  const post = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" }).hooks.PostCompact;
  assert.equal(post.length, 2);
  const manual = post.find((e) => e.matcher === "manual");
  const auto = post.find((e) => e.matcher === "auto");
  assert.match(manual.hooks[0].command, /state idle --summary compacted$/);
  assert.match(auto.hooks[0].command, /state thinking --summary compacted$/);
});

test("buildClaudeHookSettings keeps two non-overlapping PreToolUse matchers", () => {
  const pre = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" }).hooks.PreToolUse;
  assert.equal(pre.length, 2);
  const edit = pre.find((e) => /editing_files/.test(e.hooks[0].command));
  const other = pre.find((e) => /running_tool/.test(e.hooks[0].command));
  assert.equal(edit.matcher, "Edit|Write|MultiEdit|NotebookEdit");
  assert.equal(other.matcher, "^(?!(Edit|Write|MultiEdit|NotebookEdit)$).*");
});

test("buildClaudeHookSettings subscribes to denial/failure recovery events", () => {
  const settings = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" });
  assert.match(settings.hooks.PermissionDenied[0].hooks[0].command, /state idle --summary denied$/);
  assert.match(settings.hooks.PostToolUseFailure[0].hooks[0].command, /state thinking --summary tool-failed$/);
  assert.match(settings.hooks.StopFailure[0].hooks[0].command, /state idle --summary stopped$/);
});

test("buildClaudeHookSettings includes all subscribed events", () => {
  const settings = buildClaudeHookSettings({ nodePath: "n", cliPath: "c" });
  for (const event of [
    "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "PermissionRequest", "Notification", "PermissionDenied", "PreCompact",
    "PostCompact", "Stop", "StopFailure"
  ]) {
    assert.ok(settings.hooks[event], `missing hook event ${event}`);
  }
  assert.equal(settings.hooks.SubagentStop, undefined);
});
