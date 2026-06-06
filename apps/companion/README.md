# AI Pet Companion (Electron overlay)

The desktop overlay app for the AI CLI pet runtime. It hosts the daemon IPC
server, renders the global pet, and shows the session bubbles. (A reply/approval
"task talk window" is scaffolded but parked — see below.)

> Most users never launch this directly: `ai-pet run` auto-starts it. This doc
> covers its internals. For installing/using AI Pet, see the
> [root README](../../README.md) and [docs/architecture.md](../../docs/architecture.md).

## Architecture

The companion is intentionally thin glue. All decision logic lives in the
unit-tested pure packages and is imported directly:

| Concern | Source of truth |
|---|---|
| Pet atlas / frames / animation | `packages/pet-core` |
| Click vs drag | `apps/companion/src/renderer/interaction-controller.js` |
| Window options / overlay vs fallback | `src/main/window-options.js` |
| Display clamping / DPI | `src/main/display-manager.js` |
| Position persistence | `src/main/position-store.js` + `state-file.js` |
| Session bubbles | `packages/session-core/src/bubble-view.js` |
| Adapter capabilities | `packages/adapters` |
| Task status / controls / reply safety | `packages/task-core` |
| Tray menu model | `src/main/tray-menu.js` |
| Daemon singleton | `packages/daemon-core/src/singleton.js` |

```
main process (index.js)
  ├─ IPC server (daemon-core)  ← ai-pet wrappers send register/state/heartbeat
  ├─ daemon runtime + session registry
  ├─ overlay BrowserWindow  → renderer
  └─ tray + position persistence

renderer
  ├─ pet-window.js      (Layer 1: pet canvas + drag + panel placement)
  ├─ session-bubbles.js (Layer 2: bubbles + folder toggle + status icons)
  └─ task-talk-window.js(Layer 3: reply/approval surface — PARKED, not wired)
```

## Run

Normally you don't — `ai-pet run` (or `ai-pet start`) launches the overlay by
spawning Electron, which is a root runtime dependency. For development you can
still start it directly:

```bash
npm start          # electron .  (from apps/companion)
```

Requires Node ≥ 18. Then, from any terminal, launch an AI CLI through the wrapper
so the pet reflects it:

```bash
ai-pet run --client generic -- sleep 10
ai-pet run --client codex -- codex
```

## Pets

Pets are discovered from `~/.codex/pets` and `~/.ai-pet/pets`. Without a
spritesheet the renderer draws labelled placeholder frames so interactions and
state mapping remain testable. See `assets/fallback-pet/README.md`.

Select a pet from the tray menu → **Installed Pets**, or from the CLI:

```bash
ai-pet pets              # list (the * marks the selected pet)
ai-pet pets use my-pet   # persist the selection; used on next companion start
```

The selection is stored in the shared state file (`globalPet.selectedPetId`),
so the companion starts with your last selected pet.

## Safety

- The overlay never steals focus (`focusable: false` on supported platforms) and
  is click-through except over the pet and bubbles.
- All IPC is local-only; nothing is sent to the network.
- When the parked reply/approval surface is wired up, replies will be gated by
  adapter capability (wrapper-only clients can't inject text blindly) and
  approvals will always require explicit user action.
