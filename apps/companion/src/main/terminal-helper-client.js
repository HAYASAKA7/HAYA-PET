// Node-side client for the native terminal-window helper. Spawns the helper
// process and speaks the line-delimited JSON protocol from native/README.md,
// correlating responses to requests by id. `spawn` is injectable for tests.
export function createHelperClient({ spawn, command, args = [] } = {}) {
  if (typeof spawn !== "function") {
    throw new TypeError("spawn must be a function");
  }
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("command is required");
  }

  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let counter = 0;
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  child.on?.("error", (error) => rejectAll(error));
  child.on?.("close", () => rejectAll(new Error("helper process closed")));

  function handleLine(line) {
    if (line.trim() === "") {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // ignore non-protocol noise
    }

    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      entry.resolve(message);
    }
  }

  function rejectAll(error) {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  function request(op, params = {}) {
    const id = `req_${counter++}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`);
    });
  }

  return {
    capabilities() {
      return request("capabilities");
    },

    locate(pid, terminalPid) {
      return request("locate", terminalPid === undefined ? { pid } : { pid, terminalPid });
    },

    async close() {
      child.stdin.end?.();
      child.kill?.();
    }
  };
}
