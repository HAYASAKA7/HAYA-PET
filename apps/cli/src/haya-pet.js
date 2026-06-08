#!/usr/bin/env node
import { realpathSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runGenericCommand as defaultRunGenericCommand } from "../../../packages/cli-core/src/run-command.js";
import { parseStateArgs, runStateCommand } from "../../../packages/cli-core/src/run-state.js";
import { injectClaudeHooks as defaultInjectClaudeHooks } from "../../../packages/cli-core/src/claude-hook-injection.js";
import { injectCodexHooks as defaultInjectCodexHooks } from "../../../packages/cli-core/src/codex-hook-injection.js";
import { watchClaudeTranscript as defaultWatchClaudeTranscript } from "../../../packages/cli-core/src/claude-transcript-watcher.js";
import { ensureCompanionConnection } from "../../../packages/cli-core/src/companion-launcher.js";
import { createIpcClient as defaultCreateIpcClient } from "../../../packages/daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../../packages/platform-core/src/paths.js";
import { discoverPets as defaultDiscoverPets } from "../../../packages/pet-core/src/discovery.js";
import { createStateFile as defaultCreateStateFile } from "../../../packages/app-state/src/state-file.js";
import { getSelectedPetId, setSelectedPet, getHooksEnabled, setHooksEnabled } from "../../../packages/app-state/src/state.js";
import { getAdapterInfo } from "../../../packages/adapters/src/adapter-info.js";

const CLIENT_DISPLAY_NAMES = Object.freeze({
  generic: "Generic",
  codex: "Codex",
  "claude-code": "Claude Code",
  antigravity: "Antigravity"
});

export function parseAiPetArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("haya-pet requires a command");
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

  if (command === "state") {
    return parseStateArgs(rest);
  }

  if (command === "hooks") {
    return parseHooksArgs(rest);
  }

  throw new Error(`Unsupported haya-pet command: ${command}`);
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

  if (parsed.command === "state") {
    return runStateCommand(parsed, dependencies);
  }

  if (parsed.command === "hooks") {
    return runHooksCommand(parsed, dependencies);
  }

  return runRunCommand(parsed, dependencies);
}

// Ask a running companion to quit (the CLI counterpart to the tray's Quit).
export async function runStopCommand(_parsed, dependencies = {}) {
  const print = dependencies.print ?? defaultPrint;
  // Never auto-start just to stop; only connect if one is already running.
  const { client } = await connectCompanion(dependencies, false);

  if (!client) {
    print("haya-pet: companion is not running.");
    return { command: "stop", ok: true, wasRunning: false };
  }

  await client.send({ type: "shutdown" });
  await client.close();
  print("haya-pet: companion stopped.");
  return { command: "stop", ok: true, wasRunning: true };
}

// Explicitly start the companion overlay (so users never need `npm start`).
export async function runStartCommand(_parsed, dependencies = {}) {
  const print = dependencies.print ?? defaultPrint;
  const { client, started, error, timedOut } = await connectCompanion(dependencies, true);

  if (client) {
    await client.close();
    print(started ? "haya-pet: companion started." : "haya-pet: companion is already running.");
    return { command: "start", ok: true, started };
  }

  if (error) {
    print(`haya-pet: could not start the companion (${error.message}).`);
  } else if (timedOut) {
    print("haya-pet: started the companion but it did not come up in time.");
  } else {
    print("haya-pet: companion is not running and auto-start is disabled.");
  }
  return { command: "start", ok: false, started: false };
}

async function runRunCommand(parsed, dependencies) {
  const runGenericCommand = dependencies.runGenericCommand ?? defaultRunGenericCommand;
  const injectClaudeHooks = dependencies.injectClaudeHooks ?? defaultInjectClaudeHooks;
  const injectCodexHooks = dependencies.injectCodexHooks ?? defaultInjectCodexHooks;
  const watchClaudeTranscript = dependencies.watchClaudeTranscript ?? defaultWatchClaudeTranscript;
  const print = dependencies.print ?? defaultPrint;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const cwd = dependencies.cwd ?? process.cwd();
  const messageSender = await createMessageSender(dependencies);

  const sessionId = dependencies.sessionId ?? `sess_${randomUUID()}`;
  let childArgs = parsed.childArgs;
  let childEnv = env;
  let cleanup = () => {};
  let stopWatcher = () => {};

  // Native passthrough is always the default (full terminal fidelity). Live-status
  // hooks are OPT-IN — persisted via `haya-pet hooks on`, or per-run via
  // HAYA_PET_HOOKS=1 — because injecting hooks makes the client show a one-time
  // "review hooks" trust prompt; we never disrupt the user's session uninvited.
  // Both clients report live status via the `haya-pet state` reporter (no PTY, so
  // Shift+Tab works); the session id rides in via HAYA_PET_SESSION_ID.
  const hooksOn = await resolveHooksEnabled(env, dependencies);

  // Claude Code: inject a stable `--settings` file.
  const claudeHooksOn = hooksOn && parsed.clientId === "claude-code";
  if (claudeHooksOn) {
    const injected = injectClaudeHooks();
    childArgs = [...parsed.childArgs, "--settings", injected.settingsPath];
    childEnv = { ...env, HAYA_PET_SESSION_ID: sessionId };
    cleanup = injected.cleanup;

    // Claude fires NO hook when the user manually denies a permission, so the
    // pet would stay stuck on "waiting for approval". Tail the session transcript
    // (ground truth) and clear to idle the moment a denial is recorded — never on
    // a timer, so a genuinely-pending approval keeps alerting until it's resolved.
    const watcher = watchClaudeTranscript({
      cwd,
      homeDir: dependencies.homeDir,
      startedAt: now(),
      onDenial: (event) => {
        hookDebugLog(env, now, { source: "transcript", event: "denied", state: "idle", toolUseId: event?.toolUseId });
        messageSender
          .send({
            type: "state",
            sessionId,
            state: "idle",
            summary: "approval denied",
            confidence: 0.9,
            source: "client_log",
            updatedAt: now()
          })
          .catch(() => {});
      }
    });
    stopWatcher = watcher.stop;
  }

  // Codex: no `--settings` equivalent, so inject a stable profile and add
  // `-p <name>` at the FRONT (a global flag must precede any subcommand). Codex
  // takes only one profile, so if the user already passes their own -p/--profile
  // we skip injection and say so rather than clobber their choice.
  const codexHooksOn = hooksOn && parsed.clientId === "codex";
  if (codexHooksOn) {
    if (hasProfileArg(parsed.childArgs)) {
      print(
        "haya-pet: Codex live-status hooks skipped — you passed your own -p/--profile (Codex allows only one)."
      );
    } else {
      const injected = injectCodexHooks();
      childArgs = ["-p", injected.profileName, ...parsed.childArgs];
      childEnv = { ...env, HAYA_PET_SESSION_ID: sessionId };
      cleanup = injected.cleanup;
    }
  }

  try {
    return await runGenericCommand({
      command: parsed.childCommand,
      args: childArgs,
      cwd,
      clientId: parsed.clientId,
      clientDisplayName: CLIENT_DISPLAY_NAMES[parsed.clientId] ?? parsed.clientId,
      observe: parsed.observe,
      sessionId,
      env: childEnv,
      heartbeatIntervalMs: dependencies.heartbeatIntervalMs,
      now: dependencies.now,
      stdio: dependencies.stdio,
      send: messageSender.send
    });
  } finally {
    stopWatcher();
    cleanup();
    await messageSender.close();
  }
}

// Resolve whether live-status hooks should be injected for this run (any
// hook-capable client). Precedence: HAYA_PET_NO_HOOKS forces off, HAYA_PET_HOOKS
// forces on (per-run overrides), otherwise the persisted `haya-pet hooks on/off`
// preference.
async function resolveHooksEnabled(env, dependencies) {
  if (isTruthyFlag(env.HAYA_PET_NO_HOOKS)) {
    return false;
  }
  if (isTruthyFlag(env.HAYA_PET_HOOKS)) {
    return true;
  }
  try {
    const state = await createConfigStateFile(dependencies).load();
    return getHooksEnabled(state);
  } catch {
    return false;
  }
}

function isTruthyFlag(value) {
  return value === "1" || value === "true";
}

// Detect a user-supplied Codex profile flag so we don't clobber it: -p, --profile,
// or the `--profile=foo` / `-p=foo` forms.
function hasProfileArg(args) {
  return args.some(
    (arg) => arg === "-p" || arg === "--profile" || arg.startsWith("--profile=") || arg.startsWith("-p=")
  );
}

function createConfigStateFile(dependencies) {
  const paths = getDefaultPaths({
    platform: dependencies.platform,
    env: dependencies.env,
    homeDir: dependencies.homeDir
  });
  const createStateFile = dependencies.createStateFile ?? defaultCreateStateFile;
  return createStateFile({ statePath: paths.statePath });
}

// Best-effort: mirror the reporter's HAYA_PET_HOOK_DEBUG log so transcript-driven
// events (which don't go through `haya-pet state`) show up in the same trace.
function hookDebugLog(env, now, entry) {
  const target = env.HAYA_PET_HOOK_DEBUG;
  if (!target) {
    return;
  }
  try {
    appendFileSync(target, `${JSON.stringify({ ts: now(), ...entry })}\n`);
  } catch {
    // diagnostics must never break the run
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
    print("No pets found. Add a pet folder (pet.json + spritesheet) to ~/.codex/pets or ~/.haya-pet/pets.");
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

function parseHooksArgs(args) {
  const [action = "status"] = args;
  if (action === "on" || action === "off" || action === "status") {
    return { command: "hooks", action };
  }
  throw new Error(`Unknown hooks action: ${action} (use on, off, or status)`);
}

// Persisted GLOBAL toggle for live-status hooks (the convenient alternative to
// setting HAYA_PET_HOOKS every shell). Covers every hook-capable client — Claude
// Code and Codex today.
export async function runHooksCommand(parsed, dependencies = {}) {
  const print = dependencies.print ?? defaultPrint;
  const stateFile = createConfigStateFile(dependencies);
  const state = await stateFile.load();

  if (parsed.action === "status") {
    const enabled = getHooksEnabled(state);
    print(`Live-status hooks: ${enabled ? "on" : "off"}`);
    return { command: "hooks", action: "status", enabled };
  }

  const enabled = parsed.action === "on";
  await stateFile.save(setHooksEnabled(state, enabled));
  print(
    enabled
      ? "Live-status hooks: on. The first `haya-pet run` for Claude Code or Codex asks the client to review the hooks once — approve it."
      : "Live-status hooks: off."
  );
  return { command: "hooks", action: parsed.action, enabled };
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
  let observe = false; // native passthrough by default (full terminal fidelity); --observe opts in
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
    // (e.g. `haya-pet run --client codex` launches `codex`).
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
    process.stderr.write("haya-pet: started the companion overlay.\n");
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
  const flag = env.HAYA_PET_NO_AUTOSTART;
  return flag !== "1" && flag !== "true";
}

// Spawns the Electron companion as a detached background process so it outlives
// this `haya-pet run` invocation. `import("electron")` resolves to the binary path
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
