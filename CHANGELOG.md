# Changelog

All notable changes to HAYA Pet are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

> Note: some entries originally drafted under 0.2.0 actually landed *after* the
> 0.2.0 npm publish; they are listed under 0.2.1, which is the first version that
> ships them.

## [Unreleased]

## [0.3.26]

### Changed
- **Provider integrations now avoid HAYA work while the companion is offline.**
  The wrapper skips hook injection and provider watchers when it cannot connect
  at startup. Hook commands use a lightweight dispatcher that exits before
  loading the full reporter when an already-running session loses the companion.
- **Codex live-status hooks are now isolated to HAYA-wrapped sessions.** HAYA
  passes stable session-layer hook overrides without consuming the user's Codex
  profile, and removes its legacy handlers from global, base, and local profile
  configuration while preserving unrelated hooks and settings. Native Codex
  sessions no longer load HAYA hooks.

### Fixed
- **Wrapped Codex now accepts HAYA hook overrides on Windows.** The shared
  Windows command runner preserves backslashes that escape quotes inside complex
  arguments, preventing Codex from parsing the hook TOML value as a string and
  failing startup with `expected a sequence`.

## [0.3.25]

### Fixed
- **Pet right-click menus now dismiss on outside clicks.** The companion no
  longer parents the pet context menu to the non-focusable transparent overlay
  window, so clicking blank desktop/app space closes the native menu instead of
  leaving it open until the pet is clicked again.

## [0.3.24]

### Fixed
- **Session overlay hover text no longer sticks or disappears completely.** The
  companion replaces native browser `title` tooltips with an app-controlled
  overlay tooltip for bubble text, status icons, the folder toggle, and the
  resize grip. The tooltip is shown only while the pointer/focus is on a labeled
  target, is included in the native window shape, and still mirrors full labels
  into `aria-label` for assistive tech.

## [0.3.23]

### Fixed
- **Session bubble expansion is no longer clipped by the native overlay shape.**
  The companion now shapes the animated bubble list from its final layout bounds
  instead of the current CSS transform box, so the expand transition can grow
  smoothly without the OS window region cutting it off mid-animation.
- **Hover affordances clear when the pointer leaves the shaped overlay.** The
  renderer now clears stale resize-grip hover state and restores click-through on
  overlay leave/blur events, while preserving pointer capture during pet or
  resize drags.

## [0.3.22]

### Fixed
- **Local Electron companions no longer share Chromium profile/cache paths with other dev Electron apps.** When HAYA Pet is launched from a source checkout or npm link, the companion now sets a dedicated Electron app name plus `userData`, `sessionData`, and `crashDumps` paths under HAYA's app-data directory before Electron is ready. That keeps Chromium cache/GPU/session/crash state out of the generic dev Electron profile and away from other local Electron apps.
- **Detached companion output is now logged.** The CLI launcher writes companion stdout/stderr to `companion.log` in the HAYA log directory instead of discarding it, so startup/native failures that do not reach `overlay-crash.log` have a place to land.

## [0.3.21]

### Fixed
- **Dragging the pet no longer exposes a desktop-sized transparent compositor surface.**
  The overlay still spans the work area for placement, but the renderer now
  reports small native shape rectangles for the pet and visible session controls.
  On Windows/Linux, Electron applies those with `BrowserWindow.setShape`, so
  areas outside the pet and bubbles are not drawable or hit-testable at the OS
  level even while a drag temporarily disables click-through. This reduces the
  rendering conflict that could blank Chromium/Electron video or terminal
  surfaces underneath HAYA Pet.
- **Show/Reset now rebuild alive-but-unpaintable overlays.** If the transparent
  surface is lost without an Electron renderer/GPU crash event, user restore
  gestures recreate the BrowserWindow before re-homing or recentering it, so
  the pet can come back even when no `overlay-crash.log` entry was written.

## [0.3.20]

### Fixed
- **Codex manual compact no longer looks like a model failure.** The Codex
  transcript watcher now treats `context_compacted` followed by an empty
  `task_complete` as compact bookkeeping, preserving the `PostCompact` hook's
  **compacted/idle** state while still reporting provider-limit empty completions
  as non-terminal **interrupted** states.

## [0.3.19]

### Fixed
- **Codex usage/provider-limit stops no longer leave the pet thinking.** HAYA Pet
  now recognizes Codex transcript `token_count` records with
  `rate_limits.rate_limit_reached_type`, third-party provider-limit turns that
  end as empty `task_complete` records, and normal `task_complete` records. The
  wrapper clears active tool state and reports the existing non-terminal
  **interrupted** state for usage/empty-response failures or **idle** for normal
  completion, so the session bubble no longer stays stuck on **thinking** and
  does not linger out as a finished failure while Codex is still open.

## [0.3.18]

### Changed
- **Session bubbles now render without the heavy drop shadow.** Removed the
  shadow from the session bubble stack and its folder toggle so the overlay reads
  flatter and cleaner beside the pet.

## [0.3.17]

### Fixed
- **Codex hook trust is now remembered across default and profiled launches.**
  HAYA Pet now keeps the generated `$CODEX_HOME/hooks.json` definition stable
  even when the wrapper is started through a different Node manager path, Node
  version, npm link, or install path. The injector reuses an already-installed
  HAYA hook command while its Node binary and CLI file still exist, and skips
  rewriting `hooks.json` when the merged JSON is unchanged. This prevents Codex
  from seeing a fresh hook definition after the user already approved the same
  HAYA hook set.
- **Codex hook trust is also mirrored into selected profiles.** Codex stores
  reviewed hook hashes in the active config layer, not only beside the shared
  `$CODEX_HOME/hooks.json` source. A named `-p`/`--profile` whose
  `<profile>.config.toml` had missing or stale `[hooks.state]` entries could
  still trigger another *review hooks* prompt; older HAYA Pet builds could also
  leave managed `[[hooks.*]]` tables embedded in profile TOML. The wrapper now
  passes the selected Codex profile to the injector. The injector removes legacy
  HAYA TOML hook tables from that profile and mirrors the existing trusted
  `hooks.json` hash blocks from base `config.toml`, while preserving unrelated
  profile settings and user hooks.

## [0.3.16]

### Fixed
- **The pet overlay now recovers after GPU or renderer crashes.** Under heavy
  GPU load, such as local image generation, Chromium's GPU or renderer process
  could die while the Electron main process, tray icon, and daemon kept running.
  The result looked like a vanished pet: **Reset Position** and relaunching
  `haya-pet` could not repaint the dead transparent surface. The companion now
  treats real GPU/renderer process exits as recoverable overlay failures,
  destroys the dead BrowserWindow, recreates it on a valid display, and keeps the
  user's preferred-display memory intact. Recovery is suppressed during normal
  app quit, deduped when GPU and renderer crash events arrive together, and capped
  after repeated failed reloads to avoid a crash-recreate loop.
- **Overlay crash diagnostics are written to disk.** Crash, recovery, and main
  process exception/rejection details are appended to `overlay-crash.log` in the
  HAYA Pet log directory so rare blank-overlay reports have evidence after the
  fact. The log path is `%LOCALAPPDATA%\haya-pet\logs\overlay-crash.log` on
  Windows and `~/.haya-pet/logs/overlay-crash.log` on macOS/Linux.

## [0.3.15]

### Fixed
- **A Codex auto-reviewer no longer shows its status on a *different* concurrent
  session.** With two Codex sessions in the same folder and live-status hooks on,
  one session's guardian ("Approve for me") review could drive the *other*
  session's bubble — surfacing *reviewing* (or the review's tool activity) on a
  session that wasn't reviewing at all. The guardian-review watcher starts at
  wrapper launch and binds its main thread on the first poll, which usually runs
  *before* the first hook records this session's `session → transcript` link. In
  that window it fell back to "newest main rollout by mtime", which — with a
  concurrent same-cwd session — could be the **other** session's main thread; that
  wrong binding was then **cached for the watcher's life**, so the authoritative
  link never got to correct it and the watcher tailed the other session's guardian
  trunk. The guardian watcher is now **link-authoritative**, exactly like the main
  transcript watcher: when a session link is configured (always, in production) it
  resolves the main thread id **only** from the link and idles until that link
  resolves — it never guesses by mtime. The mtime fallback remains solely for the
  no-link path (tests / hooks-off). This closes the residual case left by the
  0.3.9 cross-session fix; the main Codex and Claude transcript watchers were
  already link-only and were never affected. Event-backed, no timer.

## [0.3.14]

### Changed
- **The session-bubble folder now opens and closes with a smooth animation.**
  Folding or unfolding the bubbles used to pop them in and out instantly; the
  panel now grows out of (and shrinks back into) the folder button's corner with
  a light scale-and-fade — a macOS-popover feel. The transform-origin follows the
  panel's open direction and alignment, so it always springs from whichever corner
  sits against the button. The animation is GPU-composited (transform + opacity
  only, no reflow), so the folder button and the placement math stay put; the list
  also **stays mounted while collapsed**, which preserves both the scroll position
  and the live status spinner across a toggle, and it drops out of hit-testing once
  hidden so the pixel-precise click-through overlay still ignores it. A
  reduced-motion preference (`prefers-reduced-motion`) snaps the panel open/closed
  instead of animating.

## [0.3.13]

### Added
- **Right-clicking the pet now opens the tray menu.** A right-click used to behave
  like a left-click (wave + fold/unfold the bubbles). It now pops up the same
  menu as the system-tray icon — Show/Hide Pet, Active Sessions, Installed Pets,
  Reset Position, update, Quit — which is far more discoverable than the tray icon
  (often hidden in the Windows overflow). The menu is built from the one pure tray
  model, so both entry points always match. Left-click behaviour is unchanged.

## [0.3.12]

### Fixed
- **A long status or tool-call name no longer stretches the session bubble.** The
  activity line is `white-space: nowrap`, and the bubble sizes to its content, so
  a long summary (e.g. a tool call like `Read packages/session-core/src/...`)
  dragged the bubble out to its max width before the CSS ellipsis could engage.
  The status/activity text is now length-capped in the view model (`summaryLabel`,
  32 chars + `...`) exactly like the project name (`projectLabel`), so it can't
  widen the bubble; the full summary stays reachable on hover and in the expanded
  task-talk popup.

## [0.3.11]

### Fixed
- **Codex live-status hooks now work with custom profiles.** HAYA Pet no longer
  injects its own `-p haya-pet` profile or skips hooks when the wrapped Codex
  command already has `-p` / `--profile`. Instead it merges stable HAYA-managed
  hook entries into `$CODEX_HOME/hooks.json`, preserving any existing user hooks
  and leaving profile args such as `--profile fugu` untouched. The wrapper still
  resolves profile-specific `approvals_reviewer` settings so approval status
  matches the selected Codex profile.

## [0.3.10]

### Fixed
- **A running Claude Code subagent no longer drives the main session's status.**
  With hooks enabled and a multi-agent run, once the main agent had stopped but a
  subagent was still working, two things went wrong: the pet dropped to *idle*
  (even though work was ongoing), and while the subagent ran its tool calls flipped
  the pet between *running tools* / *editing files* / *thinking*. Fix, checked
  **only at the main agent's `Stop`** (no timers, no persisted state): (1) Claude's
  `Stop` payload carries a live `background_tasks` snapshot — when it still lists a
  running **subagent**, the pet shows *running tools* with the message **"Subagent
  running"**, and the follow-up `Stop` (empty `background_tasks`) clears it back to
  *idle*; (2) every subagent-originated hook event carries an `agent_id`, so the
  reporter now **drops any event with an `agent_id`**, and a subagent's activity can
  no longer overwrite the main session's status. Background **shells** are
  deliberately not surfaced (their completion isn't reliably observable). See
  `docs/known-issues.md`.

## [0.3.9]

### Fixed
- **The cross-session contamination fix now covers Codex too.** Codex had the same
  flaw fixed for Claude in 0.3.8: its transcript watcher chose the rollout by
  newest mtime + cwd, and the guardian-review watcher derived the main thread id
  from the newest main rollout — so two Codex sessions in the same folder could
  cross-report each other's `turn_aborted` (interrupt) or tool activity, with the
  idle session showing the busy one's state. Codex's command-hook payload also
  carries `transcript_path`, so the `haya-pet state` reporter's per-session
  `session → transcript` link (already written for every client) now pins the Codex
  transcript watcher to its own rollout, and the guardian watcher binds the main
  thread id from the linked rollout's `payload.id` (and only follows a trunk whose
  `parent_thread_id` matches it). Both fall back to the previous mtime+cwd heuristic
  when no link is available (e.g. `transcript_path` null early), so there is no
  regression. No timer involved.

## [0.3.8]

### Fixed
- **An interrupt or denial in one Claude Code session no longer leaks into a
  concurrent, idle one.** The transcript watcher discovered its file by "newest
  `.jsonl` by mtime in the project dir", so two Claude sessions in the same folder
  (one project dir, one transcript each) could make an idle session's watcher lock
  onto a *busy* session's transcript — then read its `[Request interrupted by
  user]` marker (or a denial) and report the wrong pet as *interrupted*. Each
  session's watcher now pins to its own transcript via the `transcript_path` Claude
  includes in every hook payload (recorded as a per-session link by the `haya-pet
  state` reporter) instead of guessing; until that link exists it idles rather than
  locking onto another session's file. (Codex had the same discovery shape — fixed
  in 0.3.9.)
- **The pet no longer disappears when the display layout changes.** The overlay
  window's bounds were set once at creation to span one display's work area and
  never re-homed, so unplugging a monitor, changing resolution/DPI, docking or
  undocking, or waking from sleep could strand it off-screen (or on a display that
  no longer exists) — the pet vanished while the process kept running, and neither
  **Show/Hide Pet** (which only flips visibility) nor **Reset Position** (which only
  moved the sprite *inside* the window) brought it back. The companion now re-homes
  the overlay onto a valid display on `screen` display add/remove/metrics-change and
  on resume from sleep, and **Reset Position** / **Show Pet** / relaunch re-home the
  window itself. Automatic re-homes preserve the preferred display, so the pet
  returns there when the monitor comes back.

## [0.3.7]

### Changed
- **The tray menu no longer shows state-only controls.** Hidden **Display Mode**
  and **Attach Bubbles to Terminals** until those settings have real runtime
  behavior. **Active Sessions** stays visible while session actions continue in a
  separate workflow.

## [0.3.6]

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
- **Codex interrupts no longer get clobbered by stale working states.** The Codex
  transcript watcher already detected `turn_aborted` and emitted
  *interrupted*, but the daemon registry applied state by IPC arrival order. A
  slower hook reporter could therefore deliver an older *thinking* / *running*
  state after the interrupt and overwrite it. The registry now keeps a separate
  per-session state timestamp and ignores state messages older than the latest
  accepted state, while heartbeats still update liveness independently.
- **Codex immediate interrupts in resumed sessions are detected.** In a resumed
  Codex session, `session_meta.timestamp` stays at the original session start.
  The prompt-start hook could still set the pet to *thinking*, but the transcript
  watcher rejected the old rollout before it could see the immediately appended
  `turn_aborted`. The watcher now also follows a fresh rollout from the wrapped
  cwd, so resumed sessions can report interrupts while unrelated old sessions
  remain filtered.
- **Codex auto-review status works in resumed sessions too.** The guardian-review
  watcher had the same old-`session_meta.timestamp` filter as the transcript
  watcher, so a resumed main rollout could be rejected before the guardian trunk
  was matched to it. The guardian watcher now uses the same fresh-mtime + wrapped
  cwd rule for resumed main sessions before following the guardian review trunk.
- **Codex hook review is one-time again.** Codex stores approved hook hashes in
  the generated `$CODEX_HOME/haya-pet.config.toml` profile under `[hooks.state]`.
  The injector used to rewrite the whole managed profile on every launch, deleting
  that trust state and forcing Codex to ask for hook review every time. The
  injector now preserves Codex's hook trust tables while regenerating the HAYA
  hook definitions.

### Added
- **`HAYA_PET_DAEMON_DEBUG` diagnostic.** When set to a file path, the companion
  appends one JSONL line per incoming non-heartbeat message in daemon **arrival
  order** (with `updatedAt`), making out-of-order state delivery observable. Added
  to investigate state-order races such as the Codex interrupt issue.

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
