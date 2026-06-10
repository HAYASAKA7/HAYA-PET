# Changelog

All notable changes to Haya Pet are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

> Note: some entries originally drafted under 0.2.0 actually landed *after* the
> 0.2.0 npm publish; they are listed under 0.2.1, which is the first version that
> ships them.

## [0.2.1]

### Added
- **Approval-accept detection** — when you **approve** a permission prompt for a
  command, the pet now flips from *waiting for approval* to *working* a couple of
  seconds after the command actually starts, instead of showing "waiting" for the
  tool's whole run. Clients emit **no event at the accept moment** (verified for
  Claude Code: no hook, no transcript record; `PostToolUse` only fires when the
  tool *finishes*) — so for a long approved build/test the pet used to sit on
  "waiting" for minutes. Detection is **event-based, never a timer**: while a
  session waits, the companion watches the client's **process tree**, and only a
  new process that verifiably starts under the client (and survives two
  consecutive polls, filtering hook blips) counts as an approval. An unanswered
  prompt spawns nothing, so the warning stays up until you actually decide.
  In-process approvals (file edits) aren't detected but complete in milliseconds
  after approval anyway. Windows verified live; macOS (`ps`) and Linux (`/proc`)
  listers are included pending live hardware verification. Details in
  `docs/known-issues.md`.
- **`haya-pet hooks on` / `off` / `status`** — persists the live-status preference,
  so you enable it once instead of setting an env var every shell. The toggle is
  **global**: it covers every hook-capable client (Claude Code and Codex).
  `HAYA_PET_HOOKS=1` (on) / `HAYA_PET_NO_HOOKS=1` (off) still work as per-run overrides.
- **Codex live status via per-session hooks** (opt-in: `haya-pet hooks on`). haya-pet
  injects a stable `~/.codex/haya-pet.config.toml` profile and launches
  `codex -p haya-pet`, layering the hooks on top of your base config (auth/model/MCP
  untouched). The hooks report through the same `haya-pet state` reporter, with full
  terminal fidelity. First run shows Codex's one-time *review hooks* prompt; approve
  it once. If you already pass your own `-p/--profile`, haya-pet skips injection and
  says so (Codex allows only one profile). Hooks cover `thinking` (turn start /
  after tools) and `idle` (turn end); a **Codex transcript watcher** fills in tool
  activity (`running_tool` / `editing_files`) by tailing the session JSONL, since
  Codex's `PreToolUse` hook doesn't fire upstream yet
  ([openai/codex#16732](https://github.com/openai/codex/issues/16732)).
  *Waiting for approval* stays unavailable for Codex until that lands.
- **L3 transcript watcher (Claude Code)** — tails Claude's session JSONL to reliably
  clear *waiting for approval* when a permission is **denied** (Claude fires no hook
  on a manual denial). Ground-truth based, never a timer, so a genuinely-pending
  approval keeps alerting until you actually decide.
- **`PermissionRequest` hook** for a snappier *waiting for approval* cue (fires the
  instant the dialog appears, ahead of the notification).

### Fixed
- Pet stuck on *waiting for approval* after a manual **denial** (see the Claude
  transcript watcher above).
- Pet stuck on *waiting for approval* after an **accept**, for as long as the
  approved tool kept running (see approval-accept detection above).
- `Notification` events other than permission prompts (e.g. `idle_prompt`) were
  mislabeled as *waiting for approval*; they are now mapped correctly.

## [0.2.0]

### Changed
- **`haya-pet run` now defaults to native passthrough** (`stdio: "inherit"`). The
  wrapped CLI talks directly to your terminal, so **Shift+Tab**, mouse-wheel
  scroll, and word-edit all work normally. PTY observation is now opt-in via
  `--observe` (it routes input through ConPTY on Windows, which can mangle special
  keys — use it only for non-interactive runs).

### Added
- **Claude Code live status via per-session hooks** (opt-in: `HAYA_PET_HOOKS=1` in
  this release; 0.2.1 adds the persisted `haya-pet hooks on` toggle).
  Injects a stable settings file through `claude --settings <file>` — no change to
  your global config — wiring Claude's events to a new `haya-pet state` reporter so
  the pet shows thinking / running tools / editing files / waiting for approval,
  with full terminal fidelity (no PTY). First run shows Claude's one-time
  *review hooks* prompt; approve it once.
- **`haya-pet state <state>` command** — reporter used by client hooks to push live
  status to the daemon over IPC.
- **`HAYA_PET_HOOK_DEBUG=<file>`** — append one JSONL line per status event
  (hook- and transcript-sourced) for diagnostics.

### Fixed
- Claude Code TUI accepted no keyboard input when hooks were injected — caused by a
  volatile per-session argument and temp path that re-triggered Claude's hook-trust
  review every launch. Hook commands and the settings path are now stable; the
  session id is passed via the `HAYA_PET_SESSION_ID` env var.

### Notes
- In this release Codex and Antigravity had no hook adapter — native passthrough
  with lifecycle status, or `--observe` for coarse PTY activity. 0.2.1 adds the
  Codex adapter; Antigravity remains a planned follow-up.

## [0.1.0]
- Initial generic AI CLI pet runtime: overlay companion, session bubbles, daemon
  IPC, client adapters, pet asset pipeline, cross-OS paths.
