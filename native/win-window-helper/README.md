# Windows Window Helper

Strategy id: `win32-window-helper` (best-effort).

Implements the shared helper protocol in [`../README.md`](../README.md).

## Responsibility

- Walk from the AI client PID up the parent process tree to the hosting terminal
  process (`WindowsTerminal.exe`, `powershell.exe`, `pwsh.exe`, `cmd.exe`, `Code.exe`).
- Enumerate top-level windows with `EnumWindows`, match the owning PID with
  `GetWindowThreadProcessId`, and read bounds with `GetWindowRect`.
- Return window bounds for bubble attachment.

## Implementation notes

- Suggested language: C# (.NET) or C++ with the Win32 API.
- Use per-monitor DPI awareness (`SetProcessDpiAwarenessContext`) so reported
  bounds are physical pixels the runtime can convert.
- Windows Terminal tab/pane precision is not reliable; return the window rect and
  let the runtime attach to a corner. Report `confidence` accordingly.
- VS Code integrated terminal pane precision requires a VS Code extension; the
  helper should return the editor window rect with lower `confidence`.

## Protocol mapping

- `op: "capabilities"` → `{ "locate": true, "follow": false, "permission": "granted" }`.
- `op: "locate"` → `window` rect on success, or `{ "ok": false, "error": "not_found" }`.

## Status: implemented

This helper is implemented in C# (.NET, `Program.cs`) and builds with the .NET
SDK. It walks the process tree with Toolhelp (`CreateToolhelp32Snapshot`),
enumerates top-level windows (`EnumWindows` + `GetWindowThreadProcessId` +
`GetWindowRect`), prefers known terminal processes, and is per-monitor DPI aware.

### Build

```bash
cd native/win-window-helper
dotnet build -c Release
# -> bin/Release/net10.0-windows/haya-pet-win-window-helper.exe
```

### Try it

```bash
echo {"id":"a","op":"capabilities"} | bin/Release/net10.0-windows/haya-pet-win-window-helper.exe
```

The `apps/companion/src/main/terminal-helper-client.js` client spawns this exe
and speaks the protocol; the companion converts the returned window bounds to the
pet's display/DPI space via `display-manager.js`.
