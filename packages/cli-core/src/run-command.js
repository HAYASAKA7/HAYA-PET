import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { assertProtocolMessage } from "../../protocol/src/messages.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

export async function runGenericCommand(options) {
  const {
    command,
    args = [],
    cwd = process.cwd(),
    clientId = "generic",
    clientDisplayName = "Generic",
    sessionId = `sess_${randomUUID()}`,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    now = Date.now,
    send,
    stdio = "inherit"
  } = options ?? {};

  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("command must be a non-empty string");
  }

  if (!Array.isArray(args)) {
    throw new TypeError("args must be an array");
  }

  if (typeof send !== "function") {
    throw new TypeError("send must be a function");
  }

  const child = spawn(command, args, { cwd, stdio });
  const closePromise = waitForClose(child);

  const startedAt = now();
  const projectName = basename(cwd) || cwd;

  await sendProtocolMessage(send, {
    type: "register",
    sessionId,
    clientId,
    clientDisplayName,
    pid: child.pid,
    cwd,
    projectName,
    startedAt
  });

  await sendProtocolMessage(send, {
    type: "state",
    sessionId,
    state: "running_tool",
    summary: "process running",
    confidence: 0.5,
    source: "wrapper",
    updatedAt: now()
  });

  await sendProtocolMessage(send, {
    type: "heartbeat",
    sessionId,
    updatedAt: now()
  });

  const timer = setInterval(() => {
    sendProtocolMessage(send, {
      type: "heartbeat",
      sessionId,
      updatedAt: now()
    }).catch(() => {
      clearInterval(timer);
    });
  }, heartbeatIntervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  const closeResult = await closePromise;
  clearInterval(timer);

  const exitCode = normalizeExitCode(closeResult);
  const finalState = exitCode === 0 ? "success" : "failed";
  const summary = buildExitSummary(closeResult, exitCode);

  await sendProtocolMessage(send, {
    type: "state",
    sessionId,
    state: finalState,
    summary,
    confidence: 1,
    source: "wrapper",
    updatedAt: now()
  });

  await sendProtocolMessage(send, {
    type: "unregister",
    sessionId,
    exitCode,
    finishedAt: now()
  });

  return {
    sessionId,
    pid: child.pid,
    exitCode,
    signal: closeResult.signal
  };
}

async function sendProtocolMessage(send, message) {
  await send(assertProtocolMessage(message));
}

function waitForClose(child) {
  return new Promise((resolve) => {
    let spawnError;

    child.once("error", (error) => {
      spawnError = error;
    });

    child.once("close", (code, signal) => {
      resolve({ code, signal, error: spawnError });
    });
  });
}

function normalizeExitCode(closeResult) {
  if (Number.isInteger(closeResult.code)) {
    return closeResult.code;
  }

  return 1;
}

function buildExitSummary(closeResult, exitCode) {
  if (closeResult.error) {
    return `process failed to start: ${closeResult.error.message}`;
  }

  if (closeResult.signal) {
    return `process terminated by signal ${closeResult.signal}`;
  }

  if (exitCode === 0) {
    return "process exited successfully";
  }

  return `process exited with code ${exitCode}`;
}
