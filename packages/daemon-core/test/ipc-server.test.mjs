import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createIpcClient, createIpcServer } from "../src/ipc-server.js";

test("server receives protocol messages from client", async () => {
  const received = [];
  const server = await createIpcServer({
    endpoint: "test-haya-petd",
    platform: "test",
    onMessage: (message) => received.push(message)
  });

  const client = await createIpcClient({ endpoint: server.endpoint });
  await client.send({ type: "heartbeat", sessionId: "sess_a", updatedAt: 1 });
  await waitFor(() => received.length === 1);
  await client.close();
  await server.close();

  assert.deepEqual(received, [{ type: "heartbeat", sessionId: "sess_a", updatedAt: 1 }]);
});

test("server reports invalid client protocol frames", async () => {
  const errors = [];
  const server = await createIpcServer({
    endpoint: "test-haya-petd",
    platform: "test",
    onMessage: () => {},
    onProtocolError: (error) => errors.push(error)
  });

  const client = await createIpcClient({ endpoint: server.endpoint });
  client.socket.write("{not-json}\n");
  await waitFor(() => errors.length === 1);
  await client.close();
  await server.close();

  assert.match(errors[0].message, /Invalid protocol JSON frame/);
});

test("client rejects invalid protocol messages before writing", async () => {
  const received = [];
  const server = await createIpcServer({
    endpoint: "test-haya-petd",
    platform: "test",
    onMessage: (message) => received.push(message)
  });

  const client = await createIpcClient({ endpoint: server.endpoint });

  await assert.rejects(
    () => client.send({ type: "unknown", sessionId: "sess_a" }),
    /Unknown protocol message type/
  );

  await client.close();
  await server.close();
  assert.deepEqual(received, []);
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
