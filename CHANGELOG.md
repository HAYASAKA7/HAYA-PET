# Changelog

All notable changes to HAYA Pet are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

> Note: some entries originally drafted under 0.2.0 actually landed *after* the
> 0.2.0 npm publish; they are listed under 0.2.1, which is the first version that
> ships them.

## [0.2.7]

### Fixed
- **Codex `/quit` no longer hangs after its goodbye.** The `haya-pet state`
  hook reporter could hang forever on a never-settling IPC await (pipe connect,
  write drain, or close) — and Codex awaits each hook child with a default
  **600 s** timeout, so a hung turn-end `state idle` reporter both froze the
  pet on "working" and made `/quit` sit on its token-usage goodbye for up to
  10 minutes (Ctrl+C worked because it kills Codex without the wait, orphaning
  the reporter — observed live). The reporter now races its whole IPC
  interaction against a 2 s deadline and always exits; the wrapper's own
  companion connection gets the same guard (5 s) so a wedged companion can
  never hold the terminal after the wrapped CLI exits.

### Added
- **Update notice.** HAYA Pet now checks npm (at most once a day, cached in
  `state.json`, shared between the CLI and the overlay) for a newer published
  version. The CLI prints a one-line notice after a wrapped command exits (and
  after `haya-pet start`), and the tray gains an **Update Available (x.y.z)**
  item that opens the package page — the app never runs npm itself. The check
  is best-effort (3 s timeout, silent on any failure, never blocks a run),
  skipped when stdout isn't a terminal, and can be disabled with
  `HAYA_PET_NO_UPDATE_CHECK=1`.

### Changed
- **The bubble panel shows at most three sessions at once.** Beyond the existing
  height budget (the room between the folder button and the screen edge), the
  list now also caps its viewport at the bottom of the third bubble — more
  sessions are reached by scrolling, so a busy machine no longer grows a
  screen-tall stack. The list surface itself (gaps between bubbles and the
  scrollbar) is now pointer-active so wheel scrolling and scrollbar dragging
  work anywhere on the open panel, and the scrollbar is a slim dark-theme thumb
  instead of the stock bar.

## [0.2.6]

### Fixed
- **Codex "Approve for me" no longer shows a false *waiting for approval*.**
  With `approvals_reviewer = auto_review` (the TUI's "Approve for me"; legacy
  config alias `guardian_subagent`), Codex routes approval requests to a
  guardian subagent and never prompts the user — but its `PermissionRequest`
  hook still fires when the request is created, so the pet sat on *waiting for
  approval* for the entire auto-review (and the approved command's run). A new
  guardian-review watcher tails the guardian's own session rollout (the only
  persisted trace of the review) and reports event-backed states instead:
  *reviewing* while the guardian assesses, *running tools* on an `allow`
  verdict, *thinking* on a `deny` (the rejection goes back to the model — no
  human decision is pending). When the reviewer is the user (`approvals_reviewer
  = "user"`, "Ask for approval"), nothing changes: *waiting for approval* still
  shows until the user decides.

## [0.2.4]

### Fixed
- Removed the non-functional **"Open Settings"** tray item (it had no handler).
  A settings window is deferred until settings outgrow the tray; every current
  setting already has a tray, CLI, or gesture home.

## [0.2.3]

### Added
- **Drag-to-resize the pet.** Hovering the pet reveals a small grip at its
  bottom-right corner; drag it to scale the pet between 0.5× and 2× (aspect
  locked), double-click it to reset to 1×. The size persists across restarts,
  like the pet position. Only the pet scales — session bubbles keep their
  readable size and keep anchoring beside it.

## [0.2.2]

### Fixed
- **Session bubbles no longer reshuffle while sessions run.** Bubbles used to be
  sorted by state urgency and latest activity, so every status change could move
  a bubble up or down the stack mid-progress. They now stack by the time each
  session **connected to the pet** — newest on top, first one at the bottom —
  and that order stays fixed for the session's whole life. Urgency still shows
  through each bubble's status icon, the collapsed-folder summary dot, and the
  pet animation.

### Internal
- **CI on every code push** — a new GitHub Actions workflow lints and runs the
  test suite (Ubuntu + Windows + macOS, Node 20/22) for any push or PR touching
  code.
- **ESLint adopted** (`npm run lint`, flat config); the few existing findings
  were fixed with no behavior change.

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
