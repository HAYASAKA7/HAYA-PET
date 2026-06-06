# AI Pet Companion (Electron overlay)

The desktop overlay app for the AI CLI pet runtime. It hosts the daemon IPC
server, renders the global pet, shows session bubbles, and exposes the task
talk window.

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
  ├─ pet-window.js      (Layer 1: pet canvas)
  ├─ session-bubbles.js (Layer 2: bubbles)
  └─ task-talk-window.js(Layer 3: control surface)
```

## Run

Electron is not part of the dependency-light core and is not installed by the
root workspace. Install it inside this app first:

```bash
cd apps/companion
npm install
npm start          # electron .
```

Requires Electron ≥ 28 (for ESM main-process support) and Node ≥ 18.

Then, from any terminal, launch an AI CLI through the wrapper so the pet
reflects it:

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

- The overlay never steals focus (`focusable: false` on supported platforms).
- The reply button is gated by adapter capability: wrapper-only clients show
  "Open terminal to reply" instead of injecting text blindly.
- Approvals require explicit user action and are never auto-approved.
- All IPC is local-only; nothing is sent to the network.
