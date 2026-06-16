# Known Issues

Issues found in live use, with their current status.

## ✅ Resolved: Claude Code subagent completion changed the main session status

- **Symptom:** In Claude Code multi-agent runs, the main agent could already be
  stopped while a subagent was still finishing. When that late subagent emitted
  `SubagentStop`, the pet treated it as a main-session `idle` update and could
  show a misleading working/done transition after the main agent had settled.
- **Root cause:** The Claude hook table mapped `SubagentStop` to `idle`. That is
  only safe if subagent completion is ordered before the main turn finishes, which
  Claude Code does not guarantee.
- **Fix:** Claude `SubagentStop` is now ignored. Main-session idle still comes
  from Claude's real `Stop` hook, while late subagent completion cannot override
  the current main-agent state. Codex keeps its separate behavior because Codex
  uses `Stop` as the only idle signal and treats `SubagentStop` as mid-turn.

## ✅ Resolved: false "waiting for approval" while Codex auto-reviews an approval (Approve for me)

- **Symptom:** Running Codex under the pet with the **"Approve for me"** preset
  (`approvals_reviewer = auto_review`; the user's config had the legacy alias
  `guardian_subagent`), the pet showed *waiting for approval* whenever an action
  needed approval — even though Codex's guardian was reviewing it automatically
  and the user was never asked anything. The false state lasted the whole review
  (~8–30 s per request, up to Codex's 90 s review timeout) plus the approved
  command's runtime.
- **Root cause (verified against codex-rs 0.139.0 source + a live trunk
  rollout):** Codex fires the `PermissionRequest` hook once, at approval-request
  creation, **before** routing — and for guardian-routed requests the human
  approval UI is *never* shown: a guardian `allow` lets the action proceed; a
  guardian `deny` returns the rationale to the **model** as a rejected tool call
  ("This action was rejected due to unacceptable risk. …"), so no human decision
  is ever pending. Our Codex hook table mapped `PermissionRequest` →
  `waiting_approval` unconditionally. Nothing fires on guardian start/finish
  (the guardian session is `SubAgentSource::Other`, which is excluded from
  Subagent hooks), and `GuardianAssessment` events are explicitly not persisted
  to the main rollout (`rollout/src/policy.rs`).
- **Fix:** a Codex-specific `PermissionRequest` reporter plus an **L3
  guardian-trunk watcher** (`codex-guardian-watcher.js` +
  `adapters/codex-guardian.js`). The reporter checks the wrapped session's
  resolved Codex `approvals_reviewer` config: `auto_review` / legacy
  `guardian_subagent` reports **reviewing** immediately, while manual/unknown
  reviewer config reports **waiting for approval**. This is config/event-backed,
  not a timer. The guardian runs as its own Codex session that
  writes its own rollout under `~/.codex/sessions` — session_meta has
  `source: {subagent: {other: "guardian"}}` and `parent_thread_id` = the main
  thread; each review is one turn (`task_started` → `task_complete` with the
  verdict JSON in `last_agent_message`, e.g. `{"outcome":"allow"}`). The watcher
  binds the trunk to the wrapped session's main thread id and maps real events:
  review turn starts → **reviewing**; verdict `allow` → **running_tool**
  ("reviewer approved" — the action verifiably proceeds); verdict `deny` →
  **thinking** ("reviewer denied" — the model received the rejection and keeps
  working). An unreadable verdict reports nothing, so a pending cue is never
  cleared on a guess. With `approvals_reviewer = "user"` ("Ask for approval")
  there is no trunk and behavior is unchanged: `PermissionRequest` →
  *waiting for approval* until the user decides (process-tree/denial detection
  resolve it, as before).
- **Known limitations (accepted):** (1) Reviews of a **collab subagent's** actions (multi-agent runs) have their
  own trunks keyed to the subagent's thread and are not watched; a subagent's
  `PermissionRequest` still follows the wrapped session's resolved reviewer
  config; if that subagent is using different approval settings, the parent
  session may not be able to distinguish it. (2) After a guardian deny the pet shows *thinking*,
  not *waiting for approval* — by design: Codex resolves the request itself and
  the model decides what to do next (it may ask the user in chat, which then
  surfaces as turn-end *idle*). The TUI's passive `/approve` denial-override
  picker is not a blocking prompt.

## ✅ Resolved: Codex pet looked busy immediately after startup

- **Symptom:** Starting a wrapped Codex session and doing nothing could still make
  the pet show `shell_command` or `thinking` instead of `idle`.
- **Root cause:** The Codex transcript and guardian watchers originally chose the
  newest rollout by file mtime, then filtered individual records by timestamp.
  Another already-running Codex session could keep writing fresh records after
  HAYA Pet started, making its rollout look like the wrapped session even though
  it began earlier.
- **Fix:** Both watchers now inspect the first `session_meta` line and require
  its timestamp to belong to this wrapper launch. Old-but-active Codex sessions
  are ignored even if their files continue to receive fresh writes.

## ✅ Resolved: Codex `/quit` hung on its goodbye (and the pet kept showing "working")

- **Symptom:** Exiting Codex with `/quit` printed the token-usage goodbye and the
  `codex resume` hint, but the terminal never returned to a prompt and the pet
  kept showing the session as ongoing. Ctrl+C exited fine. Only happened under
  `haya-pet run`.
- **Root cause (verified against codex-rs 0.139.0 source + a live orphaned
  process):** the `haya-pet state` hook reporter had three **unbounded awaits**
  in its IPC path — pipe connect, write drain, and `socket.end()` → `close` —
  and the CLI entry's `process.exit()` only runs after the command resolves, so
  one never-settling await made a reporter hang forever. Codex awaits every
  hook child with a **default 600 s timeout**
  (`hooks/engine/discovery.rs` `timeout_sec.unwrap_or(600)`;
  `command_runner.rs` `timeout(…, child.wait_with_output())`), and `Stop` hooks
  are awaited in turn completion (`core/hook_runtime.rs run_turn_stop_hooks`)
  with the TUI exiting only after `ShutdownComplete`. So one hung turn-end
  `state idle` reporter produced BOTH symptoms: the idle report never arrived
  (pet stuck on "working"), and `/quit` waited up to 10 minutes on the hook
  child after printing its goodbye. Ctrl+C kills Codex without that wait and
  orphans the reporter — exactly what live process-tree monitoring showed (a
  parentless reporter under the hook node version).
- **Fix:** every IPC await now has a hard deadline (`cli-core/deadline.js`).
  The reporter races its whole connect→send→close against **2 s** and exits
  with `{ ok:false, reason:"timeout" }` on the deadline (one best-effort status
  update lost; `HAYA_PET_HOOK_DEBUG` logs a `timeout: true` line for evidence).
  The wrapper's companion connection gets the same guard (**5 s** per
  send/close) so a wedged companion can never keep the wrapper — and the user's
  terminal — alive after the wrapped CLI exits. Dead sessions still resolve via
  the registry's stale/drop sweep, so a lost message self-heals.
- **Note:** why a pipe await occasionally never settles (companion busy/wedged
  at that moment) is not yet pinned down; the deadline makes it harmless and
  the debug log will show `timeout: true` entries if it recurs.

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

## ✅ Resolved: pet stuck on "thinking" after an Esc interrupt

- **Symptom:** With hooks enabled, pressing Esc to interrupt the agent — most
  visibly while it was *thinking* with no tool running — left the pet spinning on
  *thinking* (or *running*) until the 30 s stale sweep, instead of showing the
  turn was cut short. Affected both Claude Code and Codex.
- **Root cause:** Neither client fires a hook on an interrupt. `Stop` fires only
  on a *normal* turn end, so the hook-driven status had no event to leave the
  working state. A timeout was rejected (same reasoning as the denial case — it
  would misreport a genuinely long turn).
- **Fix:** The existing **L3 transcript watchers** already tail each client's
  session JSONL, so they now also recognise the interrupt marker each client
  *does* write — ground truth, not a timer. Claude records a synthetic user
  message `[Request interrupted by user]` (and `…for tool use]`); Codex records
  an `event_msg` with `payload.type: "turn_aborted"`. On seeing it the wrapper
  reports a dedicated **`interrupted`** state (summary "interrupted", source
  `client_log`).
- **Why a new state, not `failed`:** the first attempt reported `failed`, which
  *looked* right (red ✕) but is in `bubble-linger.js`'s `ENDED_STATES`, so the
  linger logic treated the interrupt as a finished session and **hid the bubble
  after ~2 s** — even though the session was still alive (no unregister on an
  interrupt). `interrupted` maps to the same red ✕ kind and the same one-shot pet
  reaction as `failed`, but is **not** terminal (not in `ENDED_STATES` or the
  pet's `TERMINAL_STATES`), so the bubble stays visible until the next turn (or a
  real exit). Heartbeats keep it from going stale.

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
  `Notification`/`PreCompact`/`Stop` events to `haya-pet state <state>`, reported
  to the daemon over the IPC pipe. `SubagentStop` is intentionally ignored because
  it is not a main-turn idle signal. `PreToolUse` distinguishes
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
    reports `editing_files`, and HAYA Pet returns to `thinking` after active tool
    calls drain.
  - **`PermissionRequest` fires** (confirmed live on 0.139.0), but **once, at
    approval-request creation, before routing**. The hook calls
    `haya-pet codex-permission-request`, which uses the wrapped session's
    resolved `approvals_reviewer` config: `auto_review` / legacy
    `guardian_subagent` reports *reviewing*, while manual review reports
    *waiting for approval*. An L3 **guardian-trunk watcher** tails the guardian
    reviewer's own rollout (`source: {subagent:{other:"guardian"}}`,
    `parent_thread_id` = main thread) and refines the state: review running →
    *reviewing*, verdict `allow` → *running_tool*, verdict `deny` → *thinking*.
    See the resolved false-waiting-for-approval entry above.
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
| L3 | client logs | Codex session JSONL watcher for tool activity; Codex guardian-trunk watcher for auto-review status; Claude denial recovery; future clients can add similar transcript adapters |
| L3 | process tree | approval-accept detection: a `waiting_approval` session flips to `running_tool` when the approved command verifiably starts under the client's pid |
| L2 | PTY output scraping | opt-in via `--observe` (terminal-fidelity tradeoff) |

Native passthrough (L1) + opt-in hooks (L4) is the recommended setup for interactive
TUIs: perfect terminal fidelity *and* the richest status. Use `--observe` (L2)
only when you want coarse activity tracking for a non-interactive command and
don't care about terminal fidelity.
