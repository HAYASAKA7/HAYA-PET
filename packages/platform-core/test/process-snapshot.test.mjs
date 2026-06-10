import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createProcessSnapshotLister } from "../src/process-snapshot.js";

// Each platform lister returns the same shape — the full process table as
// [{ pid, ppid }] — so the approval watcher core stays platform-agnostic.

test("windows lister parses the PowerShell pid/ppid table", async () => {
  const invocations = [];
  const lister = createProcessSnapshotLister({
    platform: "win32",
    execFile: async (file, args) => {
      invocations.push({ file, args });
      return { stdout: "4 0\r\n100 4\r\n2332 100\r\n\r\n" };
    }
  });

  const table = await lister();

  assert.deepEqual(table, [
    { pid: 4, ppid: 0 },
    { pid: 100, ppid: 4 },
    { pid: 2332, ppid: 100 }
  ]);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].file, "powershell.exe");
  // Must never load the user's profile or prompt interactively.
  assert.ok(invocations[0].args.includes("-NoProfile"));
  assert.ok(invocations[0].args.includes("-NonInteractive"));
});

test("darwin lister parses ps output with ragged spacing", async () => {
  const lister = createProcessSnapshotLister({
    platform: "darwin",
    execFile: async (file, args) => {
      assert.equal(file, "ps");
      assert.deepEqual(args, ["-axo", "pid=,ppid="]);
      return { stdout: "    1     0\n  455     1\n12034   455\n" };
    }
  });

  assert.deepEqual(await lister(), [
    { pid: 1, ppid: 0 },
    { pid: 455, ppid: 1 },
    { pid: 12034, ppid: 455 }
  ]);
});

test("linux lister reads /proc stat files, handling names with spaces and parens", async () => {
  const files = {
    "/proc/1/stat": "1 (systemd) S 0 1 1 0 -1 4194560",
    "/proc/455/stat": "455 (my (weird) name) S 1 455 455 0 -1 0",
    "/proc/9999/stat": "9999 (node) R 455 9999 9999 0 -1 0"
  };
  const lister = createProcessSnapshotLister({
    platform: "linux",
    readdir: async (dir) => {
      assert.equal(dir, "/proc");
      return ["1", "455", "9999", "self", "acpi", "cpuinfo"];
    },
    readFile: async (path) => {
      if (!(path in files)) {
        throw new Error(`unexpected read: ${path}`);
      }
      return files[path];
    }
  });

  assert.deepEqual(await lister(), [
    { pid: 1, ppid: 0 },
    { pid: 455, ppid: 1 },
    { pid: 9999, ppid: 455 }
  ]);
});

test("linux lister skips processes that vanish mid-scan", async () => {
  const lister = createProcessSnapshotLister({
    platform: "linux",
    readdir: async () => ["1", "2"],
    readFile: async (path) => {
      if (path === "/proc/2/stat") {
        throw new Error("ENOENT: gone");
      }
      return "1 (init) S 0 1 1 0 -1 0";
    }
  });

  assert.deepEqual(await lister(), [{ pid: 1, ppid: 0 }]);
});

test("listers skip malformed lines instead of failing", async () => {
  const lister = createProcessSnapshotLister({
    platform: "win32",
    execFile: async () => ({ stdout: "4 0\nnot numbers\n77\n100 4\n" })
  });

  assert.deepEqual(await lister(), [
    { pid: 4, ppid: 0 },
    { pid: 100, ppid: 4 }
  ]);
});

test("unsupported platforms yield no lister", () => {
  assert.equal(createProcessSnapshotLister({ platform: "sunos" }), undefined);
});
