<div align="center">

# 🐾 Haya Pet

### One desktop companion for all your AI terminal agents

A transparent, draggable desktop pet that reflects what your AI CLIs are doing —
Codex, Claude Code, Antigravity, Aider, or any command — through one shared
runtime with client adapters.

<!-- HERO SCREENSHOT: drop a wide shot at docs/screenshots/hero.png
     (the pet on the desktop with a couple of session bubbles) -->

![Haya Pet on the desktop](docs/screenshots/hero.png)

</div>

---

## What is this?

Most "desktop pet for an AI tool" projects build one pet per tool. Haya Pet does
the opposite: it is **one AI Terminal Pet Runtime** that many AI clients plug
into through adapters.

You might be running several agents at once:

```text
Codex CLI       → backend repo
Claude Code     → frontend repo
Antigravity CLI → infra repo
Aider           → docs repo
```

Haya Pet watches all of them and presents one ambient interface:

- **One global pet** — reflects the selected or most urgent AI session; clickable,
  draggable, and position-persistent like a real desktop companion.
- **Session bubbles** — one compact bubble per active session showing client,
  project, the latest activity, and a status icon (a spinning *working* circle, a
  green *done* check, a yellow *needs you*, or a red *failed* cross). Bubbles stack
  by connect time — the newest session on top — so the stack never reshuffles while
  work is in progress. A folder button beside the pet folds them away.

## Features

- 🪟 **Transparent, frameless, always-on-top overlay** that doesn't steal focus and
  stays click-through outside the pet and bubbles.
- 🖱️ **Click / double-click / drag** — click folds/unfolds the bubbles, double-click
  expands them, drag moves the pet (position persists; bubbles stay on-screen).
- 📏 **Resizable pet** — hover the pet and drag the corner grip to scale it
  0.5×–2× for your screen; double-click the grip to reset. The size persists.
- 🟢 **Live session bubbles** with per-session status icons and a folder toggle.
- 🧠 **Normalized state model** — every client maps to a shared state vocabulary
  (`thinking`, `running_tool`, `waiting_approval`, `reviewing`, `failed`, …).
- 🧩 **Client adapters** with tiered support (process wrapper → PTY observer →
  client hooks) so the daemon never bakes in client-specific logic. Default is
  lifecycle status; richer status is opt-in (Claude Code / Codex hooks via
  `haya-pet hooks on`, or PTY `--observe` for any client).
- 🚀 **Zero-setup launch** — `haya-pet run …` auto-starts the overlay; no separate
  daemon to manage.
- 🖼️ **Codex-compatible pet assets** (1536×1872 sprite atlas, 9 actions).
- 🔒 **Local-only & private** — no prompts, files, or screenshots leave your machine.
- 🪟🍎🐧 **Cross-platform** core with per-OS adapters for IPC and windowing.

## Screenshots

<!-- Drop each PNG into docs/screenshots/ with the filename shown (~800px wide).
     Delete any row you don't have a shot for. -->

| | |
|---|---|
| **The global pet** — reacting to the highest-priority session.<br>![Pet overlay](docs/screenshots/pet-overlay.png) | **Session bubbles** — one per active session, with status icons.<br>![Session bubbles](docs/screenshots/session-bubbles.png) |
| **Folder collapsed** — bubbles tucked away beside the pet.<br>![Folder collapsed](docs/screenshots/folder-collapsed.png) | **Tray menu** — show/hide, pets, reset position, Quit.<br>![Tray menu](docs/screenshots/tray-menu.png) |

## Documentation

| Doc | What's in it |
|---|---|
| **This README** | Install + users' guide |
| [docs/architecture.md](docs/architecture.md) | How it works, components, project structure, adapter tiers, platform matrix, native helpers, roadmap |
| [docs/publishing.md](docs/publishing.md) | Releasing to npm (the tag → publish workflow) |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common fixes, incl. repairing a broken Electron install |
| [docs/known-issues.md](docs/known-issues.md) | Deferred issues with known root causes |
| [docs/cross-os-qa.md](docs/cross-os-qa.md) | Cross-OS test matrix |
| [apps/companion/README.md](apps/companion/README.md) | Companion (Electron) internals |
| [PROGRESS.md](PROGRESS.md) | Detailed development log |

---

# Users' Guide

## Requirements

| Requirement | Why |
|---|---|
| **Node ≥ 18** | Runtime + companion (Electron) |
| **npm** | Install + scripts |

> Default status is lifecycle-only and needs no extra modules. Opt-in Claude Code /
> Codex hooks (`haya-pet hooks on`) also need none. The opt-in `--observe` PTY mode uses
> `node-pty` (installed automatically when it can build; without it, `--observe`
> degrades to lifecycle-only tracking).

## Install

**From npm** *(once published — recommended for users):*

```bash
npm install -g @hayasaka7/haya-pet     # exposes the `haya-pet` command globally
```

**From source** *(current):*

```bash
git clone <repo-url> haya-pet
cd haya-pet
npm install
npm link                  # makes `haya-pet` available everywhere
```

Prefer not to link globally? Call it directly anywhere you'd type `haya-pet`:
`node <repo>/apps/cli/src/haya-pet.js`.

## Run an AI session

Just wrap any command. **The first `haya-pet run` auto-starts the pet overlay** —
there's nothing to launch first:

```bash
haya-pet run --client codex        -- codex
haya-pet run --client claude-code  -- claude
haya-pet run --client generic      -- aider
# Windows / PowerShell example:
haya-pet run --client generic      -- powershell -Command "Start-Sleep 10"
```

A **session bubble** appears while the command runs (client · project · status),
and the pet reflects the highest-priority session. On exit the bubble briefly
shows success (a green check) or failure (a red cross), then fades.

> If the overlay can't be started (e.g. Electron is missing), your command still
> runs normally and keeps its exit code — you just won't see the pet. Disable
> auto-start with `HAYA_PET_NO_AUTOSTART=1`, or launch it yourself with `haya-pet start`.

### Live activity status

`haya-pet run` uses **native passthrough by default** — the CLI talks directly to
your terminal, so every input mode (Shift+Tab, mouse wheel, word-edit) works
exactly as it does without the wrapper. Out of the box, every client shows
**lifecycle status** (a session bubble while it runs; success/failure from the
real exit code, never from scraping "error" out of output).

```bash
haya-pet run --client claude-code -- claude   # full fidelity, lifecycle status
haya-pet run --client codex       -- codex    # full fidelity, lifecycle status
```

Two **opt-in** ways to get richer *in-session* status (thinking / running tools /
editing files / waiting for approval):

```bash
# Claude Code AND Codex — live status via per-session hooks, NO terminal-fidelity
# tradeoff. Enable once (persisted, global); the first run for each client shows a
# one-time "review hooks" prompt you approve once.
haya-pet hooks on
haya-pet run --client claude-code -- claude
haya-pet run --client codex       -- codex
#   (per-run override without persisting: HAYA_PET_HOOKS=1 …, or $env:HAYA_PET_HOOKS=1 in PowerShell)
#   (turn back off: haya-pet hooks off   ·   check: haya-pet hooks status)

# Any client — coarse live status by watching output through a PTY.
haya-pet run --observe --client codex -- codex
```

> **Codex coverage.** Codex shows `thinking` (working) and `idle` (done) via hooks,
> plus `running_tool` / `editing_files` via a session-transcript watcher.
> *Waiting for approval* doesn't arrive yet because of an upstream gap where
> Codex's `PermissionRequest` hook doesn't fire
> ([openai/codex#16732](https://github.com/openai/codex/issues/16732)); it'll start
> working automatically once Codex fixes it. Also: if you pass your own
> `-p/--profile` to codex, haya-pet skips hook injection (Codex allows one
> profile) and tells you. Claude Code has full coverage.

> **Approval prompts resolve correctly** (Claude Code): deny → the pet returns to
> idle the moment the denial lands in the session transcript; accept a command →
> the pet flips to *working* a couple of seconds after the approved command
> actually starts running (detected from the client's process tree — a real
> event, never a timeout, so an unanswered prompt keeps warning until you decide).

> **Why opt-in?**
> - **Hooks (Claude Code / Codex):** injecting hooks makes the client show a
>   one-time *review hooks* trust prompt. We don't disrupt your session by default;
>   turn it on once with `haya-pet hooks on` when you're happy to approve the hooks.
> - **`--observe` (any client):** PTY observation infers status from output, but on
>   Windows it routes input through ConPTY, which can break **Shift+Tab**, mouse
>   scroll, and word-edit. Use it only for non-interactive runs. See
>   [docs/known-issues.md](docs/known-issues.md).

## Add and choose a pet

A pet is a folder with `pet.json` and a 1536×1872 sprite atlas (8×9 cells of
192×208). Drop it into a search path:

```text
~/.codex/pets/my-pet/                     (Windows: %USERPROFILE%\.codex\pets\my-pet\)
    pet.json          { "id": "my-pet", "name": "My Pet", "spritesheet": "spritesheet.webp" }
    spritesheet.webp
```

Pets are discovered from `~/.codex/pets` and `~/.haya-pet/pets`. Then choose one:

```bash
haya-pet pets               # list installed pets (* = selected)
haya-pet pets use my-pet    # select; remembered on every launch
```

Your choice is stored and reused every time. You can also pick from the tray menu
→ **Installed Pets**. Without a spritesheet, the pet renders labelled placeholder
frames so everything still works.

## Interact with the pet

| Action | Result |
|---|---|
| Single click | waves + folds/unfolds the session bubbles |
| Double click | jumps + expands the bubbles |
| Drag | moves the pet; position is saved (bubbles follow, always on-screen) |
| Drag corner grip | resizes the pet 0.5×–2× (grip appears on hover); size is saved |
| Double-click grip | resets the pet to its normal size |
| Tray icon → menu | show/hide, display mode, sessions, pets, **reset position**, **Quit** |

## Stop / exit the pet

```bash
haya-pet stop      # ask the running overlay to quit
```

…or **right-click the tray icon → Quit**. `haya-pet stop` is a no-op if nothing is
running, so it's always safe to call.

## Manage the overlay

```bash
haya-pet start     # start the overlay explicitly (usually unnecessary — run auto-starts it)
haya-pet stop      # quit it
```

## Troubleshooting

Common fixes:

| Symptom | Fix |
|---|---|
| `haya-pet: command not found` | Install globally, or `npm link` in a source checkout. |
| Pet doesn't react to a session | Launch via `haya-pet run …`; check `HAYA_PET_NO_AUTOSTART` isn't set. |
| Pet shows a blue placeholder box | No spritesheet — add a pet (above). |
| Pet is off-screen | Tray menu → **Reset Position**. |
| Can't exit | `haya-pet stop` or tray → **Quit**. |

Full list (incl. repairing a broken Electron install): [docs/troubleshooting.md](docs/troubleshooting.md).

---

## Supported clients

| Client | Status | Support level |
|---|---|---|
| Generic CLI | ✅ | L1 process wrapper (+ L2 PTY via `--observe`) |
| Codex | ✅ | L1 wrapper + **L4 live-status hooks** (opt-in `haya-pet hooks on`; partial — see note) |
| Claude Code | ✅ | L1 wrapper + **L4 live-status hooks** (opt-in `haya-pet hooks on`) |
| Antigravity | ✅ | L1 wrapper (+ L2 PTY via `--observe`) |
| Gemini CLI / Aider / others | 🔜 | via the generic adapter |

(See [docs/architecture.md](docs/architecture.md) for the support tiers and the
platform matrix, and [CHANGELOG.md](CHANGELOG.md) for release notes.)

## Privacy

Haya Pet is local-only by default. It does **not** upload prompts, files,
screenshots, or session logs; it stores only short derived status summaries.
Approvals always require explicit user action.

## Contributing & tests

```bash
npm test     # runs the full suite (TDD; tests live in **/test/*.test.mjs)
```

See [docs/architecture.md](docs/architecture.md) to find your way around the code.

## License

See [`LICENSE`](LICENSE).
