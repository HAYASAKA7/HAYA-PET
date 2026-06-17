# Changelog

All notable changes to HAYA Pet are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

> Note: some entries originally drafted under 0.2.0 actually landed *after* the
> 0.2.0 npm publish; they are listed under 0.2.1, which is the first version that
> ships them.

## [0.3.5]

### Fixed
- **The pet no longer gets stuck on "compacting" in Claude Code.** `PreCompact`
  set the status to *compacting*, but nothing ever cleared it — Claude's `Stop`
  does not fire for a `/compact`, so the pet sat on *compacting* until the next
  prompt or the 30 s stale sweep. The Claude hook table now also subscribes
  **`PostCompact`**, split by the documented `manual`/`auto` trigger matcher: a
  **manual** `/compact` returns to *idle* (control is back at the prompt), while
  an **auto** compaction (context filled mid-turn) resumes to *thinking* and the
  next real event refines from there. Mirrors Codex, which already handled
  `PostCompact`.

### Added
- **`HAYA_PET_DAEMON_DEBUG` diagnostic.** When set to a file path, the companion
  appends one JSONL line per incoming non-heartbeat message in daemon **arrival
  order** (with `updatedAt`), making out-of-order state delivery observable. Added
  to investigate the Codex interrupt issue below.

### Known issues
- **Codex interrupt can still leave the pet "working".** On some interrupts the
  pet keeps a working state instead of *interrupted*. The transcript watcher does
  record `turn_aborted` (the "a late tool result resets it" theory was ruled out
  across 257 real aborts), so the suspect is the daemon applying state by IPC
  **arrival order**, letting a stale "working" message land after *interrupted*.
  Instrumented via `HAYA_PET_DAEMON_DEBUG`; **fix to follow shortly.** See
  `docs/known-issues.md`.

## [0.3.4]

### Fixed
- **Codex "Approve for me" status no longer depends on a timer.** The
  `PermissionRequest` hook now calls a Codex-specific reporter instead of
  emitting delayed `waiting_approval`. The wrapper resolves
  `approvals_reviewer` for the session: `auto_review` / legacy
  `guardian_subagent` reports *reviewing*, while manual review still reports
  *waiting for approval*. The daemon no longer has a deferred-state protocol or
  timer-based approval fallback.
- **Fresh Codex sessions no longer inherit status from an older active Codex
  session.** The transcript and guardian watchers now require the rollout's
  first `session_meta.timestamp` to belong to this wrapper launch, so a
  different Codex session writing `shell_command` / `thinking` after startup
  cannot make an idle pet look busy.

## [0.3.3]

### Fixed
- **Claude Code subagent completion no longer changes the main session status.**
  Claude Code can emit `SubagentStop` after the main agent has already stopped,
  so treating that event as `idle` could make the pet react to a stale subagent
  completion instead of the main agent's real state. The Claude hook adapter now
  ignores `SubagentStop`; the main turn still ends on Claude's `Stop` event.

## [0.3.2]

### Changed
- **Session bubble titles no longer run off the screen.** A long project name
  used to stretch the bubble out to the panel's full width. The title now keeps
  the **client name in full** (Codex, Claude Code, …) and shows the **project
  name capped at 10 characters** with an ellipsis when it's longer (e.g.
  `netdisk-server` → `netdisk-se...`); the complete `Client · Project` is kept
  as a hover tooltip so nothing is lost.

## [0.3.1]

### Fixed
- **Clicks pass through the empty space around the pet.** The overlay used the
  pet's whole rectangular sprite cell as its click target, so the transparent
  margins around the character still swallowed clicks meant for the window
  behind it. The pet now intercepts the mouse only where the current frame
  actually has opaque pixels — sampled live from the canvas, with no per-frame
  cost — so the catch area hugs the visible silhouette. The resize grip is
  unaffected: it still reveals and works across the pet's full bounding box.
- **Interrupting a turn no longer leaves the pet stuck "thinking".** When you
  press Esc while the agent is working — especially mid-thought, with no tool
  running — neither Claude Code nor Codex fires a hook (`Stop` only fires on a
  normal turn end), so the pet kept spinning on *thinking* until the 30 s stale
  sweep. The transcript watchers now recognise each client's interrupt marker
  (Claude's `[Request interrupted by user]` message; Codex's `turn_aborted`
  record) and report a new `interrupted` status — a red ✕ that, unlike a real
  failure, is **not** treated as a finished session, so the bubble stays put
  (the session is still alive) instead of disappearing, and returns to the live
  status as soon as you continue.

## [0.3.0]

### Fixed
- **A fresh install now shows a real pet.** The package has always shipped a
  ready-to-use pet (`assets/fallback-pet`), but discovery only scanned the
  user's pet folders (`~/.codex/pets`, `~/.haya-pet/pets`), so a new user with
  no pets got a blue "dev placeholder" box and an empty pet list instead. The
  bundled pet is now composed into discovery as a last resort — appended after
  any of the user's own pets (which still win and stay the default) and deduped
  by id — so the overlay always renders a real character out of the box.

## [0.2.8]

### Fixed
- **Scrolling the session panel no longer fights you.** With four or more
  sessions the bubble panel scrolls (introduced in 0.2.7), but two bugs made it
  unusable: the scroll position snapped back to the top on every status update,
  and a wheel scroll or scrollbar drag would "disconnect" mid-gesture and need
  restarting. Both came from the panel rebuilding its entire DOM on each refresh
  (every session push plus a 2 s linger tick). The panel now renders
  incrementally — the list and each session's bubble persist across updates and
  are mutated in place — so the scroll position holds and a gesture stays
  attached to its element. The status spinner also no longer restarts on every
  refresh.

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
