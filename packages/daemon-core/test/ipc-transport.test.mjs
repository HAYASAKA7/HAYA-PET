import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "../../../test/harness.mjs";
import {
  attachProtocolStream,
  createProtocolMessageReader,
  encodeProtocolMessage,
  writeProtocolMessage
} from "../src/ipc-transport.js";

const heartbeat = {
  type: "heartbeat",
  sessionId: "sess_abc123",
  updatedAt: 1780000010
};

test("encodes one validated protocol message per JSON line", () => {
  assert.equal(encodeProtocolMessage(heartbeat), `${JSON.stringify(heartbeat)}\n`);
  assert.throws(
    () => encodeProtocolMessage({ type: "unknown", sessionId: "sess_abc123" }),
    /Unknown protocol message type/
  );
});

test("decodes complete and split protocol frames", () => {
  const messages = [];
  const errors = [];
  const reader = createProtocolMessageReader({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error)
  });

  const encoded = encodeProtocolMessage(heartbeat);
  reader.push(encoded.slice(0, 5));
  reader.push(encoded.slice(5));

  assert.deepEqual(messages, [heartbeat]);
  assert.deepEqual(errors, []);
});

test("reports invalid JSON and invalid protocol frames without losing later messages", () => {
  const messages = [];
  const errors = [];
  const reader = createProtocolMessageReader({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error)
  });

  reader.push("{not-json}\n");
  reader.push(`${JSON.stringify({ type: "state", sessionId: "", state: "busy" })}\n`);
  reader.push(encodeProtocolMessage(heartbeat));

  assert.deepEqual(messages, [heartbeat]);
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Invalid protocol JSON frame/);
  assert.match(errors[1].message, /sessionId must be a non-empty string/);
});

test("attaches protocol reader and writer to Node streams", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];

  attachProtocolStream(input, {
    onMessage: (message) => messages.push(message)
  });

  writeProtocolMessage(output, heartbeat);
  input.write(output.read());

  assert.deepEqual(messages, [heartbeat]);
});
