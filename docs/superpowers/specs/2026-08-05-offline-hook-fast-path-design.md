# Offline Hook Fast Path

**Date:** 2026-08-05
**Status:** Approved design, pre-implementation
**Scope:** Hook-capable clients (Codex and Claude Code)

## Problem

HAYA Pet keeps its Codex hook definitions in `~/.codex/hooks.json` so their
definition and trust hash remain stable. Codex therefore invokes those commands
for every matching Codex session, including sessions not launched through HAYA
Pet. The reporter already exits successfully when `HAYA_PET_SESSION_ID` is
missing, but Codex still starts the full HAYA CLI process to discover that.

For a HAYA-launched session, hooks also continue to start after the companion
becomes unavailable. They eventually fail open, but may load unnecessary modules,
read hook input, or wait on IPC before exiting. Hooks must never make an AI client
wait for a companion that is not online.

Claude Code has a different lifecycle: HAYA supplies its hook settings per
wrapped process through `--settings`. If the companion is unavailable before
launch, HAYA can omit those settings completely.

## Goal

When the HAYA companion is offline, provider sessions continue normally with no
visible hook errors and no meaningful HAYA processing. Offline handling must be
fast, bounded, and independent of provider output.

Literal zero hook-process launches is not a cross-provider requirement. Codex
owns invocation of commands already present in its user-level hook file and has
no dynamic daemon-availability matcher. Avoiding every Codex launch would require
rewriting the hook file or consuming the user's profile, both of which violate
the stable-trust and profile-compatibility requirements.

## Provider Behavior

| Provider | Hook installation | Offline behavior |
|---|---|---|
| Claude Code | Per wrapped process via `--settings` | Do not pass hook settings when the companion is unavailable at startup. |
| Codex | Stable user-level `~/.codex/hooks.json` | Keep definitions stable; launch a lightweight dispatcher that exits immediately when the run is not HAYA-scoped or the companion is unavailable. |
| Antigravity | No lifecycle hooks | No change. |
| Generic | No lifecycle hooks | No change. |

## Design

### 1. Expose companion availability at wrapper startup

The wrapper already attempts the companion connection before configuring hooks.
Its message sender will expose whether that connection succeeded.

The effective hook decision becomes:

```text
hooks enabled by user AND companion connected AND client supports hooks
```

For Claude Code, a false result means HAYA does not append `--settings` and does
not start transcript watchers. The wrapped CLI still runs in native passthrough
mode with lifecycle-only wrapper reporting where available.

For Codex, a false result means HAYA does not attach `HAYA_PET_SESSION_ID` or
start Codex transcript/guardian watchers. The stable global hook file is left
unchanged.

### 2. Add a lightweight hook dispatcher

Codex and Claude hook definitions call a dedicated HAYA hook entry point instead
of loading the full general-purpose CLI before checking applicability. Its order
of work is fixed:

1. If `HAYA_PET_SESSION_ID` is absent, exit `0` without reading stdin, loading
   reporter modules, inspecting transcripts, or opening IPC.
2. If the session id is present, probe the HAYA IPC endpoint under a short,
   bounded deadline.
3. If the endpoint is unavailable, exit `0` silently.
4. If it is available, lazily load the existing hook payload and reporter logic,
   then send the state update.

The hook command path and serialized definition remain stable between sessions.
The one definition change introduced by this release may require one new trust
review; subsequent online/offline transitions must not change the hook hash.

### 3. Preserve fail-open semantics

Every offline, malformed-input, missing-session, timeout, and IPC-error path exits
with status `0`. HAYA diagnostics may record an offline fast-path decision only
when the existing debug environment variable is enabled. Normal offline events
produce no terminal output.

No availability result is cached for the lifetime of an AI process. A HAYA-scoped
session whose companion disappears must take the fast path on its next hook. A
fresh wrapped session checks availability again at startup.

### 4. Keep persistent configuration stable

The companion must not add or remove Codex hook entries as it starts and stops.
That approach is rejected because crashes leave stale configuration, concurrent
sessions race over one file, and definition changes invalidate Codex hook trust.

A dedicated Codex profile is also rejected because it consumes Codex's single
profile selection and conflicts with users who already launch a custom profile.

## Data Flow

```text
haya-pet run
  -> connect/auto-start companion
  -> unavailable: launch provider without per-run HAYA integration
  -> available: launch provider with HAYA session id and supported integration

provider hook event
  -> lightweight dispatcher
  -> no HAYA session id: exit 0
  -> companion offline: exit 0
  -> companion online: lazy-load reporter -> IPC state update -> exit 0
```

## Testing

Unit tests must prove:

- The message sender exposes connected versus unavailable companion state.
- Claude hook settings and watchers are skipped when startup connection fails.
- Codex session environment and watchers are skipped when startup connection
  fails, without removing or rewriting the global hook file.
- The dispatcher exits before loading the reporter when no session id exists.
- The dispatcher exits successfully within its deadline when IPC is unavailable.
- The dispatcher delegates exactly once when the companion is available.
- Antigravity and generic clients remain hook-free.
- Hook command generation remains byte-stable across repeated launches.

The complete test and lint suites must pass. Tests must not depend on a real
companion process or mutate the user's actual Codex or Claude configuration.

## Documentation

Update the README, architecture notes, troubleshooting guidance, known issues,
and changelog to state that offline hooks fail open immediately. Document the
Codex distinction precisely: Codex may still start the stable configured command,
but HAYA performs no reporter work when the session is not HAYA-scoped or the
companion is unavailable.

## Out of Scope

- Dynamically editing Codex hook configuration when the companion starts/stops.
- Taking over the user's Codex profile selection.
- Adding hooks to Antigravity or generic adapters.
- Automatically attaching an already-running provider session when the companion
  starts later.
- Changing hook trust policy or bypassing provider trust review.
