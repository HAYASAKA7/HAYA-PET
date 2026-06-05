import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "../../../test/harness.mjs";
import { writeProtocolMessage } from "../src/ipc-transport.js";
import { createDaemonRuntime } from "../src/daemon-runtime.js";

function registerMessage(sessionId) {
  return {
    type: "register",
    sessionId,
    clientId: "generic",
    clientDisplayName: "Generic",
    pid: 12345,
    cwd: "D:\\Work\\project",
    projectName: "project",
    startedAt: 1000
  };
}

test("applies protocol messages to the session registry", () => {
  const changes = [];
  const runtime = createDaemonRuntime({
    onSessionChanged: (session) => changes.push(session)
  });

  runtime.handleMessage(registerMessage("sess_a"));
  runtime.handleMessage({
    type: "state",
    sessionId: "sess_a",
    state: "waiting_approval",
    summary: "waiting for command approval",
    confidence: 0.9,
    source: "wrapper",
    updatedAt: 1100
  });

  assert.equal(runtime.getSession("sess_a").state, "waiting_approval");
  assert.equal(runtime.getPrioritySession().sessionId, "sess_a");
  assert.deepEqual(changes.map((session) => session.state), ["idle", "waiting_approval"]);
});

test("attaches stream input to the daemon runtime", () => {
  const stream = new PassThrough();
  const runtime = createDaemonRuntime();

  runtime.attachStream(stream);
  writeProtocolMessage(stream, registerMessage("sess_stream"));

  assert.equal(runtime.getSession("sess_stream").clientDisplayName, "Generic");
});

test("reports transport errors without mutating the registry", () => {
  const stream = new PassThrough();
  const errors = [];
  const runtime = createDaemonRuntime({
    onProtocolError: (error) => errors.push(error)
  });

  runtime.attachStream(stream);
  stream.write("{not-json}\n");

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Invalid protocol JSON frame/);
  assert.deepEqual(runtime.listSessions(), []);
});
