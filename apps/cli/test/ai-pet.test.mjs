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

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
