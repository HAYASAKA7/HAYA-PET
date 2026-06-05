import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  APPROVAL_KINDS,
  validateApprovalRequest,
  buildApprovalDecision,
  validateApprovalDecision
} from "../src/approvals.js";

test("validates an approval request with the documented fields", () => {
  const result = validateApprovalRequest({
    approvalId: "ap_1",
    sessionId: "s",
    kind: "command",
    title: "Run npm test",
    commandPreview: "npm test",
    risk: "medium",
    requestedAt: 100
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(APPROVAL_KINDS.includes("file_write"));
});

test("rejects approval requests with invalid kind or risk", () => {
  const result = validateApprovalRequest({
    approvalId: "ap_1",
    sessionId: "s",
    kind: "launch_missiles",
    title: "x",
    risk: "extreme",
    requestedAt: 1
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((m) => m.includes("kind")));
  assert.ok(result.errors.some((m) => m.includes("risk")));
});

test("builds and validates an approval decision", () => {
  const decision = buildApprovalDecision({
    sessionId: "s",
    approvalId: "ap_1",
    decision: "approve",
    decidedAt: 200
  });
  assert.equal(decision.type, "approval_decision");
  assert.equal(validateApprovalDecision(decision).ok, true);
});

test("rejects decisions that are not approve or deny", () => {
  const result = validateApprovalDecision({
    type: "approval_decision",
    sessionId: "s",
    approvalId: "ap_1",
    decision: "maybe",
    decidedAt: 1
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((m) => m.includes("decision")));
});
