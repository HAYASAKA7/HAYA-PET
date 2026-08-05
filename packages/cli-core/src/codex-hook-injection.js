// Resolves stable paths, builds the Codex hook settings, and writes them to the
// user-level hooks.json inside CODEX_HOME. Codex loads user-level hooks alongside
// any selected profile, so HAYA Pet does not consume Codex's single -p/--profile
// slot and custom profiles keep working.
//
// Like the Claude injector, the file path and command strings are kept identical
// across sessions so Codex's hook-trust review only needs approving once. fnm hands
// out a per-shell symlink for process.execPath that dies when the launching shell
// exits, so we realpath it before baking it into the hook command.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodexHookSettings } from "../../adapters/src/codex-hooks.js";

const DEFAULT_CLI_PATH = fileURLToPath(new URL("../../../apps/cli/src/haya-pet-hook.js", import.meta.url));
const HOOKS_FILE = "hooks.json";
const HAYA_HOOK_STATUS = "HAYA Pet live status";

export function injectCodexHooks({ nodePath, cliPath, codexHome, env = process.env, profileName } = {}) {
  const resolvedNode = nodePath ?? safeRealpath(process.execPath);
  const resolvedCli = cliPath ?? safeRealpath(DEFAULT_CLI_PATH);
  const home = codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex");

  // A fixed user-level hook source works with every Codex profile. We merge rather
  // than overwrite because hooks.json may already contain user hooks.
  mkdirSync(home, { recursive: true });
  const hooksPath = join(home, HOOKS_FILE);
  const existing = readHooksJson(hooksPath);
  const commandPaths = reuseExistingHookCommandPaths(existing, {
    nodePath: resolvedNode,
    cliPath: resolvedCli
  });
  const settings = markManagedHooks(buildCodexHookSettings(commandPaths));
  const next = mergeHooksJson(existing, settings);
  writeHooksJsonIfChanged(hooksPath, next);
  syncSelectedProfileHookTrust({ home, hooksPath, profileName });

  // The hook file is stable and reusable on purpose — leaving it in place is what
  // lets Codex remember the hooks are trusted. cleanup is a no-op kept for API
  // symmetry with the caller's finally block.
  return { hooksPath, cleanup: () => {} };
}

function syncSelectedProfileHookTrust({ home, hooksPath, profileName }) {
  if (!home || !isCodexProfileName(profileName)) {
    return;
  }

  const baseConfigPath = join(home, "config.toml");
  const profileConfigPath = join(home, `${profileName}.config.toml`);
  const profileConfig = readOptionalText(profileConfigPath);
  if (profileConfig === undefined) {
    return;
  }

  const baseConfig = readOptionalText(baseConfigPath);
  const trustedBlocks = baseConfig === undefined ? [] : extractHookTrustBlocks(baseConfig, hooksPath);
  let nextProfileConfig = removeLegacyHayaTomlHooks(profileConfig);
  if (trustedBlocks.length > 0) {
    nextProfileConfig = replaceHookTrustBlocks(nextProfileConfig, hooksPath, trustedBlocks);
  }

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

function extractHookTrustBlocks(toml, hooksPath) {
  const lines = normalizeNewlines(toml).split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const key = parseHookStateKey(lines[index]);
    if (!key || !isHookStateForHooksPath(key, hooksPath)) {
      continue;
    }

    const block = [lines[index]];
    index += 1;
    while (index < lines.length && !isTomlTableHeader(lines[index])) {
      block.push(lines[index]);
      index += 1;
    }
    index -= 1;
    blocks.push(trimTrailingBlankLines(block).join("\n"));
  }

  return blocks;
}

function replaceHookTrustBlocks(toml, hooksPath, trustedBlocks) {
  const trimmedBlocks = trustedBlocks.map((block) => block.trimEnd()).filter(Boolean);
  if (trimmedBlocks.length === 0) {
    return normalizeNewlines(toml);
  }

  const withoutOldBlocks = removeHookTrustBlocks(toml, hooksPath).trimEnd();
  const prefix = withoutOldBlocks ? `${withoutOldBlocks}\n\n` : "";
  const parentTable = /^\[hooks\.state\]\s*$/m.test(withoutOldBlocks) ? "" : "[hooks.state]\n\n";
  return `${prefix}${parentTable}${trimmedBlocks.join("\n\n")}\n`;
}

function removeHookTrustBlocks(toml, hooksPath) {
  const lines = normalizeNewlines(toml).split("\n");
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const key = parseHookStateKey(lines[index]);
    if (!key || !isHookStateForHooksPath(key, hooksPath)) {
      output.push(lines[index]);
      continue;
    }

    index += 1;
    while (index < lines.length && !isTomlTableHeader(lines[index])) {
      index += 1;
    }
    index -= 1;
  }

  return output.join("\n");
}

function parseHookStateKey(line) {
  const prefix = "[hooks.state.'";
  const suffix = "']";
  const trimmed = line.trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(suffix)) {
    return undefined;
  }
  return trimmed.slice(prefix.length, -suffix.length);
}

function isHookStateForHooksPath(key, hooksPath) {
  const prefix = `${hooksPath}:`;
  if (process.platform === "win32") {
    return key.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return key.startsWith(prefix);
}

function isTomlTableHeader(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function trimTrailingBlankLines(lines) {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }
  return trimmed;
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

function reuseExistingHookCommandPaths(existing, fallback) {
  const reusable = findReusableHookCommandPaths(existing);
  return reusable ?? fallback;
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
  if (!candidates.every((candidate) => sameHookCommandPaths(candidate, first))) {
    return undefined;
  }
  return first;
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

function writeHooksJsonIfChanged(hooksPath, next) {
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  if (readOptionalText(hooksPath) === nextText) {
    return;
  }
  writeFileSync(hooksPath, nextText, "utf8");
}

function readHooksJson(hooksPath) {
  try {
    const parsed = JSON.parse(readFileSync(hooksPath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw new Error(`haya-pet: could not update Codex ${HOOKS_FILE} (${error.message})`, { cause: error });
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

function mergeHooksJson(existing, managed) {
  const output = isPlainObject(existing) ? { ...existing } : {};
  const existingHooks = isPlainObject(output.hooks) ? output.hooks : {};
  const managedHooks = managed.hooks ?? {};
  const hooks = {};
  const events = new Set([...Object.keys(existingHooks), ...Object.keys(managedHooks)]);

  for (const event of events) {
    const preserved = removeManagedEntries(existingHooks[event]);
    const nextEntries = managedHooks[event] ?? [];

    if (Array.isArray(preserved)) {
      hooks[event] = [...preserved, ...nextEntries];
    } else if (nextEntries.length > 0) {
      hooks[event] = nextEntries;
    } else if (preserved !== undefined) {
      hooks[event] = preserved;
    }
  }

  output.hooks = hooks;
  return output;
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
  return /haya-pet(?:-hook)?\.js(?:\\?")?\s+(state|codex-permission-request)\b/.test(command);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
