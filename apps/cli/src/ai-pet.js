#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runGenericCommand as defaultRunGenericCommand } from "../../../packages/cli-core/src/run-command.js";
import { ensureCompanionConnection } from "../../../packages/cli-core/src/companion-launcher.js";
import { createIpcClient as defaultCreateIpcClient } from "../../../packages/daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../../packages/platform-core/src/paths.js";
import { discoverPets as defaultDiscoverPets } from "../../../packages/pet-core/src/discovery.js";
import { createStateFile as defaultCreateStateFile } from "../../../packages/app-state/src/state-file.js";
import { getSelectedPetId, setSelectedPet } from "../../../packages/app-state/src/state.js";
import { getAdapterInfo } from "../../../packages/adapters/src/adapter-info.js";

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

  if (command === "run") {
    return parseRunArgs(rest);
  }

  if (command === "pets") {
    return parsePetsArgs(rest);
  }

  if (command === "start") {
    return { command: "start" };
  }

  if (command === "stop") {
    return { command: "stop" };
  }

  throw new Error(`Unsupported ai-pet command: ${command}`);
}

export async function runAiPet(argv, dependencies = {}) {
  const parsed = parseAiPetArgs(argv);

  if (parsed.command === "pets") {
    return runPetsCommand(parsed, dependencies);
  }

  if (parsed.command === "start") {
    return runStartCommand(parsed, dependencies);
  }

  if (parsed.command === "stop") {
    return runStopCommand(parsed, dependencies);
  }

  return runRunCommand(parsed, dependencies);
}

// Ask a running companion to quit (the CLI counterpart to the tray's Quit).
export async function runStopCommand(_parsed, dependencies = {}) {
  const print = dependencies.print ?? defaultPrint;
  // Never auto-start just to stop; only connect if one is already running.
  const { client } = await connectCompanion(dependencies, false);

  if (!client) {
    print("ai-pet: companion is not running.");
    return { command: "stop", ok: true, wasRunning: false };
  }

  await client.send({ type: "shutdown" });
  await client.close();
  print("ai-pet: companion stopped.");
  return { command: "stop", ok: true, wasRunning: true };
}

// Explicitly start the companion overlay (so users never need `npm start`).
export async function runStartCommand(_parsed, dependencies = {}) {
  const print = dependencies.print ?? defaultPrint;
  const { client, started, error, timedOut } = await connectCompanion(dependencies, true);

  if (client) {
    await client.close();
    print(started ? "ai-pet: companion started." : "ai-pet: companion is already running.");
    return { command: "start", ok: true, started };
  }

  if (error) {
    print(`ai-pet: could not start the companion (${error.message}).`);
  } else if (timedOut) {
    print("ai-pet: started the companion but it did not come up in time.");
  } else {
    print("ai-pet: companion is not running and auto-start is disabled.");
  }
  return { command: "start", ok: false, started: false };
}

async function runRunCommand(parsed, dependencies) {
  const runGenericCommand = dependencies.runGenericCommand ?? defaultRunGenericCommand;
  const messageSender = await createMessageSender(dependencies);

  try {
    return await runGenericCommand({
      command: parsed.childCommand,
      args: parsed.childArgs,
      cwd: dependencies.cwd ?? process.cwd(),
      clientId: parsed.clientId,
      clientDisplayName: CLIENT_DISPLAY_NAMES[parsed.clientId] ?? parsed.clientId,
      observe: parsed.observe,
      heartbeatIntervalMs: dependencies.heartbeatIntervalMs,
      now: dependencies.now,
      stdio: dependencies.stdio,
      send: messageSender.send
    });
  } finally {
    await messageSender.close();
  }
}

export async function runPetsCommand(parsed, dependencies = {}) {
  const paths = getDefaultPaths({
    platform: dependencies.platform,
    env: dependencies.env,
    homeDir: dependencies.homeDir
  });
  const discoverPets = dependencies.discoverPets ?? defaultDiscoverPets;
  const createStateFile = dependencies.createStateFile ?? defaultCreateStateFile;
  const print = dependencies.print ?? defaultPrint;

  const stateFile = createStateFile({ statePath: paths.statePath });
  const pets = await discoverPets(paths.petSearchPaths);
  const state = await stateFile.load();

  if (parsed.action === "use") {
    return usePet({ parsed, pets, state, stateFile, setSelectedPet, print });
  }

  return listPets({ pets, selectedId: getSelectedPetId(state), print });
}

function listPets({ pets, selectedId, print }) {
  if (pets.length === 0) {
    print("No pets found. Add a pet folder (pet.json + spritesheet) to ~/.codex/pets or ~/.ai-pet/pets.");
    return { command: "pets", action: "list", pets: [], selectedId };
  }

  print("Installed pets (* = selected):");
  for (const pet of pets) {
    const marker = pet.manifest.id === selectedId ? "*" : " ";
    print(`${marker} ${pet.manifest.id}\t${pet.manifest.name}`);
  }

  return { command: "pets", action: "list", pets: pets.map((pet) => pet.manifest.id), selectedId };
}

async function usePet({ parsed, pets, state, stateFile, setSelectedPet: applySelection, print }) {
  const target = pets.find((pet) => pet.manifest.id === parsed.petId);

  await stateFile.save(applySelection(state, parsed.petId));

  if (!target) {
    print(`Warning: "${parsed.petId}" is not currently installed; it will be used when available.`);
  }
  print(`Selected pet: ${parsed.petId}`);

  return { command: "pets", action: "use", ok: true, petId: parsed.petId, installed: Boolean(target) };
}

function defaultPrint(line) {
  process.stdout.write(`${line}\n`);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const result = await runAiPet(argv, dependencies);
  process.exitCode = result.exitCode ?? 0;
  return result;
}

function parsePetsArgs(args) {
  if (args.length === 0) {
    return { command: "pets", action: "list" };
  }

  const [action, ...rest] = args;

  if (action === "list") {
    return { command: "pets", action: "list" };
  }

  if (action === "use") {
    const petId = rest[0];
    if (!petId) {
      throw new Error("pets use requires a pet id");
    }
    return { command: "pets", action: "use", petId };
  }

  throw new Error(`Unknown pets action: ${action}`);
}

function parseRunArgs(args) {
  let clientId = "generic";
  let observe = true; // live PTY observation is on by default; --no-observe opts out
  let childStart = -1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    // Explicit separator: everything after it is the child command. `--` is
    // optional — some shells (PowerShell's npm .ps1 shim) strip a lone `--`
    // before it reaches the CLI, so we also accept a bare command word below.
    if (arg === "--") {
      childStart = index + 1;
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

    if (arg === "--observe") {
      observe = true;
      continue;
    }

    if (arg === "--no-observe") {
      observe = false;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown run option: ${arg}`);
    }

    // First bare positional starts the child command (no `--` required).
    childStart = index;
    break;
  }

  if (childStart === -1) {
    // No command given: fall back to the client's declared default command
    // (e.g. `ai-pet run --client codex` launches `codex`).
    const defaultCommand = getAdapterInfo(clientId)?.defaultCommand;
    if (!defaultCommand) {
      throw new Error(
        `run requires a command (client "${clientId}" has no default command; pass one after the client)`
      );
    }

    return { command: "run", clientId, observe, childCommand: defaultCommand, childArgs: [] };
  }

  const childArgs = args.slice(childStart);
  const childCommand = childArgs.shift();

  if (!childCommand) {
    // `--` was the last token; fall back to the default command if any.
    const defaultCommand = getAdapterInfo(clientId)?.defaultCommand;
    if (defaultCommand) {
      return { command: "run", clientId, observe, childCommand: defaultCommand, childArgs: [] };
    }
    throw new Error("run requires a child command");
  }

  return {
    command: "run",
    clientId,
    observe,
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

  const { client, started } = await connectCompanion(dependencies, shouldAutoStart(dependencies));

  if (!client) {
    // No daemon and could not auto-start: still run the wrapped command and
    // preserve its exit code. The pet just won't reflect this session (plan
    // section 39 — wrappers degrade gracefully).
    return { send: noopSend, close: noopClose };
  }

  if (started) {
    process.stderr.write("ai-pet: started the companion overlay.\n");
  }

  return {
    send: (message) => client.send(message),
    close: () => client.close()
  };
}

// Connects to the companion, optionally auto-starting it if it isn't running.
function connectCompanion(dependencies, autoStart) {
  const createIpcClient = dependencies.createIpcClient ?? defaultCreateIpcClient;
  const endpoint = dependencies.ipcEndpoint ?? getDefaultPaths({
    platform: dependencies.platform,
    env: dependencies.env,
    homeDir: dependencies.homeDir
  }).ipcEndpoint;
  const launch = dependencies.launchCompanion ?? defaultLaunchCompanion;

  return ensureCompanionConnection({
    connect: () => createIpcClient({ endpoint }),
    launch,
    autoStart,
    attempts: dependencies.connectAttempts,
    intervalMs: dependencies.connectIntervalMs,
    sleep: dependencies.sleep
  });
}

function shouldAutoStart(dependencies) {
  if (dependencies.autoStart !== undefined) {
    return dependencies.autoStart;
  }
  const env = dependencies.env ?? process.env;
  const flag = env.AI_PET_NO_AUTOSTART;
  return flag !== "1" && flag !== "true";
}

// Spawns the Electron companion as a detached background process so it outlives
// this `ai-pet run` invocation. `import("electron")` resolves to the binary path
// when required outside an Electron runtime; the companion app dir is the sibling
// `apps/companion` package (whose package.json `main` is the overlay entry).
async function defaultLaunchCompanion() {
  const electronModule = await import("electron");
  const electronPath = electronModule.default ?? electronModule;
  if (typeof electronPath !== "string") {
    throw new Error("could not resolve the Electron binary");
  }

  const companionDir = fileURLToPath(new URL("../../companion", import.meta.url));
  const child = spawn(electronPath, [companionDir], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

async function noopSend() {}

async function noopClose() {}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      // The wrapped command has finished and all messages are flushed by now.
      // Exit explicitly: a PTY (observe mode) can otherwise keep the event loop
      // alive after the child exits.
      process.exit(process.exitCode ?? 0);
    });
}

function isDirectRun(moduleUrl, scriptPath) {
  if (!scriptPath) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);

  // Resolve symlinks on both sides so the guard still fires when the CLI is
  // invoked through an `npm link` shim (argv[1] is the symlink path, while
  // import.meta.url resolves to the real file).
  try {
    return realpathSync(modulePath) === realpathSync(scriptPath);
  } catch {
    return modulePath === scriptPath;
  }
}
