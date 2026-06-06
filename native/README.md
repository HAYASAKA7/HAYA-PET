# Native Window Helpers

Terminal-window discovery is platform-specific and is isolated behind small,
optional native helper processes. The JavaScript runtime never links native
code directly; it spawns a helper and talks to it over a line-delimited JSON
protocol on stdin/stdout. This keeps the daemon portable and lets the helper be
written in the most appropriate language per OS (C#/Win32, Swift/AppKit, C/Xlib).

The `apps/companion/src/main/terminal-locator.js` facade decides *which* helper
strategy applies per platform (`win32-window-helper`, `macos-accessibility-helper`,
`x11-window-helper`, or `manual-fallback`). When the strategy is implemented, the
main process spawns the matching helper and uses this contract.

## Transport

- One JSON object per line (`\n`-delimited), UTF-8, on both stdin and stdout.
- The helper is long-lived: it reads requests until stdin closes.
- The helper must never write anything but protocol JSON to stdout. Diagnostics
  go to stderr.

## Requests

```json
{ "id": "req_1", "op": "capabilities" }
```

```json
{ "id": "req_2", "op": "locate", "pid": 12345, "terminalPid": 5678 }
```

| Field | Meaning |
|---|---|
| `id` | Opaque correlation id echoed back in the response. |
| `op` | `"capabilities"` or `"locate"`. |
| `pid` | AI client process id (walk its parent tree to the terminal). |
| `terminalPid` | Optional known terminal pid hint. |

## Responses

Capabilities:

```json
{ "id": "req_1", "ok": true, "capabilities": { "locate": true, "follow": false, "permission": "granted" } }
```

Locate (found):

```json
{
  "id": "req_2",
  "ok": true,
  "window": {
    "x": 100,
    "y": 200,
    "width": 1200,
    "height": 760,
    "displayId": "primary",
    "title": "pwsh — project",
    "confidence": 0.8
  }
}
```

Locate (not found / unsupported / permission denied):

```json
{ "id": "req_2", "ok": false, "error": "not_found" }
```

`error` is one of: `not_found`, `unsupported`, `permission_denied`, `invalid_request`.

## Rules

- Coordinates are in OS virtual-screen pixels; the runtime converts to the pet's
  display/DPI space using `display-manager.js`.
- A helper that cannot resolve a window must return `ok:false`, never guess.
- `permission` in capabilities lets the UI explain why attachment is unavailable
  (e.g. macOS Accessibility not granted) and fall back to manual/cluster bubbles.
- Helpers are best-effort. The runtime always supports manual bubble positioning
  when a helper reports `unsupported` or `permission_denied`.
