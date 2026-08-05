# Codex Session Hook Isolation Design

## Problem

HAYA Pet currently installs its managed Codex hooks in the user's persistent
`$CODEX_HOME/hooks.json`. The hook dispatcher exits quickly when
`HAYA_PET_SESSION_ID` is absent or the companion is offline, but Codex discovers
and schedules the global hook before that check. As a result, a native Codex
session still displays `HAYA Pet live status` and starts the dispatcher even
when that session was not launched through HAYA Pet.

The required behavior is strict session isolation: a native Codex session must
never discover or launch a HAYA-managed hook, including while another
HAYA-wrapped Codex session is running.

## Constraints

- Preserve the user's selected `-p`/`--profile`, including profiles such as
  Sakana. HAYA must not consume Codex's single profile slot.
- Preserve user, project, profile, managed, and plugin hooks.
- Preserve arbitrary user `-c`/`--config` arguments.
- Keep hook trust stable across wrapped launches when the hook command has not
  changed.
- Do not force Codex's `features.hooks` setting.
- Remove only entries that can be identified as HAYA-managed.
- Keep the offline dispatcher as defense in depth for stale processes and
  direct invocation.

## Architecture

### Per-launch session hook layer

The Codex injector will stop adding HAYA hooks to the user-level
`$CODEX_HOME/hooks.json`. Instead, it will convert the existing adapter output
into repeatable Codex CLI overrides:

```text
-c hooks.UserPromptSubmit=[...]
-c hooks.PermissionRequest=[...]
-c hooks.Stop=[...]
```

Codex loads `-c` values as its `SessionFlags` configuration layer. Hook
discovery assigns that layer the stable synthetic source
`<session-flags>/config.toml`, so unchanged hook definitions retain a stable
trust identity without creating a profile or changing `CODEX_HOME`.

HAYA's generated arguments are prepended to the user's child arguments. This
keeps global flags in a valid position for `codex`, `codex resume`, and other
subcommands. It also gives later user-provided `-c` values precedence if the
user explicitly overrides the same session hook key.

HAYA will not add `--enable hooks` or `-c features.hooks=true`. A user or
administrator who disables Codex hooks keeps that decision.

### Stable command identity

Hook trust includes the normalized command. The injector will retain a stable
node executable and dispatcher path in HAYA-owned state. On migration it will
prefer an existing valid HAYA command found in `$CODEX_HOME/hooks.json`; on
later launches it will reuse the stored paths while both still exist. It will
resolve new paths only when the stored command is unusable.

A path change can legitimately require another Codex review because the
executable definition changed. Switching profiles alone must not.

### Legacy global-hook migration

Every Codex hook injection will inspect `$CODEX_HOME/hooks.json` and remove only
handlers recognized as HAYA-managed by the existing status marker or HAYA
dispatcher/reporter command signature. It will preserve:

- unrelated handlers in the same matcher group;
- unrelated matcher groups and events;
- unknown top-level JSON fields; and
- the file itself when user-owned content remains.

The migration will avoid rewriting the file when its serialized content is
unchanged. Existing HAYA trust-state entries for the old global source may
remain as inert Codex metadata; removing private trust records is unnecessary
for correctness and would increase migration risk.

The first wrapped launch after migration may require one final review because
the source identity changes from `$CODEX_HOME/hooks.json` to
`<session-flags>/config.toml`. Once approved, unchanged session hooks remain
trusted across default and named-profile launches.

## Data Flow

1. `haya-pet run --client codex` confirms the companion is online and live
   hooks are enabled.
2. The injector resolves or reuses stable command paths.
3. The injector removes legacy HAYA handlers from the global `hooks.json`
   without modifying user handlers.
4. The injector builds one session override per HAYA hook event.
5. The wrapper prepends those overrides to the user's original Codex arguments
   and sets `HAYA_PET_SESSION_ID` in only the wrapped child environment.
6. Wrapped Codex discovers the session hooks and reports to the companion.
7. Native Codex has neither the session arguments nor the session environment,
   so it does not discover, display, or launch HAYA hooks.

## Error Handling

- Invalid existing `hooks.json` remains a surfaced configuration error rather
  than being overwritten.
- Failure to persist HAYA's stable command metadata falls back to the current
  resolved paths for that launch and reports the filesystem error through the
  existing CLI error path.
- TOML session values are generated from structured hook settings with proper
  string escaping; no shell interpolation is used to construct hook content.
- If a user override replaces a HAYA event in the same session layer, the user
  override wins. Other HAYA signals and transcript watchers continue where
  available.

## Testing

Focused tests will prove that:

- the injector returns session `-c` arguments and does not install global HAYA
  handlers;
- migration removes only HAYA handlers from mixed global hook files;
- native Codex arguments contain no HAYA configuration;
- wrapped Codex arguments preserve `--profile sakana` and arbitrary user
  `-c` values;
- HAYA overrides precede user arguments;
- stable command paths survive Node-version or launcher-path changes while the
  recorded paths remain valid;
- invalid or unusable stored paths fall back safely;
- `features.hooks=false` is not overridden; and
- the generated TOML values are accepted by the supported Codex CLI shape.

The full repository test and lint suites will run after the focused tests.

## Acceptance Criteria

- Starting native Codex never shows or launches `HAYA Pet live status`.
- The guarantee holds while a HAYA-wrapped Codex session runs concurrently.
- A wrapped Codex session still reports live status.
- A selected Sakana or other named profile remains active.
- Existing non-HAYA hooks remain intact and runnable.
- Hook review occurs at most once for an unchanged session-hook definition
  after migration.
