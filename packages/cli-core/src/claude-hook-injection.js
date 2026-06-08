// Resolves stable paths, builds the per-session Claude settings, and writes them
// to a STABLE temp path. Both the command strings and the file path are kept
// identical across sessions so Claude Code's hook-trust review (which would
// otherwise block the interactive TUI) only has to be approved once. node version
// managers (fnm) hand out a per-shell symlink for process.execPath that dies when
// the launching shell exits, so we realpath it before baking it into the hook.
import { realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeHookSettings } from "../../adapters/src/claude-hooks.js";

const DEFAULT_CLI_PATH = fileURLToPath(new URL("../../../apps/cli/src/haya-pet.js", import.meta.url));
const SETTINGS_FILE = "haya-pet-claude-settings.json";

export function injectClaudeHooks({ nodePath, cliPath } = {}) {
  const resolvedNode = nodePath ?? safeRealpath(process.execPath);
  const resolvedCli = cliPath ?? safeRealpath(DEFAULT_CLI_PATH);

  const settings = buildClaudeHookSettings({
    nodePath: resolvedNode,
    cliPath: resolvedCli
  });

  // A fixed path with session-independent content: concurrent sessions just
  // rewrite identical bytes, and the hooks stay "trusted" across launches.
  const settingsPath = join(tmpdir(), SETTINGS_FILE);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");

  // The settings file is stable and reusable on purpose — leaving it in place is
  // what lets Claude remember the hooks are trusted. cleanup is a no-op kept for
  // API symmetry with the caller's finally block.
  return { settingsPath, cleanup: () => {} };
}

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
