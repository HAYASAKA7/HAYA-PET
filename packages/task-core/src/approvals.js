export const APPROVAL_KINDS = Object.freeze([
  "command",
  "file_write",
  "network",
  "sandbox",
  "plugin",
  "permission",
  "other"
]);

export const APPROVAL_RISKS = Object.freeze(["low", "medium", "high"]);

const APPROVAL_KIND_SET = new Set(APPROVAL_KINDS);
const APPROVAL_RISK_SET = new Set(APPROVAL_RISKS);

export function validateApprovalRequest(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["approval request must be an object"] };
  }

  const errors = [];

  requireNonEmptyString(errors, input.approvalId, "approvalId");
  requireNonEmptyString(errors, input.sessionId, "sessionId");
  requireNonEmptyString(errors, input.title, "title");

  if (!APPROVAL_KIND_SET.has(input.kind)) {
    errors.push(`kind must be one of: ${APPROVAL_KINDS.join(", ")}`);
  }

  if (input.risk !== undefined && !APPROVAL_RISK_SET.has(input.risk)) {
    errors.push(`risk must be one of: ${APPROVAL_RISKS.join(", ")}`);
  }

  if (!Number.isFinite(input.requestedAt)) {
    errors.push("requestedAt must be a finite number");
  }

  return { ok: errors.length === 0, errors };
}

export function buildApprovalDecision({ sessionId, approvalId, decision, note, decidedAt }) {
  const result = {
    type: "approval_decision",
    sessionId,
    approvalId,
    decision,
    decidedAt
  };

  if (note !== undefined) {
    result.note = note;
  }

  return result;
}

export function validateApprovalDecision(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["approval decision must be an object"] };
  }

  const errors = [];

  if (input.type !== "approval_decision") {
    errors.push('type must be "approval_decision"');
  }

  requireNonEmptyString(errors, input.sessionId, "sessionId");
  requireNonEmptyString(errors, input.approvalId, "approvalId");

  if (input.decision !== "approve" && input.decision !== "deny") {
    errors.push('decision must be "approve" or "deny"');
  }

  if (!Number.isFinite(input.decidedAt)) {
    errors.push("decidedAt must be a finite number");
  }

  return { ok: errors.length === 0, errors };
}

function requireNonEmptyString(errors, value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
