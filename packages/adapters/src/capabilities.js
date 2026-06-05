// Adapter capability declarations (product plan section 23). The talk window
// must hide or disable any control an adapter cannot safely support.

const WRAPPER_ONLY = Object.freeze({
  canReply: "unsupported",
  canApprove: "unsupported",
  canPause: false,
  canResume: false,
  canStop: true,
  canFocusTerminal: true,
  canOpenTranscript: false,
  canShowDiffs: false,
  canShowFiles: false,
  canShowTests: false
});

const PTY_OBSERVER = Object.freeze({
  canReply: "best_effort",
  canApprove: "best_effort",
  canPause: false,
  canResume: false,
  canStop: true,
  canFocusTerminal: true,
  canOpenTranscript: false,
  canShowDiffs: false,
  canShowFiles: false,
  canShowTests: false
});

const ADAPTER_CAPABILITIES = Object.freeze({
  generic: WRAPPER_ONLY,
  antigravity: WRAPPER_ONLY,
  codex: PTY_OBSERVER,
  "claude-code": PTY_OBSERVER
});

export function getAdapterCapabilities(clientId) {
  return ADAPTER_CAPABILITIES[clientId] ?? WRAPPER_ONLY;
}
