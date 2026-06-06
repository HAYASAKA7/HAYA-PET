// AI Pet — Windows window helper.
//
// Implements the line-delimited JSON helper protocol documented in
// ../README.md. Reads one JSON request per line on stdin and writes one JSON
// response per line on stdout. Diagnostics (if any) go to stderr only.
//
// Supported ops:
//   { "id": "...", "op": "capabilities" }
//   { "id": "...", "op": "locate", "pid": <int>, "terminalPid": <int?> }

using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;

[assembly: SupportedOSPlatform("windows")]

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
};

// Per-monitor DPI awareness so GetWindowRect returns physical pixels the
// runtime can convert via its display manager. Best-effort; ignore failure.
try { Native.SetProcessDpiAwarenessContext(Native.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
catch { /* older Windows: ignore */ }

string? line;
while ((line = Console.ReadLine()) != null)
{
    if (string.IsNullOrWhiteSpace(line))
    {
        continue;
    }

    object response;
    try
    {
        response = Handle(line);
    }
    catch (Exception ex)
    {
        response = new { id = (string?)null, ok = false, error = "invalid_request", detail = ex.Message };
    }

    Console.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
    Console.Out.Flush();
}

object Handle(string requestLine)
{
    using var doc = JsonDocument.Parse(requestLine);
    var root = doc.RootElement;

    string? id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
    string op = root.TryGetProperty("op", out var opEl) ? opEl.GetString() ?? "" : "";

    switch (op)
    {
        case "capabilities":
            return new
            {
                id,
                ok = true,
                capabilities = new { locate = true, follow = false, permission = "granted" }
            };

        case "locate":
            if (!root.TryGetProperty("pid", out var pidEl) || !pidEl.TryGetInt32(out int pid))
            {
                return new { id, ok = false, error = "invalid_request" };
            }

            int? terminalPid = root.TryGetProperty("terminalPid", out var tEl) && tEl.TryGetInt32(out int t) ? t : null;
            var window = WindowLocator.Locate(pid, terminalPid);
            return window is null
                ? new { id, ok = false, error = "not_found" }
                : new { id, ok = true, window };

        default:
            return new { id, ok = false, error = "invalid_request" };
    }
}

/// <summary>Resolves the terminal window for an AI client process tree.</summary>
static class WindowLocator
{
    // Process names that own a real terminal window, ranked first when matched.
    private static readonly HashSet<string> KnownTerminals = new(StringComparer.OrdinalIgnoreCase)
    {
        "WindowsTerminal.exe", "powershell.exe", "pwsh.exe", "cmd.exe",
        "Code.exe", "wezterm-gui.exe", "alacritty.exe", "conemu64.exe", "conemu.exe"
    };

    public static object? Locate(int pid, int? terminalPid)
    {
        var processNames = ProcessTree.SnapshotNames();
        var parents = ProcessTree.SnapshotParents();

        // Candidate pids: the client, an explicit terminal hint, and all ancestors.
        var candidates = new HashSet<int>();
        AddAncestors(pid, parents, candidates);
        if (terminalPid is int hint)
        {
            AddAncestors(hint, parents, candidates);
        }

        (IntPtr hWnd, int pidOwner, Native.RECT rect, string title)? best = null;
        int bestScore = int.MinValue;

        Native.EnumWindows((hWnd, _) =>
        {
            if (!Native.IsWindowVisible(hWnd))
            {
                return true;
            }

            Native.GetWindowThreadProcessId(hWnd, out uint wpid);
            if (!candidates.Contains((int)wpid))
            {
                return true;
            }

            if (!Native.GetWindowRect(hWnd, out var rect))
            {
                return true;
            }

            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0)
            {
                return true;
            }

            string title = GetTitle(hWnd);
            if (title.Length == 0)
            {
                return true;
            }

            int score = Score((int)wpid, width, height, processNames);
            if (score > bestScore)
            {
                bestScore = score;
                best = (hWnd, (int)wpid, rect, title);
            }

            return true;
        }, IntPtr.Zero);

        if (best is null)
        {
            return null;
        }

        var b = best.Value;
        bool knownTerminal = processNames.TryGetValue(b.pidOwner, out var name) && KnownTerminals.Contains(name);

        return new
        {
            x = b.rect.Left,
            y = b.rect.Top,
            width = b.rect.Right - b.rect.Left,
            height = b.rect.Bottom - b.rect.Top,
            displayId = "primary",
            title = b.title,
            confidence = knownTerminal ? 0.8 : 0.5
        };
    }

    private static int Score(int pid, int width, int height, IReadOnlyDictionary<int, string> names)
    {
        // Prefer known terminal processes, then larger windows.
        int terminalBonus = names.TryGetValue(pid, out var name) && KnownTerminals.Contains(name) ? 1_000_000_000 : 0;
        return terminalBonus + Math.Min(width * height, 900_000_000);
    }

    private static void AddAncestors(int pid, IReadOnlyDictionary<int, int> parents, HashSet<int> into)
    {
        int current = pid;
        int guard = 0;
        while (current > 0 && into.Add(current) && guard++ < 64)
        {
            if (!parents.TryGetValue(current, out int parent) || parent == current)
            {
                break;
            }
            current = parent;
        }
    }

    private static string GetTitle(IntPtr hWnd)
    {
        int length = Native.GetWindowTextLengthW(hWnd);
        if (length <= 0)
        {
            return "";
        }

        var sb = new StringBuilder(length + 1);
        Native.GetWindowTextW(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }
}

/// <summary>Reads the live process table once per request via Toolhelp.</summary>
static class ProcessTree
{
    public static Dictionary<int, int> SnapshotParents() => Snapshot().parents;

    public static Dictionary<int, string> SnapshotNames() => Snapshot().names;

    private static (Dictionary<int, int> parents, Dictionary<int, string> names) Snapshot()
    {
        var parents = new Dictionary<int, int>();
        var names = new Dictionary<int, string>();

        IntPtr snapshot = Native.CreateToolhelp32Snapshot(Native.TH32CS_SNAPPROCESS, 0);
        if (snapshot == Native.INVALID_HANDLE_VALUE)
        {
            return (parents, names);
        }

        try
        {
            var entry = new Native.PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<Native.PROCESSENTRY32W>() };
            if (Native.Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    parents[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                    names[(int)entry.th32ProcessID] = entry.szExeFile ?? "";
                }
                while (Native.Process32NextW(snapshot, ref entry));
            }
        }
        finally
        {
            Native.CloseHandle(snapshot);
        }

        return (parents, names);
    }
}

static class Native
{
    public const uint TH32CS_SNAPPROCESS = 0x00000002;
    public static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);
    public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
