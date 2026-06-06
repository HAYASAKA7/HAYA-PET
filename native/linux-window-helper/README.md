# Linux Window Helper

Strategy ids: `x11-window-helper` (X11, best-effort) and `manual-fallback` (Wayland).

Implements the shared helper protocol in [`../README.md`](../README.md).

## Responsibility

- On X11: discover terminal windows through Xlib (`_NET_WM_PID`, `XGetWindowProperty`)
  or a `wmctrl`/`xdotool`-style approach, match the tracked process tree, and
  return window bounds.
- On Wayland: report limited capability instead of assuming global window
  positioning works.

## Implementation notes

- Suggested language: C with Xlib/XCB, or a thin wrapper over `wmctrl`/`xdotool`.
- X11: match `_NET_WM_PID` against the AI client's parent terminal pid; read
  geometry via `XGetGeometry` + `XTranslateCoordinates` for absolute coordinates.
- Wayland: most compositors block global window enumeration/positioning. The
  helper should answer `capabilities` with `{ "locate": false }` and return
  `{ "ok": false, "error": "unsupported" }` for `locate`, so the runtime uses
  global pet + cluster/manual bubbles.

## Protocol mapping

- X11 `op: "capabilities"` → `{ "locate": true, "follow": false, "permission": "granted" }`.
- Wayland `op: "capabilities"` → `{ "locate": false, "follow": false, "permission": "granted" }`.
- `op: "locate"` → `window` rect on X11 when found, otherwise `not_found` / `unsupported`.
