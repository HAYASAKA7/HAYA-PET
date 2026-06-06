# macOS Window Helper

Strategy id: `macos-accessibility-helper` (best-effort).

Implements the shared helper protocol in [`../README.md`](../README.md).

## Responsibility

- Locate Terminal.app, iTerm2, VS Code, or other terminal windows for tracked
  process trees.
- Use the Accessibility API (`AXUIElement`) or `CGWindowListCopyWindowInfo`
  where permission is available.
- Return window bounds and permission status for bubble attachment.

## Implementation notes

- Suggested language: Swift with AppKit/ApplicationServices.
- Accessibility requires the user to grant permission in System Settings →
  Privacy & Security → Accessibility. When not granted, return
  `{ "ok": false, "error": "permission_denied" }` and report
  `"permission": "denied"` from `capabilities` so the UI can prompt the user.
- Handle Retina scale: report points and include the backing scale so the
  runtime can map to device pixels.
- Spaces/full-screen windows may be undiscoverable; return `not_found` rather
  than guessing.

## Protocol mapping

- `op: "capabilities"` → `{ "locate": true, "follow": false, "permission": "granted" | "denied" }`.
- `op: "locate"` → `window` rect on success, or `permission_denied` / `not_found`.
