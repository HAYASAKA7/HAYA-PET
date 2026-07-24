#!/usr/bin/env node
import { realpathSync, appendFileSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGenericCommand as defaultRunGenericCommand } from "../../../packages/cli-core/src/run-command.js";
import { parseStateArgs, runStateCommand, readHookPayloadFromStdin } from "../../../packages/cli-core/src/run-state.js";
import { removeSessionTranscriptLink } from "../../../packages/cli-core/src/session-transcript-link.js";
import { injectClaudeHooks as defaultInjectClaudeHooks } from "../../../packages/cli-core/src/claude-hook-injection.js";
import { injectCodexHooks as defaultInjectCodexHooks } from "../../../packages/cli-core/src/codex-hook-injection.js";
import { watchClaudeTranscript as defaultWatchClaudeTranscript } from "../../../packages/cli-core/src/claude-transcript-watcher.js";
import { watchCodexTranscript as defaultWatchCodexTranscript } from "../../../packages/cli-core/src/codex-transcript-watcher.js";
import { watchCodexGuardianReviews as defaultWatchCodexGuardianReviews } from "../../../packages/cli-core/src/codex-guardian-watcher.js";
import { ensureCompanionConnection } from "../../../packages/cli-core/src/companion-launcher.js";
import { createIpcClient as defaultCreateIpcClient } from "../../../packages/daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../../packages/platform-core/src/paths.js";
import { discoverPetsWithFallback as defaultDiscoverPets } from "../../../packages/pet-core/src/discovery.js";
import { createStateFile as defaultCreateStateFile } from "../../../packages/app-state/src/state-file.js";
import { getSelectedPetId, setSelectedPet, getHooksEnabled, setHooksEnabled } from "../../../packages/app-state/src/state.js";
import { checkForUpdate, UPDATE_COMMAND } from "../../../packages/app-state/src/update-check.js";
import { raceDeadline } from "../../../packages/cli-core/src/deadline.js";

// Ceiling for wrapper→companion IPC awaits (see createMessageSender).
const SENDER_DEADLINE_MS = 5000;
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

  if (command === "codex-permission-request") {
    return { command: "codex-permission-request" };
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

  if (parsed.command === "codex-permission-request") {
    return runCodexPermissionRequestCommand(parsed, dependencies);
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
  const updateCheck = startUpdateCheck(dependencies);
  const result = await startCompanionAndReport(dependencies, print);
  await reportUpdateNotice(updateCheck, print);
  return result;
}

async function startCompanionAndReport(dependencies, print) {
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

// Kick off the (cached, best-effort) npm update check without blocking the
// actual work; callers await the promise only when they are about to print.
// Nothing here may ever break the run — even resolving the state path can
// throw (no HOME/USERPROFILE), which simply means "no check".
function startUpdateCheck(dependencies) {
  try {
    const check = dependencies.checkForUpdate ?? defaultCheckForUpdate;
    return check({
      currentVersion: dependencies.currentVersion ?? readOwnVersion(),
      stateFile: createConfigStateFile(dependencies),
      env: dependencies.env ?? process.env,
      now: dependencies.now ?? Date.now
    });
  } catch {
    return Promise.resolve(undefined);
  }
}

// Default update check runs only on an interactive terminal: piped/CI output
// should not be nagged (and nothing non-interactive should touch the network).
function defaultCheckForUpdate(options) {
  if (!process.stdout.isTTY) {
    return Promise.resolve(undefined);
  }
  return checkForUpdate(options);
}

async function reportUpdateNotice(updateCheck, print) {
  const update = await updateCheck;
  if (update) {
    print(
      `haya-pet: update available — ${update.currentVersion} → ${update.latestVersion}. Run: ${UPDATE_COMMAND}`
    );
  }
}

function runCodexPermissionRequestCommand(_parsed, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const reviewer = normalizeCodexApprovalsReviewer(env.HAYA_PET_CODEX_APPROVAL_REVIEWER);
  const autoReview = isCodexAutoReviewer(reviewer);
  return runStateCommand(
    {
      command: "state",
      state: autoReview ? "reviewing" : "waiting_approval",
      summary: autoReview ? "agent reviewing approval" : "approval",
      session: undefined
    },
    dependencies
  );
}

function readOwnVersion() {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf8")).version;
  } catch {
    return undefined;
  }
}

function resolveCodexApprovalsReviewer(options = {}) {
  const env = options.env ?? process.env;
  const explicit = normalizeCodexApprovalsReviewer(env.HAYA_PET_CODEX_APPROVAL_REVIEWER);
  if (explicit) {
    return explicit;
  }

  const fromArgs = findCodexApprovalsReviewerInArgs(options.childArgs ?? []);
  if (fromArgs) {
    return fromArgs;
  }

  const home = options.codexHome ?? env.CODEX_HOME ?? resolveHomeCodexDir(options.homeDir, env);
  const readFile = options.readFile ?? readFileSync;
  const profileName = findCodexProfileInArgs(options.childArgs ?? []);
  const fromProfile = profileName ? readCodexApprovalsReviewerFromProfile(home, profileName, readFile) : undefined;
  const fromConfig = readCodexApprovalsReviewerFromConfig(home, readFile);
  return fromProfile ?? fromConfig ?? "user";
}

function resolveHomeCodexDir(homeDir, env) {
  const home = homeDir ?? env.USERPROFILE ?? env.HOME;
  return home ? join(home, ".codex") : undefined;
}

function findCodexApprovalsReviewerInArgs(args) {
  let reviewer;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    let configValue;
    if (arg === "-c" || arg === "--config") {
      configValue = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--config=")) {
      configValue = arg.slice("--config=".length);
    } else if (arg.startsWith("-c") && arg.length > 2) {
      configValue = arg.slice(2);
    }

    const parsed = parseApprovalsReviewerAssignment(configValue);
    if (parsed) {
      reviewer = parsed;
    }
  }
  return reviewer;
}

function findCodexProfileInArgs(args) {
  let profileName;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    let value;
    if (arg === "-p" || arg === "--profile") {
      value = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--profile=")) {
      value = arg.slice("--profile=".length);
    } else if (arg.startsWith("-p=")) {
      value = arg.slice("-p=".length);
    } else if (arg.startsWith("-p") && arg.length > 2) {
      value = arg.slice(2);
    }

    if (isCodexProfileName(value)) {
      profileName = value;
    }
  }
  return profileName;
}

function isCodexProfileName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function readCodexApprovalsReviewerFromProfile(codexHome, profileName, readFile) {
  if (!codexHome || !isCodexProfileName(profileName)) {
    return undefined;
  }
  return readCodexApprovalsReviewerFromFile(join(codexHome, `${profileName}.config.toml`), readFile);
}
function readCodexApprovalsReviewerFromConfig(codexHome, readFile) {
  if (!codexHome) {
    return undefined;
  }
  return readCodexApprovalsReviewerFromFile(join(codexHome, "config.toml"), readFile);
}

function readCodexApprovalsReviewerFromFile(path, readFile) {
  try {
    return parseTopLevelApprovalsReviewer(readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function parseTopLevelApprovalsReviewer(toml) {
  let inTopLevel = true;
  for (const line of String(toml).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) {
      continue;
    }
    const reviewer = parseApprovalsReviewerAssignment(trimmed);
    if (reviewer) {
      return reviewer;
    }
  }
  return undefined;
}

function parseApprovalsReviewerAssignment(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^\s*approvals_reviewer\s*=\s*(.+?)\s*(?:#.*)?$/.exec(value);
  if (!match) {
    return undefined;
  }
  return normalizeCodexApprovalsReviewer(stripTomlString(match[1]));
}

function stripTomlString(value) {
  const trimmed = String(value).trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeCodexApprovalsReviewer(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return normalized || undefined;
}

function isCodexAutoReviewer(value) {
  return value === "auto_review" || value === "guardian_subagent";
}

async function runRunCommand(parsed, dependencies) {
  const runGenericCommand = dependencies.runGenericCommand ?? defaultRunGenericCommand;
  const injectClaudeHooks = dependencies.injectClaudeHooks ?? defaultInjectClaudeHooks;
  const injectCodexHooks = dependencies.injectCodexHooks ?? defaultInjectCodexHooks;
  const watchClaudeTranscript = dependencies.watchClaudeTranscript ?? defaultWatchClaudeTranscript;
  const watchCodexTranscript = dependencies.watchCodexTranscript ?? defaultWatchCodexTranscript;
  const watchCodexGuardianReviews =
    dependencies.watchCodexGuardianReviews ?? defaultWatchCodexGuardianReviews;
  const print = dependencies.print ?? defaultPrint;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const cwd = dependencies.cwd ?? process.cwd();
  const messageSender = await createMessageSender(dependencies);
  // Concurrent with the wrapped command; the result is printed after it exits
  // (interactive TUIs clear the screen, so a pre-launch notice would be lost).
  const updateCheck = startUpdateCheck(dependencies);

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

    // The transcript watcher pins to THIS session's transcript via the
    // session->transcript link the `haya-pet state` reporter writes from the hook
    // payload. sessionDir is where that link lives; resolve it defensively so a
    // missing home dir (tests) never breaks the run.
    const sessionDir = resolveSessionDir(dependencies, env);

    // Claude fires NO hook when the user manually denies a permission, so the
    // pet would stay stuck on "waiting for approval". Tail the session transcript
    // (ground truth) and clear to idle the moment a denial is recorded — never on
    // a timer, so a genuinely-pending approval keeps alerting until it's resolved.
    const watcher = watchClaudeTranscript({
      cwd,
      homeDir: dependencies.homeDir,
      startedAt: now(),
      sessionId,
      sessionDir,
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
      },
      // Esc-interrupt fires no Stop hook, so without this the pet stays stuck on
      // "thinking"/"running". The transcript's interrupt marker is the only signal.
      onInterrupt: () => {
        hookDebugLog(env, now, { source: "transcript", event: "interrupted", state: "interrupted" });
        messageSender
          .send({
            type: "state",
            sessionId,
            state: "interrupted",
            summary: "interrupted",
            confidence: 0.9,
            source: "client_log",
            updatedAt: now()
          })
          .catch(() => {});
      }
    });
    stopWatcher = () => {
      watcher.stop();
      removeSessionTranscriptLink({ sessionDir, sessionId });
    };
  }

  // Codex: no `--settings` equivalent, so install stable user-level hooks in
  // CODEX_HOME/hooks.json. Codex loads user hooks alongside any selected
  // -p/--profile, so the wrapper never consumes the user's single profile slot.
  // PreToolUse is not reliable, so a transcript watcher supplies tool activity.
  const codexHooksOn = hooksOn && parsed.clientId === "codex";
  if (codexHooksOn) {
    const codexProfileName = findCodexProfileInArgs(parsed.childArgs);
    const injected = injectCodexHooks({
      env,
      codexHome: dependencies.codexHome,
      profileName: codexProfileName
    });
    childEnv = {
      ...env,
      HAYA_PET_SESSION_ID: sessionId,
      HAYA_PET_CODEX_APPROVAL_REVIEWER: resolveCodexApprovalsReviewer({
        childArgs: parsed.childArgs,
        env,
        homeDir: dependencies.homeDir,
        codexHome: dependencies.codexHome,
        readFile: dependencies.readFile
      })
    };
    cleanup = injected.cleanup;

    // Pin both Codex watchers to THIS session's rollout via the
    // session->transcript link the `haya-pet state` reporter records from the
    // hook payload's transcript_path, instead of guessing newest-by-mtime (which
    // leaks a concurrent same-cwd session's activity/interrupts).
    const sessionDir = resolveSessionDir(dependencies, env);

    const activeToolCalls = new Set();
    const watcher = watchCodexTranscript({
      homeDir: dependencies.homeDir,
      sessionsRoot: dependencies.codexSessionsRoot,
      cwd,
      startedAt: now(),
      sessionId,
      sessionDir,
      onToolEvent: (event) => {
        hookDebugLog(env, now, {
          source: "codex_transcript",
          event: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: event.state ?? (event.type === "usage_limit_reached" || event.type === "turn_failed" ? "interrupted" : undefined),
          limitType: event.limitType
        });

        // Esc-interrupt fires no Stop hook, so without this the pet stays stuck
        // on "thinking"/"running" until the stale sweep.
        if (event.type === "turn_aborted") {
          activeToolCalls.clear();
          messageSender
            .send({
              type: "state",
              sessionId,
              state: "interrupted",
              summary: "interrupted",
              confidence: 0.9,
              source: "client_log",
              updatedAt: now()
            })
            .catch(() => {});
          return;
        }

        if (event.type === "usage_limit_reached") {
          activeToolCalls.clear();
          messageSender
            .send({
              type: "state",
              sessionId,
              state: "interrupted",
              summary: "usage limit reached",
              confidence: 0.9,
              source: "client_log",
              updatedAt: now()
            })
            .catch(() => {});
          return;
        }

        if (event.type === "turn_failed") {
          activeToolCalls.clear();
          messageSender
            .send({
              type: "state",
              sessionId,
              state: "interrupted",
              summary: "model response failed",
              confidence: 0.9,
              source: "client_log",
              updatedAt: now()
            })
            .catch(() => {});
          return;
        }

        if (event.type === "turn_complete") {
          activeToolCalls.clear();
          messageSender
            .send({
              type: "state",
              sessionId,
              state: "idle",
              summary: "turn complete",
              confidence: 0.85,
              source: "client_log",
              updatedAt: now()
            })
            .catch(() => {});
          return;
        }

        if (event.type === "tool_started") {
          activeToolCalls.add(event.toolCallId);
          messageSender
            .send({
              type: "state",
              sessionId,
              state: event.state,
              summary: event.toolName,
              confidence: 0.85,
              source: "client_log",
              updatedAt: now()
            })
            .catch(() => {});
          return;
        }

        if (event.type === "tool_finished") {
          activeToolCalls.delete(event.toolCallId);
          if (activeToolCalls.size === 0) {
            messageSender
              .send({
                type: "state",
                sessionId,
                state: "thinking",
                confidence: 0.85,
                source: "client_log",
                updatedAt: now()
              })
              .catch(() => {});
          }
        }
      }
    });
    const previousStopWatcher = stopWatcher;
    stopWatcher = () => {
      watcher.stop();
      previousStopWatcher();
    };

    // With "Approve for me" (approvals_reviewer=auto_review, legacy alias
    // guardian_subagent), Codex routes approval requests to a guardian
    // subagent and never shows the human approval UI — yet the
    // PermissionRequest hook still fires at request creation. The hook's
    // reporter uses the resolved approvals reviewer config: auto-review
    // reports reviewing immediately, while manual review reports waiting.
    // The guardian's own rollout is the only observable record of the
    // review, so tail it: a review turn starting proves the agent is
    // reviewing; an "allow" verdict proves the action proceeds; a "deny"
    // verdict goes back to the model, which keeps working. An unreadable
    // verdict reports nothing — a pending cue is never cleared on a guess.
    const guardianWatcher = watchCodexGuardianReviews({
      homeDir: dependencies.homeDir,
      sessionsRoot: dependencies.codexSessionsRoot,
      cwd,
      startedAt: now(),
      sessionId,
      sessionDir,
      onReviewEvent: (event) => {
        hookDebugLog(env, now, {
          source: "codex_guardian",
          event: event.type,
          outcome: event.outcome
        });

        const report = resolveGuardianStateReport(event);
        if (!report) {
          return;
        }
        messageSender
          .send({
            type: "state",
            sessionId,
            state: report.state,
            summary: report.summary,
            confidence: 0.85,
            source: "client_log",
            updatedAt: now()
          })
          .catch(() => {});
      }
    });
    const stopWithoutGuardian = stopWatcher;
    stopWatcher = () => {
      guardianWatcher.stop();
      stopWithoutGuardian();
      removeSessionTranscriptLink({ sessionDir, sessionId });
    };
  }

  try {
    const result = await runGenericCommand({
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
    await reportUpdateNotice(updateCheck, print);
    return result;
  } finally {
    stopWatcher();
    cleanup();
    await messageSender.close();
  }
}

// Map a guardian review event to the pet state it proves. waiting_approval is
// deliberately NOT among these: with the guardian reviewing, the user is not
// being asked anything, and after a deny the request is resolved (the model
// receives the rejection and continues) — there is no pending human decision.
function resolveGuardianStateReport(event) {
  if (event.type === "review_started") {
    return { state: "reviewing", summary: "agent reviewing approval" };
  }
  if (event.type === "review_finished" && event.outcome === "allow") {
    return { state: "running_tool", summary: "reviewer approved" };
  }
  if (event.type === "review_finished" && event.outcome === "deny") {
    return { state: "thinking", summary: "reviewer denied" };
  }
  return undefined;
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


function createConfigStateFile(dependencies) {
  const paths = getDefaultPaths({
    platform: dependencies.platform,
    env: dependencies.env,
    homeDir: dependencies.homeDir
  });
  const createStateFile = dependencies.createStateFile ?? defaultCreateStateFile;
  return createStateFile({ statePath: paths.statePath });
}

// Where per-session transcript links live. Resolved defensively: if no home dir
// is available (some tests), return undefined and the watcher falls back to its
// legacy discovery instead of crashing the run.
function resolveSessionDir(dependencies, env) {
  try {
    return getDefaultPaths({
      platform: dependencies.platform,
      env,
      homeDir: dependencies.homeDir
    }).sessionDir;
  } catch {
    return undefined;
  }
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

  // Deadline every IPC await: if the companion wedges, a hanging send/close
  // would keep THIS process alive after the wrapped CLI exits — leaving the
  // user's terminal without a prompt. Losing a status message to the deadline
  // is fine (the registry stales-out dead sessions); losing the terminal isn't.
  const deadlineMs = dependencies.senderDeadlineMs ?? SENDER_DEADLINE_MS;
  return {
    send: (message) => raceDeadline(client.send(message), deadlineMs),
    close: () => raceDeadline(client.close(), deadlineMs)
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
  const paths = getDefaultPaths();
  const logFd = openCompanionLog(paths);
  let child;
  try {
    child = spawn(electronPath, [companionDir], buildCompanionLaunchOptions({ logStream: logFd }));
  } finally {
    closeCompanionLog(logFd);
  }
  child.unref();
}

export function buildCompanionLaunchOptions({ logStream } = {}) {
  const output = logStream ?? "ignore";
  return {
    detached: true,
    stdio: ["ignore", output, output],
    windowsHide: false
  };
}

function openCompanionLog(paths) {
  if (!paths?.companionLogPath || !paths?.logDir) {
    return undefined;
  }
  try {
    mkdirSync(paths.logDir, { recursive: true });
    const fd = openSync(paths.companionLogPath, "a");
    writeSync(fd, `${JSON.stringify({ ts: new Date().toISOString(), kind: "companion-launch" })}\n`);
    return fd;
  } catch {
    return undefined;
  }
}

function closeCompanionLog(fd) {
  if (!Number.isInteger(fd)) {
    return;
  }
  try {
    closeSync(fd);
  } catch {
    // best-effort diagnostics only
  }
}

async function noopSend() {}

async function noopClose() {}

if (isDirectRun(import.meta.url, process.argv[1])) {
  bootstrap()
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

// Real-process entry. For a `haya-pet state` invocation — which is ALWAYS a client
// hook child — read the hook payload from stdin once to learn: this session's real
// transcript path (for the session->transcript link); the live background_tasks
// snapshot (so a Stop with a still-running subagent keeps a working cue instead of
// idle); and the agent_id (present only for subagent-originated events, which the
// reporter drops so a subagent's activity never overwrites the main status). All
// are handed to the reporter via dependencies. Done here (not inside
// main/runStateCommand) so unit tests, and every other command that needs stdin
// passed through to its child (e.g. `run`), never touch stdin.
async function bootstrap() {
  const argv = process.argv.slice(2);
  const dependencies = {};
  if (argv[0] === "state") {
    try {
      const { transcriptPath, backgroundTasks, agentId } = await readHookPayloadFromStdin();
      if (transcriptPath) {
        dependencies.transcriptPath = transcriptPath;
      }
      if (Array.isArray(backgroundTasks) && backgroundTasks.length > 0) {
        dependencies.backgroundTasks = backgroundTasks;
      }
      // Present only for subagent-originated events — the reporter drops those so a
      // subagent's tool use never overwrites the main session's status.
      if (agentId) {
        dependencies.agentId = agentId;
      }
    } catch {
      // a missing/garbled payload just means no binding this time — never fatal
    }
  }
  return main(argv, dependencies);
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
