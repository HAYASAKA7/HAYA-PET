// Resolves stable paths, builds the Codex hook settings, serializes them to TOML,
// and writes them to a STABLE named-profile file inside CODEX_HOME. The wrapper
// then launches `codex -p <profileName>`, which layers these hooks ON TOP of the
// user's base config (auth/model/MCP untouched) and is inert for any codex run
// that doesn't pass `-p <profileName>`.
//
// Like the Claude injector, the file path and command strings are kept identical
// across sessions so Codex's hook-trust review only needs approving once. fnm hands
// out a per-shell symlink for process.execPath that dies when the launching shell
// exits, so we realpath it before baking it into the hook command.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodexHookSettings, serializeCodexHooksToml } from "../../adapters/src/codex-hooks.js";

const DEFAULT_CLI_PATH = fileURLToPath(new URL("../../../apps/cli/src/haya-pet.js", import.meta.url));
const PROFILE_NAME = "haya-pet";
const PROFILE_FILE = `${PROFILE_NAME}.config.toml`;

export function injectCodexHooks({ nodePath, cliPath, codexHome, env = process.env } = {}) {
  const resolvedNode = nodePath ?? safeRealpath(process.execPath);
  const resolvedCli = cliPath ?? safeRealpath(DEFAULT_CLI_PATH);
  const home = codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex");

  const settings = buildCodexHookSettings({ nodePath: resolvedNode, cliPath: resolvedCli });
  const toml = serializeCodexHooksToml(settings, {
    header: "haya-pet live-status hooks profile. Managed by haya-pet; safe to delete."
  });

  // A fixed path with session-independent content: concurrent sessions just
  // rewrite identical bytes, and the hooks stay "trusted" across launches.
  mkdirSync(home, { recursive: true });
  const profilePath = join(home, PROFILE_FILE);
  writeFileSync(profilePath, toml, "utf8");

  // The profile file is stable and reusable on purpose — leaving it in place is
  // what lets Codex remember the hooks are trusted. cleanup is a no-op kept for
  // API symmetry with the caller's finally block.
  return { profileName: PROFILE_NAME, profilePath, cleanup: () => {} };
}

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
