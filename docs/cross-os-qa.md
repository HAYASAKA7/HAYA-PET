# Cross-OS QA Matrix

Use this checklist before release candidates and after changes to IPC, windowing, display handling, terminal attachment, or CLI process wrapping.

## Automated Gates

- [ ] `npm test` passes on the target branch.
- [ ] Generic command lifecycle emits register, running state, heartbeat, final state, and unregister.
- [ ] Daemon accepts local IPC messages and updates the session registry.
- [ ] CLI can run through daemon IPC without an injected sender.
- [ ] Pet preview loads a Codex-compatible `1536x1872` spritesheet.
- [ ] Pet manifest parsing and atlas/action validation pass (`pet-core`).
- [ ] Generic regex heuristics map sample output to normalized states (`adapters`).
- [ ] Task status mapping, event normalization, and control gating pass (`task-core`).
- [ ] Session bubble view models build with status label, summary, action, and elapsed (`session-core`).
- [ ] PTY output observer infers debounced `pty_output` states from sample client output (`adapters`).
- [ ] Reply/approval routing dispatches to injectors and safely refuses unsupported adapters (`adapters`).

## Manual Platform Matrix

| Platform | Shell/Terminal | Display Setup | Required Checks |
|---|---|---|---|
| Windows 11 | PowerShell | 100% DPI | `haya-pet run --client generic -- node -e "setTimeout(() => process.exit(0), 1000)"`; daemon sees session exit; overlay opens without focus stealing. |
| Windows 11 | Windows Terminal | 125% DPI | Pet drag/click/double-click; position persists after restart; terminal attachment helper reports best-effort capability. |
| Windows 11 | Windows Terminal | 150% or mixed DPI | Saved offscreen position clamps to visible work area; session bubbles remain visible. |
| macOS current stable | Terminal.app | Retina display | Unix socket IPC works; transparent overlay opens; click/drag behavior works; position persists. |
| macOS current stable | iTerm2 | External display | Moving terminal across displays does not lose session bubble fallback; permission denial produces best-effort/fallback state. |
| Ubuntu Linux X11 | GNOME Terminal | Single display | Unix socket IPC works; transparent overlay opens; X11 terminal strategy reports best-effort. |
| Ubuntu or Fedora Linux Wayland | Default terminal | Single display | Overlay fallback mode works; terminal attachment reports manual fallback; global pet plus cluster/session bubbles remain usable. |

## Release Acceptance Gates

- [ ] No platform stores prompts, screenshots, or raw terminal logs by default.
- [ ] Windows uses `\\.\pipe\haya-petd` for local IPC.
- [ ] macOS/Linux use `~/.haya-pet/haya-petd.sock` for local IPC.
- [ ] Windows state path is under `%LOCALAPPDATA%\haya-pet\state.json`.
- [ ] macOS/Linux state path is under `~/.haya-pet/state.json`.
- [ ] If transparent overlay fails, a normal companion window is available.
- [ ] If terminal attachment fails, global pet plus manual/cluster bubbles remain available.
- [ ] Wayland does not use unsupported global positioning assumptions.
- [ ] Saved display IDs are validated; missing displays fall back to primary visible work area.
- [ ] Task talk controls are hidden or disabled when adapter capability is unsupported.
- [ ] Reply composer shows "Open terminal to reply" for wrapper-only adapters (no blind injection).
- [ ] Approvals require explicit approve/deny and are never auto-approved.
- [ ] Companion runs as a single instance; a second launch focuses the existing pet.
- [ ] A stale daemon lock (dead PID) is reclaimed; a live one forwards.

## Companion App Smoke Test (per OS)

Run from `apps/companion` after `npm install`:

- [ ] `npm start` opens the overlay; empty space stays click-through.
- [ ] Single click → waving; double click → jumping; drag moves and persists.
- [ ] Running `haya-pet run --client generic -- sleep 10` shows a session bubble.
- [ ] Two concurrent sessions show two bubbles without renderer conflicts.
- [ ] Selecting a bubble opens the task talk window (peek mode).
- [ ] Tray menu can show/hide the pet and reset its position.

## Current Implementation Status

- Shared protocol/session/pet core: automated coverage exists.
- Pet asset manifest + validation + frame animator: automated coverage exists.
- Client adapters (info, generic/PTY heuristics, capabilities): automated coverage exists.
- Task talk core (status, events, store, approvals, replies, controls): automated coverage exists.
- Session summaries + bubble view models: automated coverage exists.
- Daemon singleton decision logic + tray menu model + position state file: automated coverage exists.
- Cross-OS platform paths and capabilities: automated coverage exists.
- Test-mode IPC server/client: automated coverage exists.
- Electron overlay app: implemented as glue (`apps/companion`) consuming the pure cores; requires `electron` install and manual run/QA per OS (not unit-tested).
- Production OS endpoint behavior: needs manual validation on Windows, macOS, and Linux.
- Terminal attachment: facade + documented IPC contract (`native/README.md`). Windows helper is implemented in .NET and compiles + runs; macOS/Linux helper binaries are still TODO. Node helper client (`terminal-helper-client.js`) is unit-tested.
- PTY output observer + reply/approval routing: implemented and unit-tested as pure cores. Live wiring (real PTY via node-pty; bidirectional IPC + real injectors) is a later phase.
