# Troubleshooting

Quick fixes for common issues. See also [known-issues.md](known-issues.md) for
deferred problems with known root causes.

| Symptom | Fix |
|---|---|
| `ai-pet: command not found` | Install globally (`npm i -g …`), or in a source checkout run `npm link` in the repo root, or call the file directly: `node <repo>/apps/cli/src/ai-pet.js`. |
| Running a CLI starts the pet but not the command | Fixed — update to the latest version. (Was caused by the auto-start poll exiting early.) |
| Pet doesn't react to a session | Launch the CLI via `ai-pet run …`. If the overlay didn't auto-start, run `ai-pet start`, or check `AI_PET_NO_AUTOSTART` isn't set. |
| Pet shows a blue placeholder box | No spritesheet found — add a pet (see the README); behaviour is otherwise correct. |
| Pet is off-screen / can't find it | Tray icon → **Reset Position**. |
| Can't exit the pet | `ai-pet stop`, or right-click the tray icon → **Quit**. |
| `ai-pet pets` shows "No pets found" | Add a pet folder with **both** `pet.json` and a spritesheet to a search path. |
| Terminal scroll / backspace odd while a CLI runs under `ai-pet run` | Known PTY-observation tradeoff — see [known-issues.md](known-issues.md). Workaround: `ai-pet run --no-observe …`. |
| `ENOENT … electron\path.txt` | Electron's install extraction was interrupted — see below. |

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
