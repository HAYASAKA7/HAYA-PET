# Architecture

How HAYA Pet is put together. For installing and using it, see the
[README](../README.md); this doc is for contributors and the curious.

## Pipeline

```text
AI terminal clients
    → client adapters        (normalize behavior into a common event model)
    → haya-petd daemon         (sessions, priority, pet state, IPC)
    → shared pet runtime     (assets, animation, interaction)
    → desktop overlay        (global pet + session bubbles)
```

You launch any AI CLI through the `haya-pet` wrapper. The wrapper registers a
session and reports lifecycle/activity events to the daemon over local IPC (a
named pipe on Windows, a unix socket elsewhere). The first `haya-pet run`
**auto-starts the daemon/overlay**, so users only ever type `haya-pet run …`.

| Component | Responsibility |
|---|---|
| `haya-pet` (CLI) | Wrapper: launches clients, registers sessions, reports events, auto-starts the companion. |
| `haya-petd` (companion) | Global daemon + overlay: owns sessions, pet state, windows, IPC. |
| adapters | Translate client-specific behavior into the common state model. |
| pet-core | Loads pet assets, computes frames, drives animation state. |
| session-core | Tracks sessions, priority, summaries, bubble view models, linger. |
| task-core | Task status, events, approvals, replies, control gating (reply/approval UI is parked). |
| platform-core | Per-OS paths, capabilities, and fallback tiers. |

## Normalized state model

Every client maps to a shared state vocabulary that drives the pet animation and
the bubble status icons:

`idle`, `thinking`, `running_tool`, `editing_files`, `waiting_user`,
`waiting_approval`, `reviewing`, `compacting`, `failed`, `interrupted`,
`success`, `stale`, `exited`.

Bubbles collapse these into four status kinds: **working** (spinner), **done**
(check), **attention** (yellow), **failed** (red cross).

## Adapter support tiers

The daemon never bakes in client-specific logic; adapters provide as much fidelity
as each client allows:

| Tier | Source | Fidelity |
|---|---|---|
| L1 | Process wrapper (lifecycle only) | session exists / exit code |
| L2 | PTY output observation (`--observe`, opt-in) | activity-based working/idle |
| L3 | Client logs / state files / process tree | transcript watchers (Claude denial, Codex tools) + approval-accept detection |
| L4 | Client hooks | richest — implemented for Claude Code (full) and Codex (partial) |

The **default** is native passthrough (`stdio: "inherit"`) for full terminal
fidelity, with **L1 lifecycle** status for every client. Richer status is opt-in:
**Claude Code** and **Codex** gain **L4 hooks** when enabled with the global
`haya-pet hooks on` (persisted; or per-run via `HAYA_PET_HOOKS=1`). Both report
in-session activity through the shared, client-agnostic `haya-pet state` command
(lifecycle still comes from the wrapper's exit code); any client gains **L2** with
`--observe`. Hooks are opt-in because injecting them triggers the client's one-time
*review hooks* trust prompt.

The injection mechanism differs per client. **Claude Code** takes a stable
`claude --settings <file>`. **Codex** has no per-invocation settings flag, so the
wrapper merges stable user-level hooks into `$CODEX_HOME/hooks.json`. Before
regenerating HAYA-managed entries, the Codex injector reuses the already-installed
HAYA command path while its Node binary and CLI file still exist, and it skips the
write when the merged JSON is unchanged; this keeps Codex's hook-trust hash stable
across Node manager, Node version, and launcher-path churn. Codex loads that hook
source alongside any selected `-p`/`--profile`, so custom profiles remain available
while HAYA Pet still sets the per-session environment and watchers. Codex stores
reviewed hook hashes in the active config layer; when a named profile is selected,
HAYA Pet mirrors the already-trusted `hooks.json` state from base `config.toml`
into that profile so users do not have to re-approve the same hooks.
Codex's hook command must be unquoted at the program position (it runs via
`cmd /c`, which strips a leading quote) and its matchers can't use look-around
(Rust regex) — see [known-issues.md](known-issues.md). Codex's L4 is **partial**:
`PreToolUse` doesn't fire upstream yet, so tool activity comes from an L3
transcript watcher tailing the session rollout; the same watcher also treats
`token_count` rate-limit markers and empty `task_complete` records as turn-ending
signals, reporting usage/provider-limit failures as the existing non-terminal
`interrupted` state so provider-side warnings do not leave the pet thinking and
do not make the live session bubble disappear as a finished failure.
`PermissionRequest` fires, but once at approval-request creation — before Codex routes the request to either
the user or its guardian auto-reviewer ("Approve for me"), which never prompts
the user at all. The hook therefore calls a Codex-specific permission reporter:
when the resolved Codex config says `approvals_reviewer = "auto_review"` (or the
legacy `guardian_subagent` alias), it reports `reviewing`; otherwise it reports
`waiting_approval`. An L3 **guardian-trunk watcher** tails the guardian's own
rollout (`source: {subagent:{other:"guardian"}}`, parented to the main thread)
and refines the state from real review events: review running → `reviewing`,
verdict allow → `running_tool`, verdict deny → `thinking`.

Hooks alone can't see one moment: clients emit **no event when the user accepts a
permission prompt** (denial and completion are observable; the accept click is
not). The companion bridges it with **L3 process-tree observation**: while a
session sits in `waiting_approval`, it polls the client's process subtree (the
wrapper reported the pid at register), and when a new descendant process appears
and persists across two polls — the approved command verifiably running — the
session flips to `running_tool`. No timers: an unanswered prompt keeps warning
until a real event resolves it (`approval-process-watcher.js`,
`process-snapshot.js`; Windows/macOS/Linux listers).

L2 is **activity-based**: any visible output → *working*; a short quiet window →
*idle*; success/failure come from the real exit code, never from scraping output
text. It is opt-in because routing input through a PTY (ConPTY on Windows) breaks
special keys like Shift+Tab — see [known-issues.md](known-issues.md) for the
L2/PTY tradeoffs.

## Overlay model

The overlay is a transparent, always-on-top window spanning the work area, kept
click-through except over the pet and bubble chips (via `setIgnoreMouseEvents`
with mouse-move forwarding). Over the pet the hit test is **pixel-precise**: the
renderer samples the live canvas (`getImageData`) at the cursor and only
intercepts where the current frame has opaque pixels, so the transparent margins
of the sprite cell pass clicks through too. The press/drag is held interactive
for its whole duration (the running frames have a different silhouette), and the
resize grip keeps its own bounding-box reveal so pixel precision never hides it
(`pet-hit-test.js`, `pet-window.js`). The pet is positioned inside the window and
dragged via CSS; the bubble panel is placed on whichever side of the pet has room
so it stays fully on-screen. The pet currently lives on a single display's work
area.

The companion treats the overlay BrowserWindow as replaceable runtime state. If a
real renderer or GPU process crash (`crashed`, `oom`, `launch-failed`, or
`integrity-failure`) blanks the transparent surface while the daemon stays alive,
the main process logs the event to `overlay-crash.log`, destroys the dead window,
recreates it, and re-homes it onto a valid display without overwriting the user's
preferred display. Normal app shutdown is ignored, duplicate GPU+renderer events
are coalesced, and a small consecutive-crash cap prevents a recreate loop.

The bubble panel shows at most three sessions and scrolls for the rest (capped
by the smaller of a height budget and a count budget, see
`bubble-list-viewport.js`). It renders **incrementally** — the list element and
each session's bubble persist across updates and are mutated in place rather
than rebuilt — because status pushes and a 2 s linger tick arrive constantly,
and replacing the node under the cursor would drop an in-progress scroll
gesture and reset the scroll position.

## Distribution & runtime dependencies

- `electron` is a **runtime dependency** (not just a dev tool), because
  `haya-pet run` launches the overlay by spawning `electron <companion>`.
- `node-pty` is **optional**: live observation (L2) uses it, and degrades to L1
  lifecycle tracking when it's absent.
- Auto-start can be disabled with `HAYA_PET_NO_AUTOSTART=1`; `haya-pet start` /
  `haya-pet stop` control the overlay explicitly.

See [publishing.md](publishing.md) for the npm release process.

## Project structure

```text
packages/
  protocol/        IPC message types + validation
  pet-core/        atlas, manifest, validation, animator, animation-state
  session-core/    registry, priority, summaries, bubble views, linger, pet-state
  task-core/       task status, events, store, approvals, replies, controls
  adapters/        client info, heuristics, capabilities, output observer, routing
  daemon-core/     IPC server/transport, runtime bridge, singleton,
                   approval process watcher (waiting_approval -> running_tool)
  platform-core/   platform, paths, capabilities, process snapshots (win/mac/linux)
apps/
  cli/             haya-pet entrypoint + parser (run / start / stop / pets)
  companion/       Electron overlay app (main + renderer)
  pet-preview/     static preview scaffold
native/
  win-window-helper/   Windows terminal-window helper (.NET, implemented)
  mac-window-helper/   macOS helper (contract documented)
  linux-window-helper/ Linux X11/Wayland helper (contract documented)
assets/
  fallback-pet/    bundled fallback pet manifest
```

There are no per-package `package.json` files — packages import each other by
relative path, which is also why the whole tree ships as one npm package.

## Platform support

| Feature | Windows | macOS | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Protocol / session core | ✅ | ✅ | ✅ | ✅ |
| Generic CLI wrapper | ✅ | ✅ | ✅ | ✅ |
| Local daemon IPC | named pipe | unix socket | unix socket | unix socket |
| Transparent overlay | ✅ | ✅ | ✅ | best-effort |
| Terminal attachment | ✅ helper | 🔜 | 🔜 | fallback |

See [cross-os-qa.md](cross-os-qa.md) for the full test matrix.

## Native window helpers

Optional per-OS helpers locate terminal windows so bubbles can attach near them.

```powershell
# Windows (.NET SDK 10, net10.0-windows):
cd native\win-window-helper
dotnet build -c Release
# -> bin/Release/net10.0-windows/haya-pet-win-window-helper.exe
```

macOS (Swift/AppKit) and Linux (X11/Wayland) helpers have documented contracts
but are not yet implemented.

## Status & roadmap

Implemented and tested: shared core, CLI wrapper (run/start/stop/pets),
auto-start, daemon IPC + shutdown, adapters, PTY-based live observation,
Codex-style session bubbles, the Electron overlay, and the Windows terminal
helper. In progress:

- Bidirectional IPC so the daemon routes replies/approvals back to the wrapper
  (re-enabling the parked reply/approval UI).
- macOS (Swift/AppKit) and Linux X11 terminal helpers.
- Faithful PTY passthrough (see [known-issues.md](known-issues.md)).
- Production overlay/IPC validation across all platforms.

### Deferred: focus a session's terminal on bubble click

Clicking a session bubble should raise/focus the terminal window running that
session. Deferred because it can't be done as a clean cross-OS feature yet:

- **Windows** — doable now: the helper already *locates* the window (HWND); add a
  `focus` op that calls `SetForegroundWindow` (+ the usual `AllowSetForegroundWindow`
  / attach-thread-input dance), then wire bubble click → IPC → helper.
- **macOS** — needs an (unbuilt) Accessibility/window-list helper and a
  user-granted Accessibility permission.
- **Linux X11** — needs the (unbuilt) X11 helper (EWMH `_NET_ACTIVE_WINDOW`).
- **Linux Wayland** — blocked by the compositor security model; no portable API to
  focus another app's window.

Implementation sketch when picked up: bubble `click` in `session-bubbles.js` →
`haya-pet:focus-session` IPC with `sessionId` → main resolves `session.pid`
(/`terminalPid`) → terminal helper `focus` op (per-OS), with a graceful no-op
where unsupported.

### Deferred: per-session token usage

Show each session's token usage on its bubble. Feasible as an **L3 client-log
adapter** (`source: "client_log"`) — and it's cross-OS, since only the log path
differs by client, not by OS. There is no generic source: the process wrapper
only sees terminal bytes, so usage must come from each client's own logs.

- **Claude Code** — confirmed: per-turn `usage` (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`) in
  `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Clean JSONL to parse.
- **Codex** — usage exists in its logs (`~/.codex/history.jsonl`, `sessions/`,
  sqlite) but in a messier shape; needs a dedicated adapter + investigation.
- **Generic / other clients** — no reliable source; the adapter should no-op.

Implementation sketch when picked up: a per-client usage adapter tails the
session's transcript (matched via the session's `cwd` → the newest `.jsonl` in
that project dir), sums usage across turns, and emits an optional `usage` field
(protocol addition) → `session-core` stores it → the bubble renders it
(e.g. `↑ in / ↓ out`). Open questions: (1) which metric to surface — cache-read
tokens are huge under prompt caching, so likely show output + input, with total
context separate; (2) disambiguating multiple concurrent sessions in the same
project dir (by start time / newest file). The JSONL parser is pure and
TDD-friendly. Investigate non-Claude client adapters (Codex, etc.) as part of
this.

See [`../PROGRESS.md`](../PROGRESS.md) for the detailed log.
