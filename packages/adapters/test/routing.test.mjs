import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import {
  resolveReplyStrategy,
  resolveApprovalStrategy,
  routeReply,
  routeApproval
} from "../src/routing.js";

const SUPPORTED = { canReply: "supported", canApprove: "supported" };
const BEST_EFFORT = { canReply: "best_effort", canApprove: "best_effort" };
const UNSUPPORTED = { canReply: "unsupported", canApprove: "unsupported" };

const validRequest = { type: "task_input", sessionId: "s", inputId: "in_1", text: "go", createdAt: 1 };
const validDecision = { type: "approval_decision", sessionId: "s", approvalId: "ap_1", decision: "approve", decidedAt: 1 };

test("resolves injection strategy from capability level", () => {
  assert.equal(resolveReplyStrategy(SUPPORTED), "structured");
  assert.equal(resolveReplyStrategy(BEST_EFFORT), "pty");
  assert.equal(resolveReplyStrategy(UNSUPPORTED), "focus_terminal");
  assert.equal(resolveApprovalStrategy(BEST_EFFORT), "pty");
});

test("routes a reply through the structured injector when supported", async () => {
  const calls = [];
  const result = await routeReply({
    request: validRequest,
    capabilities: SUPPORTED,
    now: () => 50,
    injectors: { structured: async (req) => calls.push(req) }
  });

  assert.equal(result.ok, true);
  assert.equal(result.acceptedAt, 50);
  assert.equal(calls.length, 1);
});

test("never injects for unsupported adapters", async () => {
  const calls = [];
  const result = await routeReply({
    request: validRequest,
    capabilities: UNSUPPORTED,
    injectors: { structured: async () => calls.push("x"), pty: async () => calls.push("y") }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "reply_unsupported");
  assert.equal(calls.length, 0);
});

test("reports injector failure without throwing", async () => {
  const result = await routeReply({
    request: validRequest,
    capabilities: BEST_EFFORT,
    injectors: { pty: async () => { throw new Error("pty closed"); } }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /pty closed/);
});

test("rejects an invalid reply request before routing", async () => {
  const result = await routeReply({
    request: { type: "task_input", sessionId: "s", inputId: "in_1", text: "   ", createdAt: 1 },
    capabilities: SUPPORTED,
    injectors: { structured: async () => { throw new Error("should not run"); } }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /text/);
});

test("routes an approval decision and reports the result", async () => {
  const calls = [];
  const ok = await routeApproval({
    decision: validDecision,
    capabilities: SUPPORTED,
    now: () => 70,
    injectors: { structured: async (d) => calls.push(d) }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.decidedAt, 70);
  assert.equal(calls.length, 1);

  const blocked = await routeApproval({
    decision: validDecision,
    capabilities: UNSUPPORTED,
    injectors: { structured: async () => calls.push("nope") }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "approval_unsupported");
  assert.equal(calls.length, 1);
});
