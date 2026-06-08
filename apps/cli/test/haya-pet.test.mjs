import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createDaemonRuntime } from "../../../packages/daemon-core/src/daemon-runtime.js";
import { createIpcServer } from "../../../packages/daemon-core/src/ipc-server.js";
import { parseAiPetArgs, runAiPet } from "../src/haya-pet.js";

test("parses generic run command arguments", () => {
  assert.deepEqual(
    parseAiPetArgs(["run", "--no-observe", "--client", "generic", "--", "node", "-e", "process.exit(0)"]),
    {
      command: "run",
      clientId: "generic",
      observe: false,
      childCommand: "node",
      childArgs: ["-e", "process.exit(0)"]
    }
  );
});

test("native passthrough is the default and --observe opts in", () => {
  assert.equal(parseAiPetArgs(["run", "--client", "codex"]).observe, false);
  assert.equal(parseAiPetArgs(["run", "--observe", "--client", "codex"]).observe, true);

  const parsedWithCommand = parseAiPetArgs(["run", "--", "claude", "--resume"]);
  assert.equal(parsedWithCommand.observe, false);
  assert.equal(parsedWithCommand.childCommand, "claude");
  assert.deepEqual(parsedWithCommand.childArgs, ["--resume"]);
});

test("defaults run command client to generic", () => {
  assert.equal(parseAiPetArgs(["run", "--", "node"]).clientId, "generic");
});

test("falls back to the client default command when no -- is given", () => {
  assert.deepEqual(parseAiPetArgs(["run", "--no-observe", "--client", "codex"]), {
    command: "run",
    clientId: "codex",
    observe: false,
    childCommand: "codex",
    childArgs: []
  });
  assert.equal(parseAiPetArgs(["run", "--client", "claude-code"]).childCommand, "claude");
  assert.equal(parseAiPetArgs(["run", "--client", "antigravity"]).childCommand, "antigravity");
});

test("still requires -- for generic (no default command)", () => {
  assert.throws(() => parseAiPetArgs(["run", "--client", "generic"]), /no default command/);
});

test("accepts a bare command without -- (shells may strip the separator)", () => {
  assert.deepEqual(parseAiPetArgs(["run", "--no-observe", "node", "-v"]), {
    command: "run",
    clientId: "generic",
    observe: false,
    childCommand: "node",
    childArgs: ["-v"]
  });
  // The shape PowerShell's npm shim produces after stripping `--`:
  assert.deepEqual(parseAiPetArgs(["run", "--no-observe", "--client", "claude-code", "claude", "--resume"]), {
    command: "run",
    clientId: "claude-code",
    observe: false,
    childCommand: "claude",
    childArgs: ["--resume"]
  });
});

test("rejects unsupported commands and missing arguments", () => {
  assert.throws(() => parseAiPetArgs(["status"]), /Unsupported haya-pet command: status/);
  assert.throws(() => parseAiPetArgs(["run", "--client"]), /--client requires a value/);
  assert.throws(() => parseAiPetArgs(["run", "--"]), /run requires a child command/);
  assert.throws(() => parseAiPetArgs(["run", "--bogus"]), /Unknown run option/);
});

test("runs parsed command through injectable generic runner", async () => {
  const calls = [];
  const result = await runAiPet(
    ["run", "--client", "generic", "--", "node", "-e", "process.exit(0)"],
    {
      cwd: "D:\\Work\\project",
      heartbeatIntervalMs: 10,
      send: async () => {},
      runGenericCommand: async (options) => {
        calls.push(options);
        return { sessionId: "sess_a", pid: 123, exitCode: 0 };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "node");
  assert.deepEqual(calls[0].args, ["-e", "process.exit(0)"]);
  assert.equal(calls[0].clientId, "generic");
  assert.equal(calls[0].clientDisplayName, "Generic");
  assert.equal(calls[0].cwd, "D:\\Work\\project");
  assert.equal(calls[0].heartbeatIntervalMs, 10);
});

test("runs command through daemon IPC when no send function is injected", async () => {
  const runtime = createDaemonRuntime();
  const server = await createIpcServer({
    endpoint: "test-haya-petd",
    platform: "test",
    onMessage: (message) => runtime.handleMessage(message)
  });

  try {
    const result = await runAiPet(
      // --no-observe keeps this lifecycle test on the deterministic plain path.
      ["run", "--no-observe", "--client", "generic", "--", process.execPath, "-e", "process.exit(0)"],
      {
        cwd: process.cwd(),
        stdio: "ignore",
        heartbeatIntervalMs: 10,
        ipcEndpoint: server.endpoint
      }
    );

    await waitFor(() => runtime.getSession(result.sessionId)?.state === "exited");

    const session = runtime.getSession(result.sessionId);
    assert.equal(result.exitCode, 0);
    assert.equal(session.clientId, "generic");
    assert.equal(session.state, "exited");
    assert.equal(session.exitCode, 0);
  } finally {
    await server.close();
  }
});

test("parses pets list and pets use commands", () => {
  assert.deepEqual(parseAiPetArgs(["pets"]), { command: "pets", action: "list" });
  assert.deepEqual(parseAiPetArgs(["pets", "list"]), { command: "pets", action: "list" });
  assert.deepEqual(parseAiPetArgs(["pets", "use", "cat"]), { command: "pets", action: "use", petId: "cat" });
  assert.throws(() => parseAiPetArgs(["pets", "use"]), /pets use requires a pet id/);
  assert.throws(() => parseAiPetArgs(["pets", "bogus"]), /Unknown pets action: bogus/);
});

test("pets list marks the currently selected pet", async () => {
  const lines = [];
  const result = await runAiPet(["pets", "list"], {
    homeDir: "C:\\Users\\A",
    discoverPets: async () => [
      { manifest: { id: "cat", name: "Cat" } },
      { manifest: { id: "dog", name: "Dog" } }
    ],
    createStateFile: () => fakeStateFile({ globalPet: { selectedPetId: "dog" } }),
    print: (line) => lines.push(line)
  });

  assert.deepEqual(result.pets, ["cat", "dog"]);
  assert.equal(result.selectedId, "dog");
  assert.ok(lines.some((line) => line.startsWith("* dog")));
  assert.ok(lines.some((line) => line.startsWith("  cat")));
});

test("pets use stores the selection in the state file", async () => {
  const store = fakeStateFile({ globalPet: {} });
  const result = await runAiPet(["pets", "use", "cat"], {
    homeDir: "C:\\Users\\A",
    discoverPets: async () => [{ manifest: { id: "cat", name: "Cat" } }],
    createStateFile: () => store,
    print: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(store.current().globalPet.selectedPetId, "cat");
});

test("pets use still stores an id that is not currently installed", async () => {
  const store = fakeStateFile({ globalPet: {} });
  const lines = [];
  const result = await runAiPet(["pets", "use", "ghost"], {
    homeDir: "C:\\Users\\A",
    discoverPets: async () => [],
    createStateFile: () => store,
    print: (line) => lines.push(line)
  });

  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.equal(store.current().globalPet.selectedPetId, "ghost");
  assert.ok(lines.some((line) => line.includes("not currently installed")));
});

function fakeStateFile(initial) {
  let state = initial;
  return {
    statePath: "state.json",
    load: async () => state,
    save: async (next) => {
      state = next;
      return next;
    },
    current: () => state
  };
}

test("still runs the wrapped command when no daemon is available", async () => {
  const calls = [];
  const result = await runAiPet(
    ["run", "--client", "generic", "--", "node", "-e", "process.exit(0)"],
    {
      cwd: process.cwd(),
      heartbeatIntervalMs: 10,
      autoStart: false, // no daemon and no auto-start -> degrade gracefully
      createIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      runGenericCommand: async (options) => {
        calls.push(options);
        return { sessionId: "sess_a", pid: 123, exitCode: 0 };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
});

test("auto-starts the companion when one is not already running", async () => {
  const calls = [];
  let launched = 0;
  let connects = 0;

  const result = await runAiPet(
    ["run", "--client", "generic", "--", "node", "-e", "process.exit(0)"],
    {
      cwd: process.cwd(),
      heartbeatIntervalMs: 10,
      sleep: async () => {}, // no real waiting between connect attempts
      createIpcClient: async () => {
        connects += 1;
        if (connects === 1) {
          throw new Error("ECONNREFUSED"); // not running yet
        }
        return { send: async () => {}, close: async () => {} }; // up after launch
      },
      launchCompanion: async () => {
        launched += 1;
      },
      runGenericCommand: async (options) => {
        calls.push(options);
        return { sessionId: "sess_a", pid: 123, exitCode: 0 };
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(launched, 1, "launches the companion exactly once");
  assert.equal(calls.length, 1, "still runs the wrapped command");
});

test("HAYA_PET_NO_AUTOSTART disables auto-starting the companion", async () => {
  let launched = 0;
  await runAiPet(
    ["run", "--client", "generic", "--", "node", "-e", "process.exit(0)"],
    {
      cwd: process.cwd(),
      heartbeatIntervalMs: 10,
      env: { HAYA_PET_NO_AUTOSTART: "1" },
      ipcEndpoint: "test-endpoint",
      createIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      launchCompanion: async () => {
        launched += 1;
      },
      runGenericCommand: async () => ({ sessionId: "sess_a", pid: 1, exitCode: 0 })
    }
  );

  assert.equal(launched, 0);
});

test("parses the start command and reports when already running", async () => {
  assert.deepEqual(parseAiPetArgs(["start"]), { command: "start" });

  const lines = [];
  const result = await runAiPet(["start"], {
    createIpcClient: async () => ({ send: async () => {}, close: async () => {} }),
    launchCompanion: async () => {
      throw new Error("should not launch when already running");
    },
    print: (line) => lines.push(line)
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, false);
  assert.ok(lines.some((line) => line.includes("already running")));
});

test("stop command sends a shutdown to a running companion", async () => {
  assert.deepEqual(parseAiPetArgs(["stop"]), { command: "stop" });

  const sent = [];
  const lines = [];
  const result = await runAiPet(["stop"], {
    createIpcClient: async () => ({
      send: async (message) => sent.push(message),
      close: async () => {}
    }),
    print: (line) => lines.push(line)
  });

  assert.equal(result.ok, true);
  assert.equal(result.wasRunning, true);
  assert.deepEqual(sent, [{ type: "shutdown" }]);
  assert.ok(lines.some((line) => line.includes("stopped")));
});

test("stop command is a no-op when nothing is running", async () => {
  const lines = [];
  const result = await runAiPet(["stop"], {
    ipcEndpoint: "test-endpoint",
    createIpcClient: async () => {
      throw new Error("ECONNREFUSED");
    },
    print: (line) => lines.push(line)
  });

  assert.equal(result.ok, true);
  assert.equal(result.wasRunning, false);
  assert.ok(lines.some((line) => line.includes("not running")));
});

test("parses the state command", () => {
  assert.deepEqual(parseAiPetArgs(["state", "thinking", "--session", "sess_q"]), {
    command: "state",
    state: "thinking",
    summary: undefined,
    session: "sess_q"
  });
});

test("claude-code does NOT inject hooks by default (safe out-of-box)", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    injectClaudeHooks: () => { injected += 1; return { settingsPath: "x", cleanup: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: "s", pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 0, "no hook injection unless opted in");
  assert.deepEqual(calls[0].args, []);
});

test("HAYA_PET_HOOKS=1 opts claude-code into --settings + HAYA_PET_SESSION_ID", async () => {
  const calls = [];
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A", HOME: "/home/a" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    injectClaudeHooks: () => ({ settingsPath: "/tmp/s.json", cleanup: () => {} }),
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["--settings", "/tmp/s.json"]);
  assert.equal(calls[0].env.HAYA_PET_SESSION_ID, calls[0].sessionId);
  assert.ok(calls[0].sessionId, "a session id was generated and shared via env");
});

test("non-claude clients are never injected even with HAYA_PET_HOOKS=1", async () => {
  const calls = [];
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    injectClaudeHooks: () => { throw new Error("should not inject for codex"); },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: "s", pid: 1, exitCode: 0 };
    }
  });
  assert.deepEqual(calls[0].args, []);
});

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
