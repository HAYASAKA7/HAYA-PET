import { validateTaskInputRequest } from "../../task-core/src/replies.js";
import { validateApprovalDecision } from "../../task-core/src/approvals.js";

// Maps an adapter capability level to a concrete injection strategy following
// the preferred order in product plan section 24. The "focus_terminal" result
// means the runtime must NOT inject and should fall back to the user typing.
function strategyFor(level) {
  if (level === "supported") {
    return "structured";
  }
  if (level === "best_effort") {
    return "pty";
  }
  return "focus_terminal";
}

export function resolveReplyStrategy(capabilities = {}) {
  return strategyFor(capabilities.canReply);
}

export function resolveApprovalStrategy(capabilities = {}) {
  return strategyFor(capabilities.canApprove);
}

export async function routeReply({ request, capabilities = {}, injectors = {}, now = Date.now }) {
  const validation = validateTaskInputRequest(request);
  if (!validation.ok) {
    return replyResult(request, { ok: false, error: validation.errors.join("; ") });
  }

  const strategy = resolveReplyStrategy(capabilities);
  if (strategy === "focus_terminal") {
    return replyResult(request, { ok: false, error: "reply_unsupported" });
  }

  return dispatch(injectors[strategy], request, () => replyResult(request, { ok: true, acceptedAt: now() }), (error) =>
    replyResult(request, { ok: false, error })
  );
}

export async function routeApproval({ decision, capabilities = {}, injectors = {}, now = Date.now }) {
  const validation = validateApprovalDecision(decision);
  if (!validation.ok) {
    return approvalResult(decision, { ok: false, error: validation.errors.join("; ") });
  }

  const strategy = resolveApprovalStrategy(capabilities);
  if (strategy === "focus_terminal") {
    return approvalResult(decision, { ok: false, error: "approval_unsupported" });
  }

  return dispatch(injectors[strategy], decision, () => approvalResult(decision, { ok: true, decidedAt: now() }), (error) =>
    approvalResult(decision, { ok: false, error })
  );
}

async function dispatch(injector, payload, onOk, onError) {
  if (typeof injector !== "function") {
    return onError("no_injector");
  }

  try {
    await injector(payload);
    return onOk();
  } catch (error) {
    return onError(error?.message ?? String(error));
  }
}

function replyResult(request, fields) {
  return {
    type: "task_input_result",
    sessionId: request?.sessionId,
    inputId: request?.inputId,
    ...fields
  };
}

function approvalResult(decision, fields) {
  return {
    type: "approval_result",
    sessionId: decision?.sessionId,
    approvalId: decision?.approvalId,
    ...fields
  };
}
