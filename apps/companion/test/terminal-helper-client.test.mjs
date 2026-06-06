import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "../../../test/harness.mjs";
import { createHelperClient } from "../src/main/terminal-helper-client.js";

// Fake helper process that answers the line-delimited JSON protocol the way the
// real native helper does, so the client plumbing is testable without a binary.
function fakeSpawn(responder) {
  const stdout = new EventEmitter();
  const stdin = {
    write(data) {
      const request = JSON.parse(data);
      queueMicrotask(() => {
        stdout.emit("data", Buffer.from(`${JSON.stringify(responder(request))}\n`));
      });
      return true;
    },
    end() {}
  };
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stdin = stdin;
  child.kill = () => {};
  return () => child;
}

test("requests capabilities and correlates the response by id", async () => {
  const client = createHelperClient({
    spawn: fakeSpawn((req) => ({ id: req.id, ok: true, capabilities: { locate: true } })),
    command: "helper"
  });

  const caps = await client.capabilities();
  assert.equal(caps.ok, true);
  assert.equal(caps.capabilities.locate, true);
  await client.close();
});

test("locate forwards pid and resolves the window", async () => {
  const seen = [];
  const client = createHelperClient({
    spawn: fakeSpawn((req) => {
      seen.push(req);
      return { id: req.id, ok: true, window: { x: 10, y: 20, width: 800, height: 600 } };
    }),
    command: "helper"
  });

  const result = await client.locate(1234, 5678);
  assert.equal(result.ok, true);
  assert.equal(result.window.width, 800);
  assert.equal(seen[0].op, "locate");
  assert.equal(seen[0].pid, 1234);
  assert.equal(seen[0].terminalPid, 5678);
  await client.close();
});

test("concurrent requests resolve to their matching responses", async () => {
  const client = createHelperClient({
    spawn: fakeSpawn((req) => ({ id: req.id, ok: true, echo: req.pid })),
    command: "helper"
  });

  const [a, b] = await Promise.all([client.locate(1), client.locate(2)]);
  assert.equal(a.echo, 1);
  assert.equal(b.echo, 2);
  await client.close();
});
