# Troubleshooting

Quick fixes for common issues. See also [known-issues.md](known-issues.md) for
deferred problems with known root causes.

| Symptom | Fix |
|---|---|
| `haya-pet: command not found` | Install globally (`npm i -g …`), or in a source checkout run `npm link` in the repo root, or call the file directly: `node <repo>/apps/cli/src/haya-pet.js`. |
| Running a CLI starts the pet but not the command | Fixed — update to the latest version. (Was caused by the auto-start poll exiting early.) |
| Pet doesn't react to a session | Launch the CLI via `haya-pet run …`. If the overlay didn't auto-start, run `haya-pet start`, or check `HAYA_PET_NO_AUTOSTART` isn't set. |
| Pet shows complete/working while an approval prompt is waiting | Fixed — update to the latest version. See "Approval prompt hidden by idle/working" below. |
| Pet shows a blue placeholder box | No spritesheet found — add a pet (see the README); behaviour is otherwise correct. |
| Pet is off-screen / can't find it | Tray icon → **Reset Position**. |
| Can't exit the pet | `haya-pet stop`, or right-click the tray icon → **Quit**. |
| `haya-pet pets` shows "No pets found" | Add a pet folder with **both** `pet.json` and a spritesheet to a search path. |
| Terminal scroll / Shift+Tab / backspace odd while a CLI runs under `haya-pet run` | Fixed — `haya-pet run` now uses native passthrough by default (full fidelity). If you opted into `--observe`, drop it. See [known-issues.md](known-issues.md). |
| Pet shows only **idle/lifecycle** while **Claude Code** works | Live in-session status is opt-in: run `haya-pet hooks on` once (persisted). The first `haya-pet run` afterward shows a one-time Claude *review hooks* prompt — approve it. Also make sure the companion is running (`haya-pet start`). Check the toggle with `haya-pet hooks status`. |
| Typing doesn't work / **Claude Code** TUI frozen under `haya-pet run` | You have hooks enabled and Claude is showing its *review hooks* trust prompt (approve it once), or your Claude is too old for `--settings`. Run `haya-pet hooks off` (or set `HAYA_PET_NO_HOOKS=1`) for native passthrough with lifecycle-only status — typing and Shift+Tab work normally. |
| Pet changes status after a **Claude Code** subagent finishes, even though the main agent already stopped | Fixed — Claude `SubagentStop` is ignored because it is not a reliable main-turn state. Update to the latest version and restart the wrapped Claude session so the new hook settings are used. |
| Pet shows only **idle/lifecycle** while **Codex** works | Live status is opt-in: run `haya-pet hooks on` once (persisted, global), then `haya-pet run --client codex -- codex`; approve Codex's one-time *review hooks* prompt. `thinking`/`idle` come from hooks, `running_tool`/`editing_files` from a transcript watcher, and approval states from the `PermissionRequest` hook plus a guardian-review watcher. |
| **Codex** asks to review HAYA hooks on every launch | Fixed — update to the latest version, then approve once more. Codex writes trusted hook hashes into `$CODEX_HOME/haya-pet.config.toml` under `[hooks.state]`; HAYA Pet now preserves that Codex-managed block when refreshing the hook profile. |
| Pet showed **waiting for approval** while **Codex** auto-reviewed the request ("Approve for me") | Fixed — with `approvals_reviewer = auto_review` (legacy `guardian_subagent`) Codex's guardian decides without asking you; the pet now reports **reviewing** from the permission hook itself, then **working** on an allow verdict or **thinking** on a deny. *Waiting for approval* still shows when Codex actually asks you (`approvals_reviewer = "user"`). Restart the wrapped Codex session after updating so Codex reloads the changed hook command. |
| Pet shows **shell_command** or **thinking** right after starting Codex, before you prompt it | Fixed — the Codex transcript and guardian watchers now ignore rollouts whose `session_meta.timestamp` predates the current wrapper launch, so another active Codex session cannot drive this pet's status. Restart the wrapped Codex session after updating. |
| **Codex** live status didn't turn on / you pass your own `-p`/`--profile` | Codex allows only one profile, so haya-pet skips hook injection when you supply your own and prints a notice. Drop your `-p` for that run to get live status, or accept lifecycle-only. |
| Pet shows only **idle/lifecycle** while **Antigravity** (`agy`) works | Antigravity has no hook adapter yet. Add `--observe` for coarse PTY activity, or accept lifecycle-only status. |
| Claude hooks fail with **"hook exited with code 1"** | The hook command must not bake an **fnm**/node-manager *per-shell* node path (`…\fnm_multishells\<pid>_…\node.exe`) that dies when the shell exits. haya-pet bakes the stable `realpath`-resolved node path into the temp settings instead. Update to the latest version. |
| Pet shows only **idle** for a generic / unknown CLI | Expected without a hook adapter — add `--observe` for PTY observation, otherwise lifecycle only. |
| Pet stayed on **waiting for approval** after I denied a tool | Fixed — Claude fires no hook on a manual denial, so the wrapper tails the session transcript and clears to **idle** when the denial is recorded. A genuinely-pending approval (you haven't decided yet) correctly keeps alerting — there's no timer. |
| Pet stayed on **waiting for approval** after I *approved* a command | Fixed — Claude also fires no hook at the accept moment, so the companion watches the client's process tree while a session waits: when the approved command verifiably starts (a new persistent process under the client), the pet flips to **working**. Expect a ~2–3s lag after your click. File-edit approvals (no process) resolve at completion, which is near-instant. |
| Want to see which status events fire | Set `HAYA_PET_HOOK_DEBUG=<file.jsonl>` before `haya-pet run`; each hook- and transcript-sourced status appends one JSON line (timestamp, state, and source/event). |
| Don't want the update check / notice | Set `HAYA_PET_NO_UPDATE_CHECK=1`. The check is a daily, cached HTTPS request to the npm registry (no session data); it is already skipped automatically when output is piped. |
| Pet stays **idle** after force-quitting a CLI | The wrapper marks the session stale ~15s after the heartbeat stops, then drops it. Exiting normally (incl. Ctrl+C) reports **exited** immediately. |
| **Codex `/quit`** printed its goodbye but the terminal hung (pet stuck on "working") | Fixed — a hook reporter could hang on a pipe await and Codex waits up to 600s for hook children at shutdown. Reporters now hard-deadline at 2s. Update to the latest version. |
| Ctrl+C doesn't exit the CLI cleanly under `haya-pet run` | Fixed — the wrapper no longer dies on Ctrl+C; the signal reaches the CLI, which exits, and the pet shows the result. |
| `ENOENT … electron\path.txt` | Electron's install extraction was interrupted — see below. |

## Approval prompt hidden by idle/working

Older builds could show a green complete check when the AI CLI was actually
waiting on approval, or show working when other terminal output arrived beside
the approval prompt. The cause was low-fidelity PTY activity/idle observation
overwriting `waiting_approval`.

The fix keeps user-action states sticky in the observer and preserves native
hook/plugin approval states over lower-fidelity PTY updates. With native
passthrough now the default, the most reliable approval signal is the client's
own hooks — for Claude Code, enabling `HAYA_PET_HOOKS=1` injects settings that
wire the `Notification` hook to a sticky *waiting for approval* state. Wrapped
clients also receive `HAYA_PET_SESSION_ID`, so any hook can report directly:

```bash
haya-pet state waiting_approval --summary "approval needed"
haya-pet state running_tool --summary "approval resolved"
```

## Fixing a broken Electron install

If launching the overlay fails with `ENOENT … node_modules\electron\path.txt`,
the Electron binary downloaded but extraction left `dist/` empty. The cached zip
is fine, so re-extract it without re-downloading (PowerShell, from the repo root):

```powershell
$cache = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-*.zip" |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
$dist  = "node_modules\electron\dist"
Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory $dist | Out-Null
Expand-Archive -Path $cache.FullName -DestinationPath $dist -Force
Set-Content "node_modules\electron\path.txt" "electron.exe" -NoNewline
node_modules\.bin\electron --version            # should print the version
```

If `electron.exe` is missing even after a clean `Expand-Archive`, your antivirus
likely quarantined it — allow `node_modules\electron\dist\electron.exe` and retry.
