// Codex CLI hook adapter. Wired into `haya-pet run --client codex` (opt-in via
// `haya-pet hooks on`); injected through codex-hook-injection.js as a profile.
//
// Mirrors claude-hooks.js: pure builders that map Codex lifecycle events onto the
// shared pet-state vocabulary and emit a hooks config. No I/O here — callers
// resolve paths and write the file. Each hook entry runs the SAME client-agnostic
// `haya-pet state` reporter with a fixed state baked into the command; the session
// id rides in via HAYA_PET_SESSION_ID (injected by the wrapper at spawn), so Codex
// never needs to pass it on stdin for our purposes.
//
// Why a Codex hook adapter is feasible (verified against codex-cli 0.137.0):
//  - Codex command hooks receive a JSON payload on stdin and treat `exit 0 with no
//    output` as success/continue — so our reporter, which prints nothing, is safe.
//  - The hooks.json / [hooks] shape is identical to Claude's settings.json hooks
//    block (per-event matcher groups of { type:"command", command }).
//  - Codex hooks are gated behind `features.hooks = true` and carry their own
//    Claude-style hook-trust prompt (bypassable with --dangerously-bypass-hook-trust).
//
// Differences from Claude that this file encodes:
//  - Event set: no Notification / PermissionDenied / *Failure; adds PostCompact /
//    SubagentStart. Turn-end is `Stop` (the only idle signal); SubagentStop is
//    mid-turn so it returns to `thinking`, not idle.
//  - Tool names: Codex uses `apply_patch` for edits and `shell_command` for
//    commands, not Claude's Edit|Write|Bash. Matchers are ANCHORED full matches
//    (a bare `shell` did NOT match `shell_command`), and Codex's Rust regex crate
//    rejects look-around — so no negative-lookahead catch-all.
//
// VERIFIED end-to-end against codex-cli 0.137.0 (interactive TUI, Windows), with
// the real `haya-pet state` reporter and HAYA_PET_HOOK_DEBUG:
//  - FIRING: UserPromptSubmit→thinking, PostToolUse→thinking, Stop→idle. Codex
//    forwards the parent env to hooks, so the session rides in via
//    HAYA_PET_SESSION_ID and the reporter exits 0 cleanly (no "hook exited 1").
//  - NOT FIRING (0.137): PreToolUse — so `running_tool` / `editing_files` never
//    arrive in practice yet (upstream coverage gap, openai/codex#16732). The
//    entries are kept (harmless no-ops) so they light up once Codex fixes it.
//  - PermissionRequest (verified live on 0.139.0, semantics from codex-rs
//    source): fires ONCE at approval-request creation, BEFORE the request is
//    routed to the guardian auto-reviewer or the user. Under "Approve for me"
//    (approvals_reviewer=auto_review, legacy alias guardian_subagent) the user
//    is never prompted at all, so this hook calls a Codex-specific permission
//    reporter instead of hard-coding waiting_approval. The wrapper passes the
//    resolved approvals reviewer mode in env; auto_review reports reviewing,
//    while manual/unknown reviewer config reports waiting_approval. The guardian
//    fires NO hooks itself (SubAgentSource::Other is excluded from Subagent
//    hooks), so the wrapper also tails the guardian rollout directly.
//  - UNTESTED: PreCompact / SubagentStart|Stop (no compaction / subagent
//    occurred in the probe).
//
// OPEN QUESTION (injection): unlike `claude --settings <file>`, Codex has no
// per-invocation settings-file flag. Candidate non-mutating paths, best first:
//   1. `codex -p haya-pet` + a generated `$CODEX_HOME/haya-pet.config.toml` profile
//      that layers ON TOP of the user's base config (auth/config preserved).
//   2. a `hooks.json` next to the active config layer ($CODEX_HOME/hooks.json) —
//      simple but global to every codex session (harmless: the reporter no-ops
//      without HAYA_PET_SESSION_ID).
// Both still trip Codex's one-time hook-trust prompt, exactly like the Claude path.

// Codex's file-editing tool(s) vs. its command tool.
const EDIT_TOOLS = ["apply_patch"];
const EDIT_TOOLS_MATCHER = EDIT_TOOLS.join("|");
// IMPORTANT: Codex compiles matchers with the Rust `regex` crate, which does NOT
// support look-around. Claude's negative-lookahead catch-all (`^(?!…).*`) is a
// hard parse error in Codex ("look-around … is not supported"), so we match the
// command tool EXPLICITLY instead of "everything that isn't an edit". Tools other
// than the command/edit tools simply don't update state on PreToolUse —
// acceptable, as PostToolUse resets to `thinking` right after.
//
// The matcher is an ANCHORED full match against the tool name (verified: a bare
// `shell` did NOT match the real tool `shell_command`). So name the tool exactly.
const COMMAND_TOOLS_MATCHER = "shell_command";

// The hook table. Each entry → one Codex hook that reports a fixed pet state.
// `matcher` (when present) filters PreToolUse by tool name. `summary` is an
// optional short label shown in the bubble and in HAYA_PET_HOOK_DEBUG logs.
const HOOK_TABLE = Object.freeze([
  { event: "UserPromptSubmit", state: "thinking" },
  { event: "PreToolUse", matcher: EDIT_TOOLS_MATCHER, state: "editing_files" },
  { event: "PreToolUse", matcher: COMMAND_TOOLS_MATCHER, state: "running_tool" },
  { event: "PostToolUse", state: "thinking" },
  { event: "PermissionRequest", command: "codex-permission-request" },
  { event: "PreCompact", state: "compacting" },
  { event: "PostCompact", state: "thinking", summary: "compacted" },
  // A subagent finishing is mid-turn — the main agent keeps working, so this is
  // NOT idle. Turn-end is the dedicated `Stop` event below.
  { event: "SubagentStart", state: "running_tool", summary: "subagent" },
  { event: "SubagentStop", state: "thinking", summary: "subagent-done" },
  { event: "Stop", state: "idle" }
]);

// Resolve the pet state for a Codex event. `toolName` is the tool for PreToolUse.
// Exposed for testing and to keep the mapping in one place.
export function mapCodexEventToState(event, toolName) {
  if (event === "PreToolUse") {
    return EDIT_TOOLS.includes(toolName) ? "editing_files" : "running_tool";
  }
  const entry = HOOK_TABLE.find((row) => row.event === event && row.matcher === undefined);
  return entry?.state;
}

// Build the hooks config object (hooks.json shape; also valid as the [hooks] table
// once serialized to TOML). Same structure as buildClaudeHookSettings, with one
// Windows-critical difference in command quoting (see below).
//
// CRITICAL (verified on Windows): Codex runs a hook `command` via `cmd /c "<cmd>"`,
// which strips the first and last quote if the string STARTS with a quote. So the
// Claude builder's `"<node>" "<cli>" …` form (leading quote on the program) gets
// mangled and the hook dies with "exited with code 1". The program (first token)
// must therefore be UNQUOTED; interior argument quotes are preserved fine.
//
// Caveat: an unquoted program breaks if nodePath itself contains spaces (e.g.
// "C:\Program Files\nodejs\node.exe"). The wrapper bakes the realpath-resolved
// node path, which is space-free for fnm/scoop/nvm layouts; a space-tolerant
// path (short 8.3 name, or `command_windows`) is a follow-up before shipping.
export function buildCodexHookSettings({ nodePath, cliPath }) {
  const stateCommand = (state, summary) => {
    // nodePath unquoted (must not lead with a quote); cliPath quoted for spaces.
    let output = `${nodePath} ${quote(cliPath)} state ${state}`;
    if (summary) {
      output += ` --summary ${summary}`;
    }
    return output;
  };
  const command = (row) => row.command
    ? `${nodePath} ${quote(cliPath)} ${row.command}`
    : stateCommand(row.state, row.summary);

  const hooks = {};
  for (const row of HOOK_TABLE) {
    const hookEntry = { hooks: [{ type: "command", command: command(row) }] };
    if (row.matcher !== undefined) {
      hookEntry.matcher = row.matcher;
    }
    (hooks[row.event] ??= []).push(hookEntry);
  }

  return { hooks };
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// Serialize a hook settings object (from buildCodexHookSettings) to the TOML form
// Codex loads from a config layer: `[[hooks.<Event>]]` (with optional `matcher`)
// each containing `[[hooks.<Event>.hooks]]` command entries. Pure (no I/O).
export function serializeCodexHooksToml(settings, { header } = {}) {
  let toml = header ? `# ${header}\n` : "";
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries) {
      toml += `[[hooks.${event}]]\n`;
      if (entry.matcher !== undefined) {
        toml += `matcher = ${tomlString(entry.matcher)}\n`;
      }
      for (const hook of entry.hooks ?? []) {
        toml += `[[hooks.${event}.hooks]]\n`;
        toml += `type = ${tomlString(hook.type)}\n`;
        toml += `command = ${tomlString(hook.command)}\n`;
      }
      toml += "\n";
    }
  }
  return toml;
}

// TOML basic-string escaping: backslash and double-quote must be escaped.
function tomlString(value) {
  return `"${String(value).split("\\").join("\\\\").split('"').join('\\"')}"`;
}
