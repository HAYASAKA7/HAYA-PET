# Known Issues

Issues found in live use, with their current status.

## ✅ Resolved: Claude Code TUI accepted no keyboard input when hooks were injected

- **Symptom:** With per-session hooks injected by default (`claude --settings
  <tempfile>`), Claude Code launched but the interactive TUI accepted no typing —
  the session was unusable. Native passthrough *without* injection was fine.
- **Root cause:** Two compounding problems. (1) The injected hook **command string
  baked a per-session `--session <uuid>`**, and the settings file used a fresh
  `mkdtemp` path each launch — so Claude saw "new, untrusted hooks" every time and
  blocked the TUI on its *review hooks* trust prompt. (2) Injection was the
  **default**, so the very first interactive Claude run broke out of the box.
- **Fix:** (a) Hook injection is now **opt-in** via `HAYA_PET_HOOKS=1`; the default
  is native passthrough with lifecycle status, which never disrupts the session.
  (b) When enabled, the hook command string is **stable** (the session id is passed
  via the `HAYA_PET_SESSION_ID` env var, read by `haya-pet state`, instead of being
  baked in) and written to a **stable settings path**, so Claude's trust prompt
  only needs approving once rather than on every launch.

## ✅ Resolved: terminal fidelity broke under `haya-pet run` (Shift+Tab / scroll / word-edit)

- **Symptoms (older builds):** While a CLI ran under `haya-pet run` (which used to
  default to `--observe`), the terminal lost fidelity — **Shift+Tab** did nothing,
  the **mouse wheel** couldn't scroll, and **Backspace/word-editing** behaved wrong
  (e.g. deleting a whole word, or no letter-by-letter delete).
- **Root cause:** Observe mode interposed a `node-pty`/ConPTY pseudo-terminal
  (plus, on Windows, an intermediate `cmd /d /s /c "<shim>"` layer) between the host
  terminal and the interactive TUI. Special input — Shift+Tab (`ESC [ Z`),
  Alt/Ctrl word-edits, and mouse-wheel reporting — is not ordinary bytes; it must
  survive ConPTY's VT→`INPUT_RECORD`→VT round-trip, which on Windows mangles or
  drops those sequences and does not transparently pass mouse events. The fixed
  `cols × rows` grid also left the host's scrollback with nothing to scroll. This
  was **architectural**: no amount of stdin-forwarding tweaking makes the ConPTY
  round-trip lossless for mouse + special keys. The plain `stdio: "inherit"` path
  never had the problem.
- **Fix:** `haya-pet run` now defaults to **native passthrough** (`stdio: "inherit"`)
  — the CLI talks directly to your terminal, so all input modes work exactly as they
  do without the wrapper. Rich live status is available **opt-in** instead via the
  client's own hooks; for **Claude Code** these are injected **per session** via
  `claude --settings` when you set `HAYA_PET_HOOKS=1` (no change to the user's
  global config, no overhead on their other Claude sessions), which is *higher*
  fidelity than the old output scraping and costs nothing in the terminal. PTY
  observation is still available as
  an explicit opt-in (`haya-pet run --observe …`) for non-interactive runs, where the
  fidelity tradeoff doesn't matter.
- **Native-mode follow-ups (also fixed):** the wrapper now installs an interrupt
  guard so Ctrl+C reaches the CLI (which exits gracefully) instead of killing the
  wrapper before it can report the exit, and forwards `SIGTERM`/`SIGBREAK` to the
  child. Sessions whose wrapper is hard-killed without unregistering are marked
  stale ~15s after the heartbeat stops and dropped at 60s, so the pet no longer
  sits on a phantom *idle*. The Claude hooks use Claude Code's documented
  empty-string "match all tools" matcher (a bare `*` is an invalid regex that would
  silently never fire).

## Per-client status adapters

Status comes from each client's native hooks where implemented, with PTY
observation (`--observe`) or L1 lifecycle as the fallback. Current state:

- **Claude Code** — native passthrough by default (full terminal fidelity,
  lifecycle status). Live in-session status is **opt-in** via `HAYA_PET_HOOKS=1`,
  which injects a settings file (`claude --settings <stable-file>`, no change to
  your global config) wiring Claude's `UserPromptSubmit`/`PreToolUse`/`PostToolUse`/
  `Notification`/`PreCompact`/`Stop`/`SubagentStop` events to `haya-pet state
  <state>`, reported to the daemon over the IPC pipe. `PreToolUse` distinguishes
  file-editing tools (`Edit`/`Write`/`MultiEdit`/`NotebookEdit` → *editing files*)
  from other tools (→ *running tools*) via the hook `matcher`. **Why opt-in:**
  injecting hooks makes Claude show a one-time *review hooks* trust prompt; the
  command string + settings path are kept stable across sessions so it only needs
  approving once (a volatile per-session argument would re-trigger it every
  launch — see the resolved note below). `--observe` is a separate PTY opt-in for
  non-interactive runs (terminal-fidelity tradeoff).
- **Codex** — **not yet implemented** (no hook injection). Uses `--observe` PTY
  observation or L1 lifecycle. A Codex hook adapter (temp `<cwd>/.codex/hooks.json`
  + `--dangerously-bypass-hook-trust`) is a planned follow-up; note the open
  upstream bug where hooks may not fire in interactive sessions
  ([#17532](https://github.com/openai/codex/issues/17532)).
- **Antigravity (`agy`)** — **not yet implemented** (no hook injection). Uses
  `--observe` or L1 lifecycle. A Gemini-schema hook adapter is a planned follow-up.
- **Generic / unknown** — no hooks; PTY observation (`--observe`) or L1 lifecycle.

A future **L3 client-log adapter** (tailing e.g. `~/.codex/sessions` or
Antigravity's `transcript.jsonl`) could provide activity without a PTY or hooks
for the clients that lack a hook adapter.

## Status sources, by fidelity

| Tier | Source | How |
|---|---|---|
| L1 | process wrapper | default; session lifecycle + exit code |
| L4 | client hooks | opt-in via `HAYA_PET_HOOKS=1` (Claude Code); reports through `haya-pet state …` |
| L2 | PTY output scraping | opt-in via `--observe` (terminal-fidelity tradeoff) |

Native passthrough (L1) + opt-in hooks (L4) is the recommended setup for interactive
TUIs: perfect terminal fidelity *and* the richest status. Use `--observe` (L2)
only when you want coarse activity tracking for a non-interactive command and
don't care about terminal fidelity.
