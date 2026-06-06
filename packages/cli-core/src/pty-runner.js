// Thin wrapper around the optional `node-pty` native module. Runs a command in
// a real pseudo-terminal so interactive CLIs keep their TTY (colors, prompts,
// TUIs) while we also observe a copy of the output. node-pty is loaded lazily
// and treated as optional — callers fall back to a plain spawn if it is absent.

let ptyModulePromise;

async function loadPty() {
  if (!ptyModulePromise) {
    ptyModulePromise = import("node-pty")
      .then((mod) => mod.default ?? mod)
      .catch(() => null);
  }
  return ptyModulePromise;
}

export async function isPtyAvailable() {
  return Boolean(await loadPty());
}

export async function spawnPty({ command, args = [], cwd, env = process.env, onData, onInput, cols, rows } = {}) {
  const pty = await loadPty();
  if (!pty) {
    throw new Error("node-pty is not available");
  }

  const child = pty.spawn(command, args, {
    name: "xterm-color",
    cols: cols ?? process.stdout.columns ?? 80,
    rows: rows ?? process.stdout.rows ?? 30,
    cwd,
    env
  });

  // Tee PTY output: write to the terminal and hand a copy to the observer.
  child.onData((data) => {
    process.stdout.write(data);
    if (onData) {
      onData(data);
    }
  });

  // Forward the user's keystrokes into the PTY.
  const stdin = process.stdin;
  const hadRawMode = stdin.isRaw;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();
  // Don't let an open stdin keep the process alive after the child exits — the
  // PTY handle keeps the event loop alive while the command is actually running.
  if (typeof stdin.unref === "function") {
    stdin.unref();
  }
  const forwardInput = (chunk) => {
    if (onInput) {
      // Let the observer know the user is typing, so it doesn't mistake the
      // PTY's echo of these keystrokes for AI activity.
      onInput(chunk);
    }
    child.write(chunk.toString("utf8"));
  };
  stdin.on("data", forwardInput);

  const handleResize = () => {
    try {
      child.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 30);
    } catch {
      // ignore transient resize errors
    }
  };
  process.stdout.on("resize", handleResize);

  const exit = new Promise((resolve) => {
    child.onExit(({ exitCode, signal }) => {
      stdin.off("data", forwardInput);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        try {
          stdin.setRawMode(Boolean(hadRawMode));
        } catch {
          // ignore
        }
      }
      stdin.pause();
      process.stdout.off("resize", handleResize);
      resolve({ exitCode, signal });
    });
  });

  return {
    pid: child.pid,
    exit,
    write: (data) => child.write(data),
    kill: () => child.kill()
  };
}
