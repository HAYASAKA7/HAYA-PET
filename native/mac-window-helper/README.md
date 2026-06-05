# macOS Window Helper

Future helper responsibility:

- Locate Terminal.app, iTerm2, VS Code, or other terminal windows for tracked process trees.
- Use macOS Accessibility or window-list APIs where permission is available.
- Return window bounds and permission status for bubble attachment.

The JavaScript facade currently exposes this as strategy `macos-accessibility-helper`.
