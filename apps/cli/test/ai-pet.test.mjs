import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createDaemonRuntime } from "../../../packages/daemon-core/src/daemon-runtime.js";
import { createIpcServer } from "../../../packages/daemon-core/src/ipc-server.js";
import { parseAiPetArgs, runAiPet } from "../src/ai-pet.js";

test("parses generic run command arguments", () => {
  assert.deepEqual(
    parseAiPetArgs(["run", "--client", "generic", "--", "node", "-e", "process.exit(0)"]),
    {
      command: "run",
      clientId: "generic",
      childCommand: "node",
      childArgs: ["-e", "process.exit(0)"]
    }
  );
});

test("defaults run command client to generic", () => {
  assert.equal(parseAiPetArgs(["run", "--", "node"]).clientId, "generic");
});

test("rejects unsupported commands and missing child command separator", () => {
  assert.throws(() => parseAiPetArgs(["status"]), /Unsupported ai-pet command: status/);
  assert.throws(() => parseAiPetArgs(["run", "node"]), /run requires -- before the child command/);
  assert.throws(() => parseAiPetArgs(["run", "--client"]), /--client requires a value/);
  assert.throws(() => parseAiPetArgs(["run", "--"]), /run requires a child command/);
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
    endpoint: "test-ai-petd",
    platform: "test",
    onMessage: (message) => runtime.handleMessage(message)
  });

  try {
    const result = await runAiPet(
      ["run", "--client", "generic", "--", process.execPath, "-e", "process.exit(0)"],
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

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
