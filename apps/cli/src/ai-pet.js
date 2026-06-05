#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runGenericCommand as defaultRunGenericCommand } from "../../../packages/cli-core/src/run-command.js";
import { createIpcClient as defaultCreateIpcClient } from "../../../packages/daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../../packages/platform-core/src/paths.js";

const CLIENT_DISPLAY_NAMES = Object.freeze({
  generic: "Generic",
  codex: "Codex",
  "claude-code": "Claude Code",
  antigravity: "Antigravity"
});

export function parseAiPetArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("ai-pet requires a command");
  }

  const [command, ...rest] = argv;

  if (command !== "run") {
    throw new Error(`Unsupported ai-pet command: ${command}`);
  }

  return parseRunArgs(rest);
}

export async function runAiPet(argv, dependencies = {}) {
  const parsed = parseAiPetArgs(argv);
  const runGenericCommand = dependencies.runGenericCommand ?? defaultRunGenericCommand;
  const messageSender = await createMessageSender(dependencies);

  try {
    return await runGenericCommand({
      command: parsed.childCommand,
      args: parsed.childArgs,
      cwd: dependencies.cwd ?? process.cwd(),
      clientId: parsed.clientId,
      clientDisplayName: CLIENT_DISPLAY_NAMES[parsed.clientId] ?? parsed.clientId,
      heartbeatIntervalMs: dependencies.heartbeatIntervalMs,
      now: dependencies.now,
      stdio: dependencies.stdio,
      send: messageSender.send
    });
  } finally {
    await messageSender.close();
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const result = await runAiPet(argv, dependencies);
  process.exitCode = result.exitCode ?? 0;
  return result;
}

function parseRunArgs(args) {
  let clientId = "generic";
  let separatorIndex = -1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      separatorIndex = index;
      break;
    }

    if (arg === "--client") {
      const value = args[index + 1];
      if (!value || value === "--") {
        throw new Error("--client requires a value");
      }

      clientId = value;
      index += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      throw new Error("run requires -- before the child command");
    }

    throw new Error(`Unknown run option: ${arg}`);
  }

  if (separatorIndex === -1) {
    throw new Error("run requires -- before the child command");
  }

  const childArgs = args.slice(separatorIndex + 1);
  const childCommand = childArgs.shift();

  if (!childCommand) {
    throw new Error("run requires a child command");
  }

  return {
    command: "run",
    clientId,
    childCommand,
    childArgs
  };
}

async function createMessageSender(dependencies) {
  if (typeof dependencies.send === "function") {
    return {
      send: dependencies.send,
      close: async () => {}
    };
  }

  const createIpcClient = dependencies.createIpcClient ?? defaultCreateIpcClient;
  const endpoint = dependencies.ipcEndpoint ?? getDefaultPaths({
    platform: dependencies.platform,
    env: dependencies.env,
    homeDir: dependencies.homeDir
  }).ipcEndpoint;

  let client;
  try {
    client = await createIpcClient({ endpoint });
  } catch {
    // No daemon listening: still run the wrapped command and preserve its exit
    // code. The pet simply will not reflect this session until the companion
    // is running (plan section 39 — wrappers degrade gracefully).
    return { send: noopSend, close: noopClose };
  }

  return {
    send: (message) => client.send(message),
    close: () => client.close()
  };
}

async function noopSend() {}

async function noopClose() {}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

function isDirectRun(moduleUrl, scriptPath) {
  return scriptPath && fileURLToPath(moduleUrl) === scriptPath;
}
