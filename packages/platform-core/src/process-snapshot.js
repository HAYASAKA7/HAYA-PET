// Cross-OS process-table snapshots: every lister resolves to the full process
// list as [{ pid, ppid }], so consumers (the approval watcher) never branch on
// platform. Returns undefined on platforms we don't support — callers treat
// that as "feature unavailable", never as an error.
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readdir as readdirFs, readFile as readFileFs } from "node:fs/promises";

const execFileAsync = promisify(execFileCb);

// One pid+ppid pair per line, whitespace-separated — both `ps` and our
// PowerShell query are shaped to emit exactly this.
function parsePidTable(stdout) {
  const table = [];
  for (const line of String(stdout).split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) {
      continue;
    }
    const pid = Number.parseInt(parts[0], 10);
    const ppid = Number.parseInt(parts[1], 10);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) {
      table.push({ pid, ppid });
    }
  }
  return table;
}

export function createProcessSnapshotLister(options = {}) {
  const {
    platform = process.platform,
    execFile = execFileAsync,
    readdir = readdirFs,
    readFile = readFileFs
  } = options;

  if (platform === "win32") {
    // CIM query via PowerShell (wmic is removed on current Windows 11). Output
    // is forced to bare "pid ppid" lines to keep parsing trivial.
    const script =
      "Get-CimInstance -ClassName Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }";
    return async () => {
      const { stdout } = await execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true }
      );
      return parsePidTable(stdout);
    };
  }

  if (platform === "darwin") {
    return async () => {
      const { stdout } = await execFile("ps", ["-axo", "pid=,ppid="]);
      return parsePidTable(stdout);
    };
  }

  if (platform === "linux") {
    // Read /proc directly — no subprocess at all. stat field 4 is ppid, but the
    // comm field (2) is parenthesised and may contain spaces/parens, so parse
    // from AFTER the last ')'.
    return async () => {
      const entries = await readdir("/proc");
      const table = [];
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) {
          continue;
        }
        let stat;
        try {
          stat = String(await readFile(`/proc/${entry}/stat`, "utf8"));
        } catch {
          continue; // process exited mid-scan
        }
        const afterComm = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        const ppid = Number.parseInt(afterComm[1], 10);
        const pid = Number.parseInt(entry, 10);
        if (Number.isInteger(pid) && Number.isInteger(ppid)) {
          table.push({ pid, ppid });
        }
      }
      return table;
    };
  }

  return undefined;
}
