# Changelog

All notable changes to Haya Pet are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0]

### Changed
- **`haya-pet run` now defaults to native passthrough** (`stdio: "inherit"`). The
  wrapped CLI talks directly to your terminal, so **Shift+Tab**, mouse-wheel
  scroll, and word-edit all work normally. PTY observation is now opt-in via
  `--observe` (it routes input through ConPTY on Windows, which can mangle special
  keys — use it only for non-interactive runs).

### Added
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
  says so (Codex allows only one profile). **Current Codex coverage:** `thinking`
  (turn start / after tools) and `idle` (turn end) fire; `running_tool` /
  `editing_files` / *waiting for approval* are wired but don't arrive yet due to an
  upstream gap where Codex's `PreToolUse`/`PermissionRequest` hooks don't fire
  ([openai/codex#16732](https://github.com/openai/codex/issues/16732)) — they'll
  light up automatically once that lands.
- **Claude Code live status via per-session hooks** (opt-in: `haya-pet hooks on`).
  Injects a stable settings file through `claude --settings <file>` — no change to
  your global config — wiring Claude's events to a new `haya-pet state` reporter so
  the pet shows thinking / running tools / editing files / waiting for approval,
  with full terminal fidelity (no PTY). First run shows Claude's one-time
  *review hooks* prompt; approve it once.
- **`haya-pet state <state>` command** — reporter used by client hooks to push live
  status to the daemon over IPC.
- **L3 transcript watcher** — tails Claude's session JSONL to reliably clear
  *waiting for approval* when a permission is **denied** (Claude fires no hook on a
  manual denial). Ground-truth based, never a timer, so a genuinely-pending
  approval keeps alerting until you actually decide.
- **`PermissionRequest` hook** for a snappier *waiting for approval* cue (fires the
  instant the dialog appears, ahead of the notification).
- **`HAYA_PET_HOOK_DEBUG=<file>`** — append one JSONL line per status event
  (hook- and transcript-sourced) for diagnostics.

### Fixed
- Claude Code TUI accepted no keyboard input when hooks were injected — caused by a
  volatile per-session argument and temp path that re-triggered Claude's hook-trust
  review every launch. Hook commands and the settings path are now stable; the
  session id is passed via the `HAYA_PET_SESSION_ID` env var.
- Pet stuck on *waiting for approval* after a manual denial (see transcript watcher
  above).
- `Notification` events other than permission prompts (e.g. `idle_prompt`) were
  mislabeled as *waiting for approval*; they are now mapped correctly.

### Notes
- Codex and Antigravity have no hook adapter yet — they use native passthrough with
  lifecycle status, or `--observe` for coarse PTY activity. Hook adapters for them
  are a planned follow-up.

## [0.1.0]
- Initial generic AI CLI pet runtime: overlay companion, session bubbles, daemon
  IPC, client adapters, pet asset pipeline, cross-OS paths.
