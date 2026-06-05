const ADAPTERS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    displayName: "Codex",
    detection: "manual",
    supportLevel: 2,
    defaultCommand: "codex",
    knownProcessNames: Object.freeze(["codex"]),
    stateHeuristics: Object.freeze(["pty_output"])
  }),
  "claude-code": Object.freeze({
    id: "claude-code",
    displayName: "Claude Code",
    detection: "manual",
    supportLevel: 2,
    defaultCommand: "claude",
    knownProcessNames: Object.freeze(["claude"]),
    stateHeuristics: Object.freeze(["pty_output", "official_plugin"])
  }),
  antigravity: Object.freeze({
    id: "antigravity",
    displayName: "Antigravity",
    detection: "manual",
    supportLevel: 1,
    defaultCommand: "antigravity",
    knownProcessNames: Object.freeze(["antigravity"]),
    stateHeuristics: Object.freeze(["wrapper"])
  }),
  generic: Object.freeze({
    id: "generic",
    displayName: "Generic",
    detection: "manual",
    supportLevel: 1,
    defaultCommand: undefined,
    knownProcessNames: Object.freeze([]),
    stateHeuristics: Object.freeze(["wrapper"])
  })
});

export const KNOWN_CLIENT_IDS = Object.freeze(["codex", "claude-code", "antigravity", "generic"]);

export function listAdapters() {
  return KNOWN_CLIENT_IDS.map((id) => ADAPTERS[id]);
}

export function getAdapterInfo(clientId) {
  return ADAPTERS[clientId];
}

export function resolveAdapterInfo(clientId) {
  const known = ADAPTERS[clientId];
  if (known) {
    return known;
  }

  return {
    ...ADAPTERS.generic,
    id: clientId,
    displayName: clientId
  };
}
