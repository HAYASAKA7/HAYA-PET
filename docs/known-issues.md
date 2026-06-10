# Known Issues

Issues found in live use, with their current status.

## ✅ Resolved: pet stuck on "waiting for approval" after a manual denial

- **Symptom:** With Claude Code hooks enabled, denying a permission prompt left the
  pet showing *waiting for approval* indefinitely (until the next turn), even
  though nothing was pending.
- **Root cause:** Claude Code fires **no hook** when the user manually denies a
  permission — not `Stop`, not `PostToolUse`, not `PermissionDenied` (that one is
  only for *auto-mode* classifier denials). Verified by `HAYA_PET_HOOK_DEBUG`
  traces: the event stream simply stops after `Notification(permission_prompt)`.
  So the hook-driven status had no event to clear `waiting_approval`. A timeout was
  rejected — it would wrongly clear a *genuinely* pending approval if the user
  stepped away.
- **Fix:** An **L3 transcript watcher** (`claude-transcript-watcher.js`) tails the
  session JSONL (`~/.claude/projects/<sanitized-cwd>/<id>.jsonl`, matched
  case-insensitively). Claude records a denial as a `tool_result` with
  `is_error: true` and a "user doesn't want to proceed / user rejected" marker —
  ground truth, not a timer. On seeing it, the wrapper reports `idle`
  (source `client_log`). A genuinely-pending approval has no such result yet, so
  the alert correctly stays up until the user actually decides. Also split the
  `Notification` hook by type (`permission_prompt`→approval, `idle_prompt`→idle) so
  non-approval notifications no longer masquerade as approvals.

## ✅ Resolved: pet stuck on "waiting for approval" after the user ACCEPTS

- **Symptom:** The denial fix above covered "deny", but **accepting** a prompt
  still left the pet on *waiting for approval* for the whole run of the approved
  tool — often the user approves a command (build/test) and Claude immediately
  starts working, with no further `PreToolUse`/`PostToolUse` until the tool
  *finishes*. For a long command that was minutes of misleading "waiting"
  (observed: 240 s in a `HAYA_PET_HOOK_DEBUG` trace).
- **Root cause:** Claude Code emits **nothing at the moment of a manual accept** —
  verified three ways: the official hooks lifecycle (`PreToolUse` → dialog →
  `PermissionRequest` → … → `PostToolUse` only *after* the tool completes; there
  is no "permission granted" event), a live hook trace, and the session
  transcript (the `tool_use`/`tool_result`/hook records are flushed in one batch
  at completion; nothing is written at approval time). So between *prompt shown*
  and *tool finished*, outside observers get zero signal. Timers were rejected
  again: flipping the state on a delay would hide a genuinely unanswered prompt.
- **Fix:** **Process-tree observation** (`approval-process-watcher.js` +
  `process-snapshot.js`). The wrapper already reports the client's `pid` on
  register. While a session sits in `waiting_approval`, the companion polls the
  client's process subtree (~1.5 s; only during the waiting window): when a
  **new descendant process appears and is still alive on the next poll**, the
  approved command is verifiably running → the session flips to `running_tool`
  (summary `approved`, source `client_log`). The two-poll persistence filter
  keeps short-lived blips (our own hook reporter, the user's hooks) from
  triggering it; the subtree walk covers shim layers (`cmd.exe` → `claude.exe` →
  command). Every transition is event-based: a real process appeared, the tool
  finished (`PostToolUse`), or the user denied (transcript). If nothing happens,
  the warning stays up — by design.
- **Known limitations (accepted):** (1) In-process approvals (Edit/Write file
  edits) spawn no OS process and aren't detected — but they complete in
  milliseconds after approval, so `PostToolUse` resolves them near-instantly
  anyway. (2) Detection lags the accept by ~2–3 s (two polls + snapshot cost).
  (3) An unrelated *persistent* process spawned by the client mid-wait (e.g. an
  MCP server starting) would read as an approval — considered acceptable since
  the client is in fact actively doing something then. Cross-OS: Windows via a
  PowerShell CIM snapshot, macOS via `ps`, Linux via `/proc` (macOS/Linux listers
  are implemented but need live verification on real hardware).

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
- **Codex** — **implemented (partial).** Opt-in via the global `haya-pet hooks on`;
  the wrapper injects `packages/adapters/src/codex-hooks.js` as a stable
  `$CODEX_HOME/haya-pet.config.toml` profile and launches `codex -p haya-pet`
  (`packages/cli-core/src/codex-hook-injection.js`). Falls back to `--observe` / L1
  when not enabled. Findings (verified against `codex-cli` 0.137.0 on Windows):
  - **Mechanism fits.** Codex has a lifecycle-hooks system (`[[hooks.<Event>]]` in
    `config.toml` or a `hooks.json`), with the `hooks` feature flag `stable` and ON
    by default. Command hooks receive a JSON payload on **stdin**
    (`session_id`, `hook_event_name`, `tool_name`, `cwd`) and treat *exit 0 with no
    output* as continue — so our existing client-agnostic `haya-pet state` reporter
    works unchanged. The hooks.json shape is identical to Claude's settings block;
    **only the hook table differs**, which is all `codex-hooks.js` adds.
  - **Event vocabulary differs** from Claude: no `Notification` / `PermissionDenied`
    / `*Failure`; adds `PostCompact` / `SubagentStart`. `Stop` is the *only* idle
    signal (`SubagentStop` is mid-turn → stays *thinking*). `PermissionRequest`
    exists, so the approval cue is reachable.
  - **Injection differs** — Codex has no `claude --settings <file>` equivalent.
    Candidate non-mutating paths: `codex -p haya-pet` layering a generated
    `$CODEX_HOME/haya-pet.config.toml` profile on top of the user's base config, or a
    `hooks.json` next to the active config layer. Codex has its own *review hooks*
    trust prompt (bypass: `--dangerously-bypass-hook-trust`), so the same one-time
    trust UX as Claude applies.
  - **Windows command quoting (fixed in the adapter):** Codex runs a hook `command`
    via `cmd /c "<cmd>"`, which strips a **leading** quote — so Claude's
    `"<node>" "<cli>" …` form dies with *"hook exited with code 1"*. The Codex
    builder leaves the **program unquoted** (`<node> "<cli>" …`); args may be quoted.
    Caveat: an unquoted program breaks if `node`'s path contains spaces (fine for
    fnm/scoop/nvm layouts; a `command_windows` / short-path fallback is a follow-up).
  - **No look-around in matchers:** Codex compiles matchers with the Rust `regex`
    crate, which rejects `(?!…)` — Claude's negative-lookahead catch-all is a hard
    parse error. Matchers are **anchored full matches** against the tool name, so
    they must name tools exactly (`apply_patch`, `shell_command`).
  - **Verified end-to-end** against `codex-cli` 0.137.0 (interactive TUI, Windows,
    real `haya-pet state` reporter, `HAYA_PET_HOOK_DEBUG`): **`UserPromptSubmit`→
    thinking, `PostToolUse`→thinking, `Stop`→idle all fire**, the parent env is
    forwarded to hooks (session via `HAYA_PET_SESSION_ID`), and the reporter exits 0
    cleanly. Note `codex exec` can't be used to test this — it forces
    `approval_policy=never` + `sandbox=read`, a posture that disables hooks entirely.
  - **`PreToolUse` does not fire** in 0.137 for tool calls (the entries are kept as
    harmless no-ops for when it's fixed —
    [openai/codex#16732](https://github.com/openai/codex/issues/16732)). Tool
    activity is covered by an L3 Codex transcript watcher that tails
    `~/.codex/sessions` JSONL: normal tools report `running_tool`, `apply_patch`
    reports `editing_files`, and Haya Pet returns to `thinking` after active tool
    calls drain. `PermissionRequest` (the *waiting for approval* cue — the
    highest-value state) is **unconfirmed**; it likely depends on an
    approval-required flow and needs a dedicated test before the feature is worth
    wiring in.
- **Antigravity (`agy`)** — **not yet implemented** (no hook injection). Uses
  `--observe` or L1 lifecycle. A Gemini-schema hook adapter is a planned follow-up.
- **Generic / unknown** — no hooks; PTY observation (`--observe`) or L1 lifecycle.

The Codex **L3 client-log adapter** now covers tool activity without a PTY or
working `PreToolUse` hook. A similar adapter for Antigravity's `transcript.jsonl`
remains a possible follow-up.

## Status sources, by fidelity

| Tier | Source | How |
|---|---|---|
| L1 | process wrapper | default; session lifecycle + exit code |
| L4 | client hooks | opt-in via `haya-pet hooks on` (Claude Code full, Codex partial); reports through `haya-pet state …` |
| L3 | client logs | Codex session JSONL watcher for tool activity; Claude denial recovery; future clients can add similar transcript adapters |
| L3 | process tree | approval-accept detection: a `waiting_approval` session flips to `running_tool` when the approved command verifiably starts under the client's pid |
| L2 | PTY output scraping | opt-in via `--observe` (terminal-fidelity tradeoff) |

Native passthrough (L1) + opt-in hooks (L4) is the recommended setup for interactive
TUIs: perfect terminal fidelity *and* the richest status. Use `--observe` (L2)
only when you want coarse activity tracking for a non-interactive command and
don't care about terminal fidelity.
