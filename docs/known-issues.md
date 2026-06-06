# Known Issues (deferred)

Issues found in live use that are **recorded for later** — not yet fixed. The
decision on *how* to fix is pending.

## 1. Terminal scrolling breaks when running a CLI through `ai-pet run` (observe/PTY mode)

- **Symptom:** While a CLI is running under `ai-pet run` (default `--observe`), the
  terminal window can no longer scroll normally.
- **Trigger:** Only in observe (PTY) mode. The plain `--no-observe` path
  (`stdio: "inherit"`) does not have this problem.
- **Diagnosis:** Observe mode runs the CLI inside a `node-pty`/ConPTY pseudo-terminal
  with a fixed `cols × rows` and tees its output to our `stdout`
  (`packages/cli-core/src/pty-runner.js`). Full-screen TUIs (Claude Code, Codex)
  render into that fixed grid, so the outer terminal's scrollback only ever sees
  redraws of the grid rather than a growing transcript — there is effectively
  nothing meaningful to scroll. On Windows there is an extra layer: shims are run
  as `cmd /d /s /c "<shim> ..."` *inside* the PTY, so `cmd.exe` is the PTY's
  foreground process and the TUI is its child.
- **Notes for a future fix:** Tools like `script`/`asciinema` interpose a PTY
  without breaking the terminal, so a faithful passthrough is achievable. Avenues:
  resolve the shim and spawn the real executable directly in the PTY (drop the
  `cmd /c` layer); verify `cols/rows` always match the host; revisit whether
  observe should be the default for interactive TUIs vs. native passthrough.

## 2. Backspace deletes a whole word instead of one character (observe/PTY mode)

- **Symptom:** While a CLI is running under `ai-pet run`, pressing Backspace
  deletes an entire word rather than a single character.
- **Trigger:** Only in observe (PTY) mode. Native (`--no-observe`) is unaffected.
- **Diagnosis:** stdin is put in raw mode and forwarded byte-for-byte into the PTY
  (`pty-runner.js` `forwardInput` → `child.write(chunk.toString("utf8"))`). The
  whole-word deletion points to a key-encoding/line-discipline mismatch between the
  host terminal (Windows Terminal/conhost) and the nested ConPTY (and possibly the
  intermediate `cmd /c`) — e.g. Backspace `0x7f`/`0x08` being interpreted by the
  inner app as a word-delete (Ctrl+W `0x17` / Alt+Backspace `ESC 0x7f`), or input
  bytes being re-segmented across `data` events.
- **Notes for a future fix:** Forward stdin as raw bytes without a UTF-8 round-trip;
  audit the exact bytes the host sends for Backspace vs. what the inner app receives
  (a small PTY echo harness); consider removing the `cmd /c` layer; re-evaluate
  raw-mode handling. Hard to fully verify without interactive testing.

## Shared root cause & the open decision

Both issues stem from observe mode interposing a pseudo-terminal on an interactive
session. The plain wrapper path avoids them entirely but cannot report fine-grained
"thinking / running tools" status. The open product decision: **native terminal by
default (perfect fidelity, coarser status) vs. keep PTY observation default and
invest in faithful passthrough.** Deferred until the maintainer decides.
