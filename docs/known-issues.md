# Known Issues

Issues found in live use, with their current status.

## Open: a running Codex session retains hooks after HAYA Pet quits

- **Symptom:** Start Codex through HAYA Pet while the companion is online, then
  choose **Quit** from the pet menu. The existing Codex session can continue to
  display `HAYA Pet live status` and schedule the HAYA hook dispatcher.
- **Root cause:** Codex resolves session-layer `-c hooks.<Event>=...` overrides
  when its process starts. HAYA Pet cannot remove those definitions from the
  already-running Codex process, and Codex has no supported external runtime
  hook-removal API.
- **Impact and workaround:** The dispatcher checks the companion IPC endpoint
  and exits without loading the full HAYA reporter or sending state while the
  companion is offline. To remove hook scheduling from the current Codex
  process, disable the HAYA entries through Codex's `/hooks` browser. Otherwise,
  exit that process and start native `codex`; a native launch receives no HAYA
  session hooks.

## ✅ Resolved: native Codex loaded HAYA hooks outside wrapped sessions

- **Symptom:** After enabling HAYA live status, a normal native Codex launch could
  still show `HAYA Pet live status` and schedule HAYA hook commands even when the
  companion was offline. The same happened while a separate HAYA-wrapped Codex
  session was active.
- **Root cause:** The offline dispatcher stopped reporter work after a hook
  process started, but HAYA definitions still lived in the global
  `$CODEX_HOME/hooks.json` source. Codex discovers and displays a hook's
  `statusMessage` before the child command can decide to exit, so a runtime no-op
  could not provide configuration isolation.
- **Fix:** Wrapped Codex launches now receive HAYA hooks through stable
  session-layer `-c hooks.<Event>=<TOML>` arguments. Native Codex never receives
  those values. The wrapper does not consume `-p`/`--profile`, and its generated
  flags precede user arguments so later explicit `-c` values stay authoritative.
  The next online wrapped launch removes only legacy HAYA handlers from global
  `hooks.json`, base config, and every local profile while preserving unrelated
  hooks and config. Stable HAYA-owned command metadata prevents Node path churn
  from changing the hook definition. Codex may request one final trust review
  when migrating to the session source.

## ✅ Resolved: offline companions still caused full hook startup

- **Symptom:** With live-status hooks enabled, provider hook commands could still
  start the full HAYA CLI and attempt IPC when no HAYA-wrapped session existed or
  the companion had become unavailable. Codex was most visible while HAYA still
  used a user-level `$CODEX_HOME/hooks.json` source.
- **Root cause:** Hook definitions called `haya-pet.js` directly. The reporter
  could no-op after discovering a missing session or IPC failure, but only after
  Node had loaded the entire CLI dependency graph. The wrapper also resolved and
  installed provider hooks before knowing whether companion startup succeeded.
- **Fix:** The wrapper now gates hook injection and provider watchers on a live
  companion connection. Claude receives no HAYA settings when startup is offline.
  Stable Claude and Codex commands target `haya-pet-hook.js`, which checks for
  `HAYA_PET_SESSION_ID`, applies a short IPC deadline, and imports the full
  reporter only after connecting. Codex now also omits all HAYA session hook
  config when the companion is offline. Antigravity and generic clients have no
  lifecycle hook integration.

## ✅ Resolved: local Electron runtime could share cache/crash state with other dev Electron apps

- **Symptom:** While running HAYA Pet from a source checkout or npm link, the pet
  could vanish after another local npm/Electron development app failed. In the
  captured repro, Vite crashed with `EBUSY` while watching a locked Chrome profile
  cookie file under that other project's `.tmp` directory. HAYA had no matching
  `overlay-crash.log` entry, and Windows did not report an `electron.exe` fault.
- **Root cause:** The Vite stack trace was the other app's own watcher failure,
  not a HAYA npm dependency problem. HAYA's bug was that the local Electron
  companion did not claim dedicated Electron runtime paths, so source/dev runs
  could fall back to shared dev Electron Chromium profile/cache/crash locations.
  That made HAYA more exposed to unrelated Electron/Chromium renderer and cache
  churn from other local apps.
- **Fix:** HAYA Pet 0.3.22 sets a HAYA-specific Electron app name and dedicated
  `userData`, `sessionData`, and `crashDumps` directories before Electron's
  `ready` event. The CLI launcher also records detached companion stdout/stderr
  in `companion.log`, so startup/native failures have diagnostics even when no
  renderer/GPU crash event reaches `overlay-crash.log`.

## ✅ Resolved: transparent overlay could conflict with video or other Electron rendering

- **Symptom:** Dragging or interacting with HAYA Pet could make YouTube/Chrome
  video content, or another Electron app terminal renderer, disappear until focus
  returned to that app. In the worse case the pet itself could vanish while the
  tray/process stayed alive, and **Reset Position** or Hide/Show did not recover
  it. No `overlay-crash.log` was written because Electron did not report a
  renderer or GPU process exit.
- **Root cause:** HAYA Pet used one transparent, always-on-top BrowserWindow that
  spanned the whole work area. During pet drag, `setIgnoreMouseEvents(false)`
  applied at the native window level, so the OS compositor temporarily saw a
  desktop-sized transparent Chromium surface above other Chromium/Electron
  renderers. CSS `pointer-events` and pixel hit-testing limited DOM behavior, but
  they did not shrink the native drawable/hit-test region.
- **Fix:** The renderer now sends measured native shape rectangles for the pet,
  folder toggle, and visible bubble list. The main process applies them with
  `BrowserWindow.setShape` where Electron supports it, seeds the shape to the pet
  bounds during startup, ignores empty shape updates, and recreates the
  BrowserWindow for user restore gestures so compositor-lost surfaces can recover.

## ✅ Resolved: Codex manual compact could look like a model failure

- **Symptom:** After a manual Codex `/compact` finished, the pet could switch to
  **model response failed** even though compaction succeeded and the Codex session
  was still usable.
- **Root cause:** Codex writes a `context_compacted` transcript event and then an
  empty `task_complete` bookkeeping record for that compact turn. The 0.3.19
  usage-limit fix treated every empty `task_complete` as a provider/model failure,
  so the transcript watcher overwrote the `PostCompact` hook's correct
  `idle --summary compacted` state.
- **Fix:** The Codex transcript parser now remembers `context_compacted` across
  watcher polls and suppresses only the immediately following empty completion.
  Provider-limit empty completions without that compact marker still report the
  non-terminal `interrupted` state.

## ✅ Resolved: Codex usage-limit exhaustion left sessions thinking

- **Symptom:** When Codex hit an AI subscription or usage limit mid-turn, the pet
  could keep showing *thinking* instead of switching to a visible live warning.
  The Codex session had stopped making progress, but the last live-status hook
  event remained visible in the bubble.
- **Root cause:** The Codex transcript watcher only surfaced tool activity and
  `turn_aborted` interrupt records. OpenAI-backed Codex usage exhaustion can be
  visible as a `token_count` event with
  `rate_limits.rate_limit_reached_type`, while some third-party providers write
  only a `task_complete` record with no `last_agent_message` and no first-token
  timing after printing the usage warning in the terminal. HAYA Pet ignored both
  turn-ending forms, so no live turn status replaced the earlier *thinking* state.
- **Fix:** `parseCodexTranscriptLine` now normalizes non-empty
  `rate_limit_reached_type` values into `usage_limit_reached`, normal
  `task_complete` records into `turn_complete`, and empty completions into
  `turn_failed`, except for the empty bookkeeping completion immediately after
  `context_compacted`. The Codex wrapper clears active tool tracking and emits the
  existing non-terminal `interrupted` state for the failure cases or `idle` for
  normal completion, so the bubble leaves the spinner without being treated as a
  finished session. Regression tests cover both parser and wrapper status paths,
  including the empty-completion provider-limit shape reproduced live.

## ✅ Resolved: Codex hook trust could re-prompt after approval

- **Symptom:** After approving HAYA Pet's Codex hooks once, Codex could still
  ask to review them again on later launches. It was intermittent rather than
  every run. It could happen even with the default config when HAYA Pet was
  launched through a different Node manager path, Node version, npm link, or
  install path, and named `-p`/`--profile` configs made the behavior less
  predictable.
- **Root cause:** The former global `hooks.json` design tied trust to both mutable
  command paths and config-layer-specific trust blocks. Mirroring those blocks
  into profile files reduced prompts but also coupled HAYA to user profile state.
- **Fix:** HAYA now keeps the resolved Node and dispatcher paths in its own stable
  metadata and passes hooks through Codex's stable session-flags layer. It no
  longer copies trust blocks between Codex configs or installs global hooks.
  Legacy HAYA entries are removed without touching unrelated profile settings,
  user hooks, or trust state. One final review can be required during migration.

## ✅ Resolved: cross-session status contamination on Codex

- **Symptom (same class as the Claude entry below):** interrupting one Codex
  session could flip a **different, concurrent** Codex session's pet to
  *interrupted* (and more generally mirror another session's tool/working states).
  Most likely when two Codex sessions ran in the **same folder** and one was busy
  while the other was idle.
- **Root cause:** `discoverCodexTranscript` (`codex-transcript-watcher.js`) picked
  the rollout by **newest `.jsonl` by mtime**, filtered only by `session_meta.cwd`
  / freshness — it did **not** bind to a specific session, so an idle session's
  watcher could lock onto a busy session's rollout and read that session's
  `turn_aborted` (Codex's interrupt signal) as its own. The `isFreshSession` branch
  even admitted recently-started rollouts from **other cwds**, so the exposure was
  slightly *wider* than Claude's (scoped to one project dir). The guardian-review
  watcher had the same flaw: it derived the main thread id from the newest main
  rollout by mtime, so a concurrent session's review status could be misattributed.
- **Fix:** the same per-session binding used for Claude. Verified against the
  OpenAI Codex docs that the command-hook stdin payload carries **`transcript_path`**
  (and `session_id`, the conversation/rollout id — which I also confirmed on disk
  equals `session_meta.payload.id` and the rollout filename uuid). The
  `haya-pet state` reporter already records a per-session `session→transcript` link
  from that `transcript_path` (the capture is client-agnostic), so the Codex
  transcript watcher now pins to its own rollout via the link
  (`session-transcript-link.js`) instead of guessing newest-by-mtime, and the
  guardian watcher derives the main thread id from the **linked** rollout's
  `payload.id` (and only considers a trunk whose `parent_thread_id` matches it).
  Both fall back to the old heuristic when no link is available (e.g. `transcript_path`
  null early). No timer involved. *(The guardian watcher's fallback turned out to
  have a residual race — see the follow-up below.)*
- **Follow-up (residual guardian race, now closed):** the guardian watcher's mtime
  fallback above was itself unsafe across concurrent same-cwd sessions. The watcher
  starts at wrapper launch and binds its main thread id on the **first poll**, which
  normally runs *before* the first hook writes the link. In that window it fell back
  to the newest main rollout by mtime — and with a second Codex session in the same
  folder that could be the **other** session's main; worse, the bound id was cached
  for the watcher's life, so the link never got to correct it and the watcher tailed
  the other session's guardian trunk. It surfaced most with the auto-reviewer
  ("Approve for me"), the case that produces a guardian trunk to mis-tail. The
  guardian watcher is now **link-authoritative**: when a session link is configured
  (always, in production) it resolves the main thread id **only** from the link and
  idles until the link resolves — it never guesses by mtime, exactly like the main
  transcript watcher. The mtime fallback remains only for the no-link path (tests /
  hooks-off). A regression test covers the tick-before-link ordering. No timer.

## ✅ Resolved: Claude interrupt/denial leaked into a concurrent idle session

- **Symptom:** With Claude Code hooks enabled, interrupting (Esc) one Claude
  session could also flip a **different, idle** Claude session's pet to
  *interrupted* (and mirror its working states). Intermittent — most visible when
  the two ran in the **same folder** and one was busy while the other sat idle.
- **Root cause:** the L3 transcript watcher had **no binding to a specific
  session's transcript**. It discovered the file by "newest `.jsonl` by mtime in
  the project dir" (`claude-transcript-watcher.js` `discoverTranscript`). Two
  Claude sessions in one folder share a project dir
  (`~/.claude/projects/<sanitized-cwd>/`), each with its own UUID file, so an idle
  session's watcher could lock onto a **busy** session's transcript and then read
  that session's `[Request interrupted by user]` marker (or a denial) and report
  it for itself. `HAYA_PET_SESSION_ID` identified the session to the daemon, but
  nothing tied the watched **file** to the session.
- **Fix:** bind each watcher to its own transcript via the **`transcript_path`
  Claude includes in every hook payload** (ground truth). The `haya-pet state`
  reporter — already a hook child that knows `HAYA_PET_SESSION_ID` — reads the hook
  payload from stdin (only in the real process entry, never in tests/other
  commands) and records a per-session **session→transcript link**
  (`packages/cli-core/src/session-transcript-link.js`, stored under
  `…/haya-pet/sessions/<id>.json`). The watcher pins to that exact file instead of
  guessing; until the link exists it simply idles (nothing to interrupt yet)
  rather than locking onto another session's file. Newest-by-mtime remains only as
  a fallback for the no-session case (never hit in production, where the watcher
  only runs with hooks on). The link is removed on wrapper exit. Local-only and
  best-effort; **no timer** is involved.
- **Tests:** `session-transcript-link.test.mjs` (write/read round-trip + per-session
  isolation) and a `claude-transcript-watcher.test.mjs` case proving an interrupt
  in session A is **not** reported for idle session B, plus a case that the watcher
  idles until its link appears.
- **How to diagnose if it recurs:** with `HAYA_PET_HOOK_DEBUG=<path>` set, the
  transcript-sourced `interrupted` line is logged with its `sessionId`; if it
  appears under a session that was idle, the binding (the
  `…/haya-pet/sessions/<id>.json` link) resolved to the wrong file.

## ✅ Resolved: pet disappeared (and could not be restored) after a display change

- **Symptom:** the pet sometimes vanished from the screen while the companion was
  still running — and once gone, **Show/Hide Pet** and **Reset Position** both
  failed to bring it back. Intermittent.
- **Root cause:** the overlay is a single full-work-area `BrowserWindow` whose
  bounds are computed **once**, at creation, for whichever display it resolved to
  then. The companion subscribed to **no** `screen` events and never called
  `setBounds` again, so a display-layout change underneath it — monitor unplugged,
  resolution/DPI change, dock/undock, or sleep→resume — left the window at
  coordinates that were now **off-screen or on a display that no longer exists**.
  The window stayed alive and `isVisible() === true`; it was just painting where no
  monitor covered. The two recovery actions failed for the same reason: *Show/Hide*
  only flips `isVisible()` (an off-screen window is already "visible", so it
  toggled between hidden and shown-at-the-same-bad-bounds), and *Reset Position*
  only moved the **sprite's CSS position inside** the overlay (against a stale work
  area), never the window's bounds.
- **Fix:** the companion now re-homes the overlay onto a currently-valid display.
  It listens for `screen` `display-metrics-changed` / `display-added` /
  `display-removed` and `powerMonitor` `resume`, re-resolving the target display
  and calling `setBounds` (decision logic in the pure, tested
  `display-manager.js` `resolveOverlayPlacement`). **Reset Position**, **Show
  Pet**, and relaunch now re-home the window itself, not just the sprite.
  Automatic re-homes do **not** persist the position, so the user's preferred
  display is remembered and the pet returns there when that monitor comes back. No
  timer is involved — every re-home is driven by a real display/power event or a
  user action.
- **Known residual (Windows):** a transparent surface can still occasionally go
  blank after resume even with correct bounds (an Electron compositor issue);
  re-asserting bounds repaints it in the common case, and a hide/show repaint nudge
  is the fallback if it recurs.

## ✅ Resolved: Codex interrupt sometimes left the pet "working"

- **Symptom:** Pressing Esc to interrupt a Codex turn occasionally does **not**
  flip the pet to *interrupted* — it keeps showing a working state (*thinking* /
  *running*) even though the turn was cut short. Intermittent ("some occasions").
- **Investigation so far:** The "a late `function_call_output` resets the state to
  *thinking*" theory was **ruled out** — across 257 real `turn_aborted` events in
  live `~/.codex/sessions`, **zero** had a tool result after the abort. Codex
  fires no hook on an abort, and the L3 transcript watcher does record
  `turn_aborted` and emit `interrupted`.
- **Root cause:** The daemon registry applied session state **last-writer-wins by
  IPC arrival order** (`registry.js` `applyState` ignored state ordering). Hooks
  (separate `haya-pet state` subprocesses) and the interrupt watcher use different
  IPC connections, so a stale "working" message could arrive *after*
  `interrupted` and clobber it.
- **Fix:** The registry now keeps a separate per-session state timestamp and ignores
  state messages older than the latest accepted state. Heartbeats still update
  liveness independently, so a newer heartbeat cannot block a legitimate
  later-delivered state message.
- **Follow-up root cause:** Immediate Esc after prompt submit still failed in
  **resumed** Codex sessions. `UserPromptSubmit` fired and set *thinking*, and
  Codex wrote a normal `turn_aborted` record, but the watcher rejected the rollout
  because `session_meta.timestamp` was from the original session start, before the
  HAYA wrapper launch. The transcript watcher now allows a fresh rollout from the
  wrapped cwd, preserving the old guard against unrelated stale sessions while
  covering resumed sessions.
- **Other affected case checked:** The Codex guardian-review watcher had the same
  resumed-session shape. It matched guardian trunks by the main thread id, but the
  old resumed main rollout could be rejected before that id was accepted. It now
  uses the same fresh-mtime + wrapped-cwd rule for resumed main sessions, so
  "Approve for me" review status is not lost after a Codex resume.
- **How to diagnose if it recurs:** Set `HAYA_PET_DAEMON_DEBUG=<path>` before
  launching the companion. The companion writes daemon-arrival JSONL for
  non-heartbeat messages. If `interrupted` never appears, the issue is in
  transcript discovery/watching; if `interrupted` appears before a stale
  hook-sourced working state, it is an ordering regression.

## ✅ Resolved: Claude pet stuck on "compacting" after a compaction

- **Symptom:** With Claude Code hooks enabled, the pet entered *compacting* on
  `PreCompact` and never left — it sat there until the 30 s stale sweep or the
  next prompt. Most visible after a manual `/compact`.
- **Root cause:** The Claude hook table subscribed `PreCompact` → *compacting* but
  had **no completion event**. Claude's `Stop` does not fire for a compaction, so
  nothing cleared the state. (Codex already subscribed `PostCompact`.)
- **Fix:** The Claude hook table now also subscribes **`PostCompact`**, split by
  the documented `manual`/`auto` trigger matcher: a **manual** `/compact` returns
  to *idle* (control is back at the prompt), while an **auto** compaction resumes
  to *thinking* (the agent continues the turn) and the next real event refines it.
  Verified live on the manual path; auto uses the identical matcher mechanism.

## ✅ Resolved: subagent activity drove the main session status (Claude Code)

- **Symptom:** With Claude Code hooks enabled and a multi-agent run, two things
  went wrong once the **main agent had stopped but a subagent was still working**:
  (1) the pet dropped to *idle* even though real work was ongoing in the
  background; and (2) while the subagent ran, its own tool calls flipped the pet
  between *running tools* / *editing files* / *thinking* — the subagent's activity
  was driving the main session's status.
- **Root cause:** Two gaps. (a) The hook table mapped `Stop` → *idle*
  unconditionally, with no awareness that a backgrounded subagent can outlive the
  main turn. (b) A backgrounded subagent's tool calls fire the **parent session's**
  `PreToolUse` / `PostToolUse` hooks, which ran `haya-pet state running_tool`
  (etc.) under the main session id and overwrote its status. (An earlier fix only
  stopped `SubagentStop` from reporting *idle*; it addressed neither of these.)
- **Fix — only ever decided at the main agent's `Stop`; no timers, no persisted
  state:**
  - **The "Subagent running" cue.** Claude's `Stop` payload carries an
    (undocumented) **`background_tasks`** array: a live snapshot of work still
    running at that instant. When `Stop` would report *idle* but `background_tasks`
    still lists a running **subagent**, the reporter instead reports *running
    tools* with the summary **"Subagent running"**
    (`packages/cli-core/src/background-tasks.js`). When that subagent finishes,
    Claude fires `Stop` **again** with an empty `background_tasks`, which clears the
    cue back to *idle* — self-retracting, no timer. (Verified against live hook
    traces: a backgrounded subagent appears in `Stop`'s `background_tasks` as
    `type:"subagent", status:"running"`, and a second `Stop` arrives with `[]` once
    it completes.)
  - **Subagent events are dropped.** Every hook payload from a subagent context
    carries an **`agent_id`** — the documented field that distinguishes subagent
    hook calls from main-thread calls. The reporter now drops any event with an
    `agent_id` (`extractAgentId` in `run-state.js`), so a subagent's tool use can
    never overwrite the main session's status. Main-agent events have no `agent_id`
    and report as before; the main `Stop` (also no `agent_id`) still carries the
    `background_tasks` snapshot used for the cue above. `SubagentStop` is likewise
    not wired.
- **Known limitations (accepted):**
  - **Only subagents, never background shells.** A `background_tasks` entry can
    also be `type:"shell"` (e.g. a `sleep 120` the agent backgrounded). These are
    deliberately **not** surfaced: their completion isn't reliably observable here,
    and a "working" cue we can't retract is worse than showing *idle*. So a
    backgrounded shell still running after the main agent stops shows *idle*.
  - **The `agent_id` discriminator is documented but not yet captured live on
    `PreToolUse` / `PostToolUse`.** The Claude hooks reference lists `agent_id` /
    `agent_type` as optional fields delivered to all hooks to distinguish subagent
    calls, and the observed flicker confirms subagent tool calls reach the parent
    hooks — but a subagent `PreToolUse` payload hasn't been captured on disk to
    100% confirm `agent_id` is present there. If a future Claude build omits it the
    flicker could recur; the marker would then be widened to also match
    `agent_type` / `agent_transcript_path`.
- **How to diagnose if it recurs:** with `HAYA_PET_HOOK_DEBUG=<path>` set, the
  reporter logs an `agentId` field on subagent-sourced events (which it then
  drops). A subagent event logged with **no** `agentId` is the signal to widen the
  marker. Codex keeps its separate behavior: it uses `Stop` as the only idle signal
  and treats `SubagentStop` as mid-turn.

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

## ✅ Resolved: Codex asked to review HAYA hooks on every launch

- **Symptom:** Even after approving HAYA Pet's Codex hooks once, every new
  `haya-pet run --client codex` showed Codex's hook review prompt again.
- **Root cause:** Older builds wrote a stable `$CODEX_HOME/haya-pet.config.toml`
  profile, but Codex stored hook trust decisions back into that same profile
  under `[hooks.state]`. Rewriting the profile on launch deleted that trust cache.
- **Fix:** The Codex hook injector now writes stable commands into a session-only
  Codex config layer and persists command paths in HAYA-owned metadata. It
  removes the older managed profile/global definitions without replacing them.
  Users may need to approve once after updating; after that, unchanged wrapped
  sessions should stay trusted and native Codex loads no HAYA hook source.

## ✅ Resolved: Codex pet looked busy immediately after startup

- **Symptom:** Starting a wrapped Codex session and doing nothing could still make
  the pet show `shell_command` or `thinking` instead of `idle`.
- **Root cause:** The Codex transcript and guardian watchers originally chose the
  newest rollout by file mtime, then filtered individual records by timestamp.
  Another already-running Codex session could keep writing fresh records after
  HAYA Pet started, making its rollout look like the wrapped session even though
  it began earlier.
- **Fix:** Both watchers inspect the first `session_meta` line and require either
  a timestamp that belongs to this wrapper launch, or a fresh rollout whose cwd
  matches the wrapped Codex cwd for resumed sessions. Old-but-active Codex
  sessions from unrelated projects are ignored even if their files continue to
  receive fresh writes.

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
  `Notification`/`PreCompact`/`PostCompact`/`Stop` events to `haya-pet state <state>`,
  reported to the daemon over the IPC pipe. `PostCompact` is split by its
  `manual`/`auto` trigger matcher (manual `/compact` → *idle*, auto compaction →
  *thinking*) so the pet never sticks on *compacting*. Subagent-originated events
  are **dropped** by the reporter (they carry an `agent_id`), so a subagent's tool
  use never drives the main status, and `SubagentStop` is not wired; when `Stop`
  fires while a subagent is still running, its `background_tasks` snapshot surfaces
  as a *running tools* / "Subagent running" cue that the next (empty) `Stop` clears
  — see the resolved subagent entry above. `PreToolUse` distinguishes
  file-editing tools (`Edit`/`Write`/`MultiEdit`/`NotebookEdit` → *editing files*)
  from other tools (→ *running tools*) via the hook `matcher`. **Why opt-in:**
  injecting hooks makes Claude show a one-time *review hooks* trust prompt; the
  command string + settings path are kept stable across sessions so it only needs
  approving once (a volatile per-session argument would re-trigger it every
  launch — see the resolved note below). `--observe` is a separate PTY opt-in for
  non-interactive runs (terminal-fidelity tradeoff).
- **Codex** — **implemented (partial).** Opt-in via the persisted
  `haya-pet hooks on` setting; the wrapper serializes
  `packages/adapters/src/codex-hooks.js` into session-only `-c` config arguments
  (`packages/cli-core/src/codex-hook-injection.js`). Custom Codex
  `-p`/`--profile` args remain untouched, and later user `-c` values remain
  authoritative. Falls back to `--observe` / L1 when not enabled. Findings
  (verified against `codex-cli` 0.137.0 on Windows):
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
    HAYA Pet uses session `-c hooks.<Event>=...` values and keeps stable command
    paths in HAYA-owned metadata. Legacy global/profile HAYA entries are removed
    on migration; unrelated user hooks and config are preserved. Codex has its
    own *review hooks* trust prompt (bypass:
    `--dangerously-bypass-hook-trust`), so one final review can occur when moving
    from the old global source.
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
