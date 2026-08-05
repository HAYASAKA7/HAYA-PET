import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { assertProtocolMessage } from "../../protocol/src/messages.js";
import { createOutputObserver } from "../../adapters/src/output-observer.js";
import { stripAnsi } from "./strip-ansi.js";
import { isPtyAvailable, spawnPty as defaultSpawnPty } from "./pty-runner.js";

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
    stdio = "inherit",
    shell: shellOption,
    observe = false,
    spawnPty,
    env = process.env
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

  // On Windows, AI CLIs are usually .cmd/.ps1 shims (e.g. `claude`, `codex`),
  // which neither Node's spawn nor node-pty can launch directly — run them
  // through the shell so PATHEXT resolution works. Direct .exe paths (incl.
  // process.execPath in tests) keep shell off so argument quoting is untouched.
  const isWindows = process.platform === "win32";
  const useShell = shellOption ?? (isWindows && !/\.(exe|com)$/i.test(command));

  // Level 2: observe the CLI's output through a PTY to infer live state
  // (thinking / running_tool / waiting_approval / ...). Only when a PTY launcher
  // is available; otherwise we fall back to the plain wrapper.
  if (observe) {
    const ptyLauncher = spawnPty ?? ((await isPtyAvailable()) ? defaultSpawnPty : undefined);
    if (ptyLauncher) {
      return runObservedCommand({
        command,
        args,
        cwd,
        useShell,
        clientId,
        clientDisplayName,
        sessionId,
        heartbeatIntervalMs,
        now,
        send,
        env,
        spawnPty: ptyLauncher
      });
    }
    process.stderr.write(
      "haya-pet: live observation requested but node-pty is unavailable; running without live state.\n"
    );
  }

  // With shell:true Node concatenates an args array without escaping (DEP0190),
  // so when we need a shell we pass a single, pre-quoted command string instead.
  const child = useShell
    ? spawn(buildShellCommand(command, args), { cwd, stdio, shell: true, env })
    : spawn(command, args, { cwd, stdio, env });
  const closePromise = waitForClose(child);

  if (!child.pid) {
    // The command could not be launched at all (e.g. not found). Don't send an
    // invalid register message; report the failure and preserve the exit code.
    const closeResult = await closePromise;
    return {
      sessionId,
      pid: undefined,
      exitCode: normalizeExitCode(closeResult),
      signal: closeResult.signal
    };
  }

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

  // A Level 1 wrapper cannot observe what the CLI is actually doing, so it must
  // not claim "running". "idle" = session exists but no active work detected.
  // PTY/log adapters refine this later.
  await sendProtocolMessage(send, {
    type: "state",
    sessionId,
    state: "idle",
    summary: "session started",
    confidence: 0.4,
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

async function runObservedCommand({
  command,
  args,
  cwd,
  useShell,
  clientId,
  clientDisplayName,
  sessionId,
  heartbeatIntervalMs,
  now,
  send,
  env,
  spawnPty
}) {
  const startedAt = now();
  const projectName = basename(cwd) || cwd;

  // node-pty cannot resolve .cmd/.ps1 shims either, so wrap them in the shell.
  let ptyCommand = command;
  let ptyArgs = args;
  if (useShell) {
    ptyCommand = process.env.ComSpec || "cmd.exe";
    ptyArgs = ["/d", "/s", "/c", buildShellCommand(command, args)];
  }

  // Buffer observed state until the session is registered, so the daemon never
  // receives a state for an unknown session (output can arrive before register).
  let registered = false;
  let pendingState;

  const emitState = (event) => {
    sendProtocolMessage(send, {
      type: "state",
      sessionId,
      state: event.state,
      summary: event.summary,
      confidence: event.confidence,
      source: "pty_output",
      updatedAt: event.updatedAt
    }).catch(() => {});
  };

  const observer = createOutputObserver({
    clientId,
    now,
    onState: (event) => {
      if (registered) {
        emitState(event);
      } else {
        pendingState = event;
      }
    }
  });

  const handle = await spawnPty({
    command: ptyCommand,
    args: ptyArgs,
    cwd,
    env,
    onData: (data) => observer.push(stripAnsi(data.toString())),
    onInput: () => observer.noteInput()
  });

  await sendProtocolMessage(send, {
    type: "register",
    sessionId,
    clientId,
    clientDisplayName,
    pid: handle.pid,
    cwd,
    projectName,
    startedAt
  });

  await sendProtocolMessage(send, {
    type: "state",
    sessionId,
    state: "idle",
    summary: "session started",
    confidence: 0.4,
    source: "wrapper",
    updatedAt: now()
  });

  registered = true;
  if (pendingState) {
    emitState(pendingState);
  }

  await sendProtocolMessage(send, { type: "heartbeat", sessionId, updatedAt: now() });

  const timer = setInterval(() => {
    sendProtocolMessage(send, { type: "heartbeat", sessionId, updatedAt: now() }).catch(() => {
      clearInterval(timer);
    });
  }, heartbeatIntervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  const { exitCode, signal } = await handle.exit;
  clearInterval(timer);
  observer.stop();

  const finalExitCode = Number.isInteger(exitCode) ? exitCode : 1;
  const finalState = finalExitCode === 0 ? "success" : "failed";

  await sendProtocolMessage(send, {
    type: "state",
    sessionId,
    state: finalState,
    summary: finalExitCode === 0 ? "process exited successfully" : `process exited with code ${finalExitCode}`,
    confidence: 1,
    source: "wrapper",
    updatedAt: now()
  });

  await sendProtocolMessage(send, {
    type: "unregister",
    sessionId,
    exitCode: finalExitCode,
    finishedAt: now()
  });

  return { sessionId, pid: handle.pid, exitCode: finalExitCode, signal };
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

// Builds a single shell command line with each token quoted for the Windows
// command processor (the only platform we default the shell on).
function buildShellCommand(command, args) {
  return [command, ...args].map(quoteShellArg).join(" ");
}

function quoteShellArg(arg) {
  const value = String(arg);
  if (value === "") {
    return '""';
  }
  if (!/[\s"&|<>^()%!]/.test(value)) {
    return value;
  }
  const escaped = value
    .replace(/(\\*)"/g, (_, slashes) => `${slashes}${slashes}\\"`)
    .replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
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
