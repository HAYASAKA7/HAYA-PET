# Windows Window Helper

Future helper responsibility:

- Walk from AI client PID to parent terminal process.
- Locate terminal HWND values with `EnumWindows` and `GetWindowThreadProcessId`.
- Return window bounds for bubble attachment.

The JavaScript facade currently exposes this as strategy `win32-window-helper`.
