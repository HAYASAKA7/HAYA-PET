# Architecture

How AI Pet is put together. For installing and using it, see the
[README](../README.md); this doc is for contributors and the curious.

## Pipeline

```text
AI terminal clients
    → client adapters        (normalize behavior into a common event model)
    → ai-petd daemon         (sessions, priority, pet state, IPC)
    → shared pet runtime     (assets, animation, interaction)
    → desktop overlay        (global pet + session bubbles)
```

You launch any AI CLI through the `ai-pet` wrapper. The wrapper registers a
session and reports lifecycle/activity events to the daemon over local IPC (a
named pipe on Windows, a unix socket elsewhere). The first `ai-pet run`
**auto-starts the daemon/overlay**, so users only ever type `ai-pet run …`.

| Component | Responsibility |
|---|---|
| `ai-pet` (CLI) | Wrapper: launches clients, registers sessions, reports events, auto-starts the companion. |
| `ai-petd` (companion) | Global daemon + overlay: owns sessions, pet state, windows, IPC. |
| adapters | Translate client-specific behavior into the common state model. |
| pet-core | Loads pet assets, computes frames, drives animation state. |
| session-core | Tracks sessions, priority, summaries, bubble view models, linger. |
| task-core | Task status, events, approvals, replies, control gating (reply/approval UI is parked). |
| platform-core | Per-OS paths, capabilities, and fallback tiers. |

## Normalized state model

Every client maps to a shared state vocabulary that drives the pet animation and
the bubble status icons:

`idle`, `thinking`, `running_tool`, `editing_files`, `waiting_user`,
`waiting_approval`, `reviewing`, `compacting`, `failed`, `success`, `stale`,
`exited`.

Bubbles collapse these into four status kinds: **working** (spinner), **done**
(check), **attention** (yellow), **failed** (red cross).

## Adapter support tiers

The daemon never bakes in client-specific logic; adapters provide as much fidelity
as each client allows:

| Tier | Source | Fidelity |
|---|---|---|
| L1 | Process wrapper (lifecycle only) | session exists / exit code |
| L2 | PTY output observation (`--observe`, default) | activity-based working/idle |
| L3 | Client logs / state files | client-specific (future) |
| L4 | Official plugin/hooks | richest (future) |

L2 is **activity-based**: any visible output → *working*; a short quiet window →
*idle*; success/failure come from the real exit code, never from scraping output
text. Keyword heuristics exist but are opt-in (unreliable on rich TUIs). See
[known-issues.md](known-issues.md) for the current L2/PTY tradeoffs.

## Overlay model

The overlay is a transparent, always-on-top window spanning the work area, kept
click-through except over the pet and bubble chips (via `setIgnoreMouseEvents`
with mouse-move forwarding). The pet is positioned inside the window and dragged
via CSS; the bubble panel is placed on whichever side of the pet has room so it
stays fully on-screen. The pet currently lives on a single display's work area.

## Distribution & runtime dependencies

- `electron` is a **runtime dependency** (not just a dev tool), because
  `ai-pet run` launches the overlay by spawning `electron <companion>`.
- `node-pty` is **optional**: live observation (L2) uses it, and degrades to L1
  lifecycle tracking when it's absent.
- Auto-start can be disabled with `AI_PET_NO_AUTOSTART=1`; `ai-pet start` /
  `ai-pet stop` control the overlay explicitly.

See [publishing.md](publishing.md) for the npm release process.

## Project structure

```text
packages/
  protocol/        IPC message types + validation
  pet-core/        atlas, manifest, validation, animator, animation-state
  session-core/    registry, priority, summaries, bubble views, linger, pet-state
  task-core/       task status, events, store, approvals, replies, controls
  adapters/        client info, heuristics, capabilities, output observer, routing
  daemon-core/     IPC server/transport, runtime bridge, singleton
  platform-core/   platform, paths, capabilities
apps/
  cli/             ai-pet entrypoint + parser (run / start / stop / pets)
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
# -> bin/Release/net10.0-windows/ai-pet-win-window-helper.exe
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

See [`../PROGRESS.md`](../PROGRESS.md) for the detailed log.
