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

test("run prints an update notice only after the wrapped command exits", async () => {
  const order = [];

  await runAiPet(["run", "--client", "generic", "--", "node", "-v"], {
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    print: (line) => order.push(line),
    checkForUpdate: async () => ({ currentVersion: "0.2.7", latestVersion: "9.9.9" }),
    runGenericCommand: async (options) => {
      order.push("child-finished");
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const noticeIndex = order.findIndex((entry) => entry.includes("update available"));
  assert.ok(noticeIndex !== -1, "notice printed");
  assert.ok(order[noticeIndex].includes("0.2.7 → 9.9.9"), "notice names both versions");
  assert.ok(order[noticeIndex].includes("npm install -g @hayasaka7/haya-pet"), "notice gives the command");
  assert.ok(noticeIndex > order.indexOf("child-finished"), "notice comes after the child exits");
});

test("run prints no update notice when the check finds nothing", async () => {
  const lines = [];

  await runAiPet(["run", "--client", "generic", "--", "node", "-v"], {
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    print: (line) => lines.push(line),
    checkForUpdate: async () => undefined,
    runGenericCommand: async (options) => ({ sessionId: options.sessionId, pid: 1, exitCode: 0 })
  });

  assert.ok(!lines.some((line) => line.includes("update available")));
});

test("start prints an update notice after its status line", async () => {
  const lines = [];

  await runAiPet(["start"], {
    env: { USERPROFILE: "C:\\Users\\A" },
    createIpcClient: async () => ({ send: async () => {}, close: async () => {} }),
    launchCompanion: async () => {},
    print: (line) => lines.push(line),
    checkForUpdate: async () => ({ currentVersion: "0.2.7", latestVersion: "9.9.9" })
  });

  const noticeIndex = lines.findIndex((line) => line.includes("update available"));
  assert.ok(noticeIndex !== -1, "notice printed");
  assert.ok(noticeIndex > lines.findIndex((line) => line.includes("already running")));
});

test("run returns even when the companion connection hangs on close", async () => {
  const result = await runAiPet(["run", "--client", "generic", "--", "node", "-v"], {
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    senderDeadlineMs: 20,
    createIpcClient: async () => ({
      send: async () => {},
      close: () => new Promise(() => {})
    }),
    runGenericCommand: async (options) => ({ sessionId: options.sessionId, pid: 1, exitCode: 0 })
  });

  assert.equal(result.exitCode, 0);
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
    session: "sess_q",
  });
});

test("parses the Codex permission request reporter command", () => {
  assert.deepEqual(parseAiPetArgs(["codex-permission-request"]), {
    command: "codex-permission-request"
  });
});

test("Codex permission request reporter shows reviewing for auto-review", async () => {
  const messages = [];
  await runAiPet(["codex-permission-request"], {
    env: {
      HAYA_PET_SESSION_ID: "sess_review",
      HAYA_PET_CODEX_APPROVAL_REVIEWER: "auto_review"
    },
    now: () => 123,
    ipcEndpoint: "test-endpoint",
    createIpcClient: async () => ({
      send: async (message) => messages.push(message),
      close: async () => {}
    })
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].state, "reviewing");
  assert.equal(messages[0].summary, "agent reviewing approval");
});

test("Codex permission request reporter shows waiting for manual reviewer", async () => {
  const messages = [];
  await runAiPet(["codex-permission-request"], {
    env: {
      HAYA_PET_SESSION_ID: "sess_manual",
      HAYA_PET_CODEX_APPROVAL_REVIEWER: "user"
    },
    now: () => 123,
    ipcEndpoint: "test-endpoint",
    createIpcClient: async () => ({
      send: async (message) => messages.push(message),
      close: async () => {}
    })
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].state, "waiting_approval");
  assert.equal(messages[0].summary, "approval");
});

const hooksStateFile = (hooksEnabled) => () => ({
  load: async () => ({ settings: { hooksEnabled } }),
  save: async (state) => state
});

test("claude-code does NOT inject hooks by default (safe out-of-box)", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(false),
    injectClaudeHooks: () => { injected += 1; return { settingsPath: "x", cleanup: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: "s", pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 0, "no hook injection unless opted in");
  assert.deepEqual(calls[0].args, []);
});

test("persisted `hooks on` opts claude-code into injection without an env var", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" }, // no HAYA_PET_HOOKS
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true), // persisted preference = on
    injectClaudeHooks: () => { injected += 1; return { settingsPath: "/tmp/s.json", cleanup: () => {} }; },
    watchClaudeTranscript: () => ({ stop: () => {} }),
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 1, "config preference enables hooks");
  assert.deepEqual(calls[0].args, ["--settings", "/tmp/s.json"]);
});

test("HAYA_PET_NO_HOOKS=1 overrides a persisted `hooks on`", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { HAYA_PET_NO_HOOKS: "1", USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true),
    injectClaudeHooks: () => { injected += 1; return { settingsPath: "x", cleanup: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: "s", pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 0, "env override forces hooks off");
  assert.deepEqual(calls[0].args, []);
});

test("hooks command parses and persists the toggle", async () => {
  assert.deepEqual(parseAiPetArgs(["hooks"]), { command: "hooks", action: "status" });
  assert.deepEqual(parseAiPetArgs(["hooks", "on"]), { command: "hooks", action: "on" });
  assert.throws(() => parseAiPetArgs(["hooks", "bogus"]), /Unknown hooks action/);

  let saved;
  const lines = [];
  const store = {
    load: async () => ({ settings: { hooksEnabled: false } }),
    save: async (state) => { saved = state; return state; }
  };
  const result = await runAiPet(["hooks", "on"], {
    homeDir: "C:\\Users\\A",
    createStateFile: () => store,
    print: (line) => lines.push(line)
  });

  assert.equal(result.enabled, true);
  assert.equal(saved.settings.hooksEnabled, true);
  assert.ok(lines.some((l) => l.includes("on")));
});

test("persisted `hooks on` installs Codex hooks without consuming the profile slot", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" }, // no HAYA_PET_HOOKS
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => { injected += 1; return { hooksPath: "C:\\Users\\A\\.codex\\hooks.json", cleanup: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 1, "config preference enables Codex hooks");
  assert.deepEqual(calls[0].args, [], "Codex args stay untouched");
  assert.equal(calls[0].env.HAYA_PET_SESSION_ID, calls[0].sessionId);
  assert.equal(calls[0].env.HAYA_PET_CODEX_APPROVAL_REVIEWER, "user");
});

test("codex hooks pass auto-review config to the PermissionRequest reporter", async () => {
  const calls = [];
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    readFile: () => 'approvals_reviewer = "auto_review"\n',
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(calls[0].env.HAYA_PET_CODEX_APPROVAL_REVIEWER, "auto_review");
});

test("codex hooks read approvals reviewer from the selected profile config", async () => {
  const calls = [];
  let injectOptions;
  await runAiPet(["run", "--client", "codex", "--", "codex", "--profile=fugu"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true),
    injectCodexHooks: (options = {}) => { injectOptions = options; return { hooksPath: "C:\\Users\\A\\.codex\\hooks.json", cleanup: () => {} }; },
    readFile: (path) => String(path).endsWith("fugu.config.toml")
      ? 'approvals_reviewer = "auto_review"\n'
      : 'approvals_reviewer = "user"\n',
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injectOptions.profileName, "fugu", "hook injector gets the selected Codex profile");
  assert.deepEqual(calls[0].args, ["--profile=fugu"], "profile arg is untouched");
  assert.equal(calls[0].env.HAYA_PET_CODEX_APPROVAL_REVIEWER, "auto_review");
});
test("codex hooks also start a transcript watcher for tool activity", async () => {
  const sent = [];
  let fireToolEvent;
  let stopped = false;

  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: ({ onToolEvent }) => {
      fireToolEvent = onToolEvent;
      return { stop: () => { stopped = true; } };
    },
    runGenericCommand: async (options) => {
      fireToolEvent({
        type: "tool_started",
        toolCallId: "call_shell",
        toolName: "shell_command",
        state: "running_tool"
      });
      fireToolEvent({
        type: "tool_finished",
        toolCallId: "call_shell"
      });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.ok(stopped, "transcript watcher is stopped after the wrapped command exits");
  assert.deepEqual(
    sent.filter((message) => message.type === "state" && message.source === "client_log").map((message) => message.state),
    ["running_tool", "thinking"]
  );
  assert.ok(sent.every((message) => message.updatedAt === undefined || message.updatedAt === 42));
});

test("codex hooks also start a guardian-review watcher that reports review states", async () => {
  const sent = [];
  let fireReviewEvent;
  let stopped = false;

  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: () => ({ stop: () => {} }),
    watchCodexGuardianReviews: ({ onReviewEvent }) => {
      fireReviewEvent = onReviewEvent;
      return { stop: () => { stopped = true; } };
    },
    runGenericCommand: async (options) => {
      fireReviewEvent({ type: "review_started" });
      fireReviewEvent({ type: "review_finished", outcome: "allow" });
      fireReviewEvent({ type: "review_started" });
      fireReviewEvent({ type: "review_finished", outcome: "deny" });
      // An unreadable verdict must not change the state (leave the cue as-is).
      fireReviewEvent({ type: "review_finished", outcome: undefined });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.ok(stopped, "guardian watcher is stopped after the wrapped command exits");
  const reviewStates = sent
    .filter((message) => message.type === "state" && message.source === "client_log")
    .map((message) => [message.state, message.summary]);
  assert.deepEqual(reviewStates, [
    ["reviewing", "agent reviewing approval"],
    ["running_tool", "reviewer approved"],
    ["reviewing", "agent reviewing approval"],
    ["thinking", "reviewer denied"]
  ]);
});

test("codex hooks preserve user profile args and still wire live status", async () => {
  const calls = [];
  let injected = 0;
  let injectOptions;
  let watched = 0;
  const lines = [];
  await runAiPet(["run", "--client", "codex", "--", "codex", "-p", "mine"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(true),
    print: (line) => lines.push(line),
    injectCodexHooks: (options) => { injected += 1; injectOptions = options; return { hooksPath: "C:\\Users\\A\\.codex\\hooks.json", cleanup: () => {} }; },
    watchCodexTranscript: () => { watched += 1; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(injected, 1, "hooks are installed even when Codex gets a user profile");
  assert.equal(injectOptions.profileName, "mine", "hook injector gets the short selected Codex profile");
  assert.equal(watched, 1, "transcript watcher still starts for profiled runs");
  assert.deepEqual(calls[0].args, ["-p", "mine"], "user args untouched");
  assert.equal(calls[0].env.HAYA_PET_SESSION_ID, calls[0].sessionId);
  assert.ok(!lines.some((l) => /skipped/i.test(l)), "profile runs no longer skip hooks");
});

test("codex does NOT inject hooks by default (safe out-of-box)", async () => {
  const calls = [];
  let injected = 0;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    createStateFile: hooksStateFile(false),
    injectCodexHooks: () => { injected += 1; return { profileName: "haya-pet", cleanup: () => {} }; },
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
  let watched = 0;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A", HOME: "/home/a" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    injectClaudeHooks: () => ({ settingsPath: "/tmp/s.json", cleanup: () => {} }),
    watchClaudeTranscript: () => { watched += 1; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      calls.push(options);
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["--settings", "/tmp/s.json"]);
  assert.equal(calls[0].env.HAYA_PET_SESSION_ID, calls[0].sessionId);
  assert.ok(calls[0].sessionId, "a session id was generated and shared via env");
  assert.equal(watched, 1, "transcript watcher started for approval-denial recovery");
});

test("a transcript denial clears the stuck approval to idle", async () => {
  const sent = [];
  let fireDenial;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    injectClaudeHooks: () => ({ settingsPath: "/tmp/s.json", cleanup: () => {} }),
    watchClaudeTranscript: ({ onDenial }) => { fireDenial = onDenial; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      // Simulate the user denying a permission mid-session.
      fireDenial({ type: "tool_denied", toolUseId: "toolu_1" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const idle = sent.find((m) => m.type === "state" && m.source === "client_log");
  assert.ok(idle, "a client_log state was sent on denial");
  assert.equal(idle.state, "idle");
  assert.equal(idle.summary, "approval denied");
  assert.equal(idle.updatedAt, 42);
});

test("a transcript interrupt reports a failed status for Claude", async () => {
  const sent = [];
  let fireInterrupt;
  await runAiPet(["run", "--client", "claude-code", "--", "claude"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    injectClaudeHooks: () => ({ settingsPath: "/tmp/s.json", cleanup: () => {} }),
    watchClaudeTranscript: ({ onInterrupt }) => { fireInterrupt = onInterrupt; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      // Simulate the user pressing Esc to interrupt mid-turn.
      fireInterrupt({ type: "interrupted" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const interrupted = sent.find((m) => m.type === "state" && m.source === "client_log");
  assert.ok(interrupted, "a client_log state was sent on interrupt");
  assert.equal(interrupted.state, "interrupted");
  assert.equal(interrupted.summary, "interrupted");
  assert.equal(interrupted.updatedAt, 42);
});

test("a transcript turn_aborted reports a failed status for Codex", async () => {
  const sent = [];
  let fireToolEvent;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: ({ onToolEvent }) => { fireToolEvent = onToolEvent; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      // Simulate the user pressing Esc: Codex writes a turn_aborted record.
      fireToolEvent({ type: "turn_aborted", reason: "interrupted" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const interrupted = sent.find((m) => m.type === "state" && m.source === "client_log" && m.state === "interrupted");
  assert.ok(interrupted, "a client_log interrupted state was sent on turn_aborted");
  assert.equal(interrupted.summary, "interrupted");
  assert.equal(interrupted.updatedAt, 42);
});

test("a Codex usage-limit transcript event reports a non-terminal interrupted status", async () => {
  const sent = [];
  let fireToolEvent;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: ({ onToolEvent }) => { fireToolEvent = onToolEvent; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      fireToolEvent({ type: "usage_limit_reached", limitType: "primary" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const interrupted = sent.find((m) => m.type === "state" && m.source === "client_log" && m.state === "interrupted");
  assert.ok(interrupted, "a client_log interrupted state was sent on usage-limit exhaustion");
  assert.equal(interrupted.summary, "usage limit reached");
  assert.equal(interrupted.updatedAt, 42);
});

test("a Codex transcript failed-turn event reports a non-terminal interrupted status", async () => {
  const sent = [];
  let fireToolEvent;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: ({ onToolEvent }) => { fireToolEvent = onToolEvent; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      fireToolEvent({ type: "turn_failed", reason: "empty_response" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const interrupted = sent.find((m) => m.type === "state" && m.source === "client_log" && m.state === "interrupted");
  assert.ok(interrupted, "a client_log interrupted state was sent when Codex completed without a response");
  assert.equal(interrupted.summary, "model response failed");
  assert.equal(interrupted.updatedAt, 42);
});

test("a Codex transcript completed-turn event clears the turn to idle", async () => {
  const sent = [];
  let fireToolEvent;
  await runAiPet(["run", "--client", "codex", "--", "codex"], {
    cwd: process.cwd(),
    env: { USERPROFILE: "C:\\Users\\A" },
    now: () => 42,
    heartbeatIntervalMs: 10,
    send: async (message) => sent.push(message),
    createStateFile: hooksStateFile(true),
    injectCodexHooks: () => ({ profileName: "haya-pet", cleanup: () => {} }),
    watchCodexTranscript: ({ onToolEvent }) => { fireToolEvent = onToolEvent; return { stop: () => {} }; },
    runGenericCommand: async (options) => {
      fireToolEvent({ type: "turn_complete" });
      return { sessionId: options.sessionId, pid: 1, exitCode: 0 };
    }
  });

  const idle = sent.find((m) => m.type === "state" && m.source === "client_log" && m.state === "idle");
  assert.ok(idle, "a client_log idle state was sent on transcript turn completion");
  assert.equal(idle.summary, "turn complete");
  assert.equal(idle.updatedAt, 42);
});
test("non-hook-capable clients are never injected even with HAYA_PET_HOOKS=1", async () => {
  const calls = [];
  await runAiPet(["run", "--client", "generic", "--", "aider"], {
    cwd: process.cwd(),
    env: { HAYA_PET_HOOKS: "1", USERPROFILE: "C:\\Users\\A" },
    heartbeatIntervalMs: 10,
    send: async () => {},
    injectClaudeHooks: () => { throw new Error("should not inject for generic"); },
    injectCodexHooks: () => { throw new Error("should not inject for generic"); },
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
