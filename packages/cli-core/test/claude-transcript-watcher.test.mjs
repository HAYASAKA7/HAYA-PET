import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import {
  claudeProjectDirName,
  discoverTranscript,
  watchClaudeTranscript
} from "../src/claude-transcript-watcher.js";
import { writeSessionTranscriptLink } from "../src/session-transcript-link.js";

const noopTimers = { setInterval: () => ({}), clearInterval: () => {} };

function rejection(toolUseId) {
  return `${JSON.stringify({
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: true, content: "The user rejected this." }] }
  })}\n`;
}

function interrupt() {
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
    interruptedMessageId: "msg_1"
  })}\n`;
}

test("claudeProjectDirName sanitizes drive + separators like Claude does", () => {
  assert.equal(claudeProjectDirName("D:\\Projects\\AI\\haya-pet"), "D--Projects-AI-haya-pet");
  assert.equal(claudeProjectDirName("/home/a/proj"), "-home-a-proj");
});

test("discoverTranscript finds the newest jsonl in the sanitized project dir", () => {
  const root = mkdtempSync(join(tmpdir(), "projroot-"));
  const cwd = "D:\\Work\\demo";
  const dir = join(root, claudeProjectDirName(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old.jsonl"), "{}\n");
  const newer = join(dir, "current.jsonl");
  writeFileSync(newer, "{}\n");

  // Touch the newer file so its mtime is strictly latest.
  appendFileSync(newer, "{}\n");

  assert.equal(discoverTranscript(root, cwd), newer);
});

test("discoverTranscript matches the project dir case-insensitively", () => {
  const root = mkdtempSync(join(tmpdir(), "projroot-"));
  // On-disk dir uses lowercase 'ai'; the live cwd uses 'AI'.
  const dir = join(root, "D--Projects-ai-haya-pet");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "s.jsonl");
  writeFileSync(file, "{}\n");

  assert.equal(discoverTranscript(root, "D:\\Projects\\AI\\haya-pet"), file);
});

test("discoverTranscript skips transcripts older than the session start", () => {
  const root = mkdtempSync(join(tmpdir(), "projroot-"));
  const cwd = "D:\\Work\\demo";
  const dir = join(root, claudeProjectDirName(cwd));
  mkdirSync(dir, { recursive: true });

  const oldFile = join(dir, "old-session.jsonl");
  writeFileSync(oldFile, "{}\n");
  // Make the old file's mtime well in the past.
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(oldFile, past, past);

  // No file newer than `minMtime` yet → nothing to tail.
  const minMtime = Date.now() - 1000;
  assert.equal(discoverTranscript(root, cwd, minMtime), undefined);

  // The active session's transcript appears (current mtime) → it gets picked.
  const active = join(dir, "active.jsonl");
  writeFileSync(active, "{}\n");
  assert.equal(discoverTranscript(root, cwd, minMtime), active);
});

test("watchClaudeTranscript reports denials appended after it starts tailing", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, `${JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } })}\n`);

  const denials = [];
  const watcher = watchClaudeTranscript({
    transcriptPath: path,
    onDenial: (event) => denials.push(event),
    ...noopTimers
  });

  // First tick consumes the existing line (no denial yet).
  watcher._tick();
  assert.deepEqual(denials, []);

  // A denial is appended; the next tick should catch it.
  appendFileSync(path, rejection("toolu_x"));
  watcher._tick();
  assert.deepEqual(denials, [{ type: "tool_denied", toolUseId: "toolu_x" }]);

  watcher.stop();
});

test("watchClaudeTranscript handles a line split across two appends", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, "");

  const denials = [];
  const watcher = watchClaudeTranscript({
    transcriptPath: path,
    onDenial: (event) => denials.push(event),
    ...noopTimers
  });
  watcher._tick();

  const full = rejection("toolu_split");
  const mid = Math.floor(full.length / 2);
  appendFileSync(path, full.slice(0, mid));
  watcher._tick();
  assert.deepEqual(denials, [], "no event until the line is complete");

  appendFileSync(path, full.slice(mid));
  watcher._tick();
  assert.deepEqual(denials, [{ type: "tool_denied", toolUseId: "toolu_split" }]);

  watcher.stop();
});

test("watchClaudeTranscript pins to the session's linked transcript, not newest-by-mtime", () => {
  // Two concurrent sessions share one project dir. Each has its own link.
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  const fileA = join(projectDir, "a.jsonl");
  const fileB = join(projectDir, "b.jsonl");
  writeFileSync(fileA, "");
  writeFileSync(fileB, "");
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_a", transcriptPath: fileA });
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_b", transcriptPath: fileB });

  const interruptsA = [];
  const interruptsB = [];
  const watcherA = watchClaudeTranscript({
    sessionId: "sess_a",
    sessionDir,
    onInterrupt: (e) => interruptsA.push(e),
    ...noopTimers
  });
  const watcherB = watchClaudeTranscript({
    sessionId: "sess_b",
    sessionDir,
    onInterrupt: (e) => interruptsB.push(e),
    ...noopTimers
  });

  // Both pin to their own file, then skip to EOF.
  watcherA._tick();
  watcherB._tick();

  // Interrupt happens in session A only.
  appendFileSync(fileA, interrupt());
  watcherA._tick();
  watcherB._tick();

  assert.deepEqual(interruptsA, [{ type: "interrupted" }], "session A sees its own interrupt");
  assert.deepEqual(interruptsB, [], "session B (idle) is NOT contaminated by session A's interrupt");

  watcherA.stop();
  watcherB.stop();
});

test("watchClaudeTranscript with a session link idles until the link appears", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  const file = join(projectDir, "s.jsonl");
  writeFileSync(file, "");

  const interrupts = [];
  const watcher = watchClaudeTranscript({
    sessionId: "sess_late",
    sessionDir,
    onInterrupt: (e) => interrupts.push(e),
    ...noopTimers
  });

  // No link yet → nothing tailed, even if a marker is already present.
  appendFileSync(file, interrupt());
  watcher._tick();
  assert.deepEqual(interrupts, [], "no guessing before the hook reports the path");

  // The hook fires and records the binding; the watcher now pins (skipping to EOF,
  // so the pre-existing marker is not replayed) and only catches NEW events.
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_late", transcriptPath: file });
  watcher._tick();
  appendFileSync(file, interrupt());
  watcher._tick();
  assert.deepEqual(interrupts, [{ type: "interrupted" }]);

  watcher.stop();
});

test("watchClaudeTranscript reports an interrupt appended after it starts tailing", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, "");

  const interrupts = [];
  const watcher = watchClaudeTranscript({
    transcriptPath: path,
    onInterrupt: (event) => interrupts.push(event),
    ...noopTimers
  });
  watcher._tick();

  appendFileSync(path, interrupt());
  watcher._tick();
  assert.deepEqual(interrupts, [{ type: "interrupted" }]);

  watcher.stop();
});
