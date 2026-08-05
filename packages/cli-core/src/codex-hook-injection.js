// Builds Codex hook overrides for the wrapped process and migrates HAYA-managed
// hooks out of global Codex configuration. A stable HAYA-owned command record
// keeps command text unchanged across sessions so Codex can retain hook trust.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodexHookConfigArgs,
  buildCodexHookSettings
} from "../../adapters/src/codex-hooks.js";

const DEFAULT_CLI_PATH = fileURLToPath(new URL("../../../apps/cli/src/haya-pet-hook.js", import.meta.url));
const HOOKS_FILE = "hooks.json";
const COMMAND_STATE_FILE = "haya-pet-hook-command.json";
const COMMAND_STATE_VERSION = 1;
const HAYA_HOOK_STATUS = "HAYA Pet live status";

export function injectCodexHooks({
  nodePath,
  cliPath,
  codexHome,
  commandStatePath,
  env = process.env,
  profileName
} = {}) {
  const fallback = {
    nodePath: nodePath ?? safeRealpath(process.execPath),
    cliPath: cliPath ?? safeRealpath(DEFAULT_CLI_PATH)
  };
  const home = codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex");
  const hooksPath = join(home, HOOKS_FILE);
  const resolvedCommandStatePath = commandStatePath ?? join(home, COMMAND_STATE_FILE);
  const hadHooksFile = existsSync(hooksPath);
  const existing = readHooksJson(hooksPath);

  const legacyPaths = findReusableHookCommandPaths(existing);
  const storedPaths = readCommandState(resolvedCommandStatePath);
  const commandPaths = legacyPaths
    ?? (storedPaths && hookCommandPathsExist(storedPaths) ? storedPaths : undefined)
    ?? fallback;

  writeCommandStateIfChanged(resolvedCommandStatePath, commandPaths);
  if (hadHooksFile) {
    writeMigratedHooksIfChanged(hooksPath, existing, removeManagedHooksJson(existing));
  }
  removeSelectedProfileLegacyHooks({ home, profileName });

  const settings = markManagedHooks(buildCodexHookSettings(commandPaths));
  return {
    configArgs: buildCodexHookConfigArgs(settings),
    hooksPath,
    commandStatePath: resolvedCommandStatePath,
    cleanup: () => {}
  };
}

function removeSelectedProfileLegacyHooks({ home, profileName }) {
  if (!home || !isCodexProfileName(profileName)) {
    return;
  }

  const profileConfigPath = join(home, profileName + ".config.toml");
  const profileConfig = readOptionalText(profileConfigPath);
  if (profileConfig === undefined) {
    return;
  }

  const nextProfileConfig = removeLegacyHayaTomlHooks(profileConfig);
  if (nextProfileConfig !== normalizeNewlines(profileConfig)) {
    writeFileSync(profileConfigPath, nextProfileConfig, "utf8");
  }
}

function readOptionalText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function removeLegacyHayaTomlHooks(toml) {
  const lines = normalizeNewlines(toml).split("\n");
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isHayaManagedProfileComment(lines[index])) {
      continue;
    }

    if (!isCodexHookEntryHeader(lines[index])) {
      output.push(lines[index]);
      continue;
    }

    const block = [lines[index]];
    index += 1;
    while (index < lines.length && (!isTomlTableHeader(lines[index]) || isCodexHookCommandHeader(lines[index]))) {
      block.push(lines[index]);
      index += 1;
    }
    index -= 1;

    if (!block.some((line) => isLegacyHayaPetCommand(line))) {
      output.push(...block);
    }
  }

  return output.join("\n");
}

function isHayaManagedProfileComment(line) {
  return /^#\s*haya-pet live-status hooks profile\./i.test(line.trim());
}

function isCodexHookEntryHeader(line) {
  return /^\[\[hooks\.[A-Za-z0-9_]+\]\]$/.test(line.trim());
}

function isCodexHookCommandHeader(line) {
  return /^\[\[hooks\.[A-Za-z0-9_]+\.hooks\]\]$/.test(line.trim());
}

function isTomlTableHeader(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, "\n");
}

function isCodexProfileName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function findReusableHookCommandPaths(existing) {
  const hooks = isPlainObject(existing?.hooks) ? existing.hooks : {};
  const candidates = [];

  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
        continue;
      }
      for (const hook of entry.hooks) {
        if (!isManagedHook(hook)) {
          continue;
        }
        const commandPaths = parseHayaHookCommandPaths(hook.command);
        if (commandPaths && hookCommandPathsExist(commandPaths)) {
          candidates.push(commandPaths);
        }
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  const [first] = candidates;
  return candidates.every((candidate) => sameHookCommandPaths(candidate, first))
    ? first
    : undefined;
}

function parseHayaHookCommandPaths(command) {
  if (typeof command !== "string") {
    return undefined;
  }

  const match = /^(?<nodePath>.+?node(?:\.exe)?)\s+"(?<cliPath>[^"]*haya-pet-hook\.js)"\s+(?:state|codex-permission-request)\b/i.exec(command);
  if (!match?.groups) {
    return undefined;
  }
  return {
    nodePath: match.groups.nodePath,
    cliPath: match.groups.cliPath.replace(/\\"/g, '"')
  };
}

function hookCommandPathsExist({ nodePath, cliPath }) {
  return existsSync(nodePath) && existsSync(cliPath);
}

function sameHookCommandPaths(a, b) {
  return a.nodePath === b.nodePath && a.cliPath === b.cliPath;
}

function readCommandState(path) {
  const text = readOptionalText(path);
  if (text === undefined) {
    return undefined;
  }

  try {
    const value = JSON.parse(text);
    if (
      value?.version === COMMAND_STATE_VERSION
      && typeof value.nodePath === "string"
      && typeof value.cliPath === "string"
    ) {
      return { nodePath: value.nodePath, cliPath: value.cliPath };
    }
  } catch {
    // Invalid HAYA-owned metadata is replaceable and must not block a session.
  }
  return undefined;
}

function writeCommandStateIfChanged(path, commandPaths) {
  const next = {
    version: COMMAND_STATE_VERSION,
    nodePath: commandPaths.nodePath,
    cliPath: commandPaths.cliPath
  };
  const nextText = JSON.stringify(next, null, 2) + "\n";
  if (readOptionalText(path) === nextText) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, nextText, "utf8");
}

function writeMigratedHooksIfChanged(hooksPath, existing, next) {
  if (JSON.stringify(existing) === JSON.stringify(next)) {
    return;
  }
  writeFileSync(hooksPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function readHooksJson(hooksPath) {
  try {
    const parsed = JSON.parse(readFileSync(hooksPath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw new Error("haya-pet: could not update Codex " + HOOKS_FILE + " (" + error.message + ")", {
      cause: error
    });
  }
}

function markManagedHooks(settings) {
  const hooks = {};
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    hooks[event] = entries.map((entry) => ({
      ...entry,
      hooks: (entry.hooks ?? []).map((hook) => ({
        ...hook,
        statusMessage: HAYA_HOOK_STATUS
      }))
    }));
  }
  return { hooks };
}

function removeManagedHooksJson(existing) {
  if (!isPlainObject(existing?.hooks)) {
    return existing;
  }

  const hooks = {};
  for (const [event, entries] of Object.entries(existing.hooks)) {
    hooks[event] = removeManagedEntries(entries);
  }
  return { ...existing, hooks };
}

function removeManagedEntries(entries) {
  if (!Array.isArray(entries)) {
    return entries;
  }

  return entries
    .map((entry) => removeManagedHooksFromEntry(entry))
    .filter((entry) => entry !== undefined);
}

function removeManagedHooksFromEntry(entry) {
  if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
    return entry;
  }

  const hooks = entry.hooks.filter((hook) => !isManagedHook(hook));
  if (hooks.length === 0) {
    return undefined;
  }
  if (hooks.length === entry.hooks.length) {
    return entry;
  }
  return { ...entry, hooks };
}

function isManagedHook(hook) {
  if (!isPlainObject(hook)) {
    return false;
  }
  if (hook.statusMessage === HAYA_HOOK_STATUS) {
    return true;
  }
  return isLegacyHayaPetCommand(hook.command);
}

function isLegacyHayaPetCommand(command) {
  if (typeof command !== "string") {
    return false;
  }
  return /haya-pet(?:-hook)?\.js(?:\\?")?\s+(state|codex-permission-request)\b/i.test(command);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
