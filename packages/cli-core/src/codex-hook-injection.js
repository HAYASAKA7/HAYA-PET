// Resolves stable paths, builds the Codex hook settings, and writes them to the
// user-level hooks.json inside CODEX_HOME. Codex loads user-level hooks alongside
// any selected profile, so HAYA Pet does not consume Codex's single -p/--profile
// slot and custom profiles keep working.
//
// Like the Claude injector, the file path and command strings are kept identical
// across sessions so Codex's hook-trust review only needs approving once. fnm hands
// out a per-shell symlink for process.execPath that dies when the launching shell
// exits, so we realpath it before baking it into the hook command.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodexHookSettings } from "../../adapters/src/codex-hooks.js";

const DEFAULT_CLI_PATH = fileURLToPath(new URL("../../../apps/cli/src/haya-pet.js", import.meta.url));
const HOOKS_FILE = "hooks.json";
const HAYA_HOOK_STATUS = "HAYA Pet live status";

export function injectCodexHooks({ nodePath, cliPath, codexHome, env = process.env } = {}) {
  const resolvedNode = nodePath ?? safeRealpath(process.execPath);
  const resolvedCli = cliPath ?? safeRealpath(DEFAULT_CLI_PATH);
  const home = codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex");

  const settings = markManagedHooks(buildCodexHookSettings({ nodePath: resolvedNode, cliPath: resolvedCli }));

  // A fixed user-level hook source works with every Codex profile. We merge rather
  // than overwrite because hooks.json may already contain user hooks.
  mkdirSync(home, { recursive: true });
  const hooksPath = join(home, HOOKS_FILE);
  const existing = readHooksJson(hooksPath);
  const next = mergeHooksJson(existing, settings);
  writeFileSync(hooksPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  // The hook file is stable and reusable on purpose — leaving it in place is what
  // lets Codex remember the hooks are trusted. cleanup is a no-op kept for API
  // symmetry with the caller's finally block.
  return { hooksPath, cleanup: () => {} };
}

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
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
  return /haya-pet\.js"?\s+(state|codex-permission-request)\b/.test(command);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
